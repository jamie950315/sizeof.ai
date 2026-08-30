import { describe, expect, it } from 'vitest'
import {
  parseHardwareProfile,
  serializeHardwareProfile,
  usableMemoryGiB,
  type HardwareProfile,
} from './hardware-profile'

describe('hardware profiles', () => {
  const discrete: HardwareProfile = {
    kind: 'discrete-gpu',
    label: 'RTX workstation',
    capacityGiB: 24,
    reservedGiB: 2,
    systemRamGiB: 64,
  }

  it('round-trips a versioned discrete-GPU profile without changing its inputs', () => {
    const serialized = serializeHardwareProfile(discrete)

    expect(JSON.parse(serialized)).toMatchObject({ version: 1, profile: discrete })
    expect(parseHardwareProfile(serialized)).toEqual(discrete)
    expect(usableMemoryGiB(discrete)).toBe(22)
  })

  it('allows a reserve above capacity but clamps only the usable result', () => {
    const profile: HardwareProfile = {
      kind: 'unified-memory', label: 'M-series', capacityGiB: 16, reservedGiB: 20,
    }

    expect(usableMemoryGiB(profile)).toBe(0)
    expect(parseHardwareProfile(serializeHardwareProfile(profile))).toEqual(profile)
  })

  it('rejects unknown versions, malformed JSON, invalid reserves, and unsafe values', () => {
    expect(parseHardwareProfile('{')).toBeNull()
    expect(parseHardwareProfile(JSON.stringify({ version: 2, profile: discrete }))).toBeNull()
    expect(parseHardwareProfile(JSON.stringify({ version: 1, profile: { ...discrete, reservedGiB: -1 } }))).toBeNull()
    expect(parseHardwareProfile(JSON.stringify({ version: 1, profile: { ...discrete, capacityGiB: 0 } }))).toBeNull()
    expect(parseHardwareProfile(JSON.stringify({ version: 1, profile: { ...discrete, capacityGiB: 999_999 } }))).toBeNull()
    expect(parseHardwareProfile(JSON.stringify({ version: 1, profile: { ...discrete, reservedGiB: 999_999 } }))).toBeNull()
    expect(parseHardwareProfile(JSON.stringify({ version: 1, profile: { ...discrete, label: 'x'.repeat(201) } }))).toBeNull()
    expect(parseHardwareProfile(JSON.stringify({ version: 1, profile: {
      kind: 'unified-memory', label: 'M-series', capacityGiB: 16, reservedGiB: 1, systemRamGiB: 32,
    } }))).toBeNull()
  })
})
