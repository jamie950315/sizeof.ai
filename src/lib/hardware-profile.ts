export type HardwareKind = 'discrete-gpu' | 'unified-memory'

export interface HardwareProfile {
  kind: HardwareKind
  label: string
  capacityGiB: number
  reservedGiB: number
  systemRamGiB?: number
}

const VERSION = 1
const MAX_LABEL_LENGTH = 200
const MAX_MEMORY_GIB = 4096

function isPositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isMemorySize(value: unknown): value is number {
  return isPositive(value) && value <= MAX_MEMORY_GIB
}

function profileFromUnknown(value: unknown): HardwareProfile | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const profile = value as Record<string, unknown>
  if (profile.kind !== 'discrete-gpu' && profile.kind !== 'unified-memory') return null
  if (typeof profile.label !== 'string' || !profile.label.trim() || profile.label.length > MAX_LABEL_LENGTH) return null
  if (!isMemorySize(profile.capacityGiB) || !isNonNegative(profile.reservedGiB)
    || profile.reservedGiB > MAX_MEMORY_GIB) return null
  const systemRamGiB = profile.systemRamGiB
  if (profile.kind === 'unified-memory' && systemRamGiB !== undefined) return null
  if (profile.kind === 'discrete-gpu') {
    if (systemRamGiB !== undefined && !isMemorySize(systemRamGiB)) return null
    const discrete: HardwareProfile = {
      kind: profile.kind,
      label: profile.label,
      capacityGiB: profile.capacityGiB,
      reservedGiB: profile.reservedGiB,
    }
    if (isPositive(systemRamGiB)) discrete.systemRamGiB = systemRamGiB
    return discrete
  }

  return {
        kind: profile.kind,
        label: profile.label,
        capacityGiB: profile.capacityGiB,
        reservedGiB: profile.reservedGiB,
      }
}

export function validateHardwareProfile(value: unknown): HardwareProfile | null {
  return profileFromUnknown(value)
}

export function usableMemoryGiB(profile: HardwareProfile): number {
  return Math.max(0, profile.capacityGiB - profile.reservedGiB)
}

export function parseHardwareProfile(value: string | null): HardwareProfile | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const envelope = parsed as Record<string, unknown>
    return envelope.version === VERSION ? profileFromUnknown(envelope.profile) : null
  } catch {
    return null
  }
}

export function serializeHardwareProfile(profile: HardwareProfile): string {
  const validated = profileFromUnknown(profile)
  if (!validated) throw new Error('Invalid hardware profile')
  return JSON.stringify({ version: VERSION, profile: validated })
}
