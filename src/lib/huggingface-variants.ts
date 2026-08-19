export type HuggingFaceVariantFormat = 'gguf' | 'mlx' | 'exl3' | 'exl2' | 'ninfer' | 'safetensors'

export interface HuggingFaceTreeEntry {
  type: 'file' | 'directory'
  path: string
  size: number
}

export interface HuggingFaceRepoSnapshot {
  revision: string
  label: string
  entries: HuggingFaceTreeEntry[]
}

export interface HuggingFaceVariant {
  id: string
  label: string
  format: HuggingFaceVariantFormat
  revision: string
  path: string
  source: 'branch' | 'directory' | 'file'
  role: 'model' | 'addon' | 'projector'
  bitsPerWeight: number | null
  weightSizeBytes: number
  totalSizeBytes: number
  provenance?: 'repository' | 'community'
  publisher?: string
  repositoryId?: string
  sourceUrl?: string
}

export interface NInferManifestFacts {
  artifactPath: string | null
  artifactSizeBytes: number | null
  baseModelId: string
  baseRevision: string
  weightsId: string | null
}

export interface VariantArtifactManifestFacts {
  baseModelId: string
  sourceModelId: string | null
  sourceRevision: string | null
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function modelId(value: unknown) {
  return typeof value === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(value)
    ? value
    : null
}

export function parseVariantArtifactManifest(value: unknown): VariantArtifactManifestFacts | null {
  const metadata = record(record(value).metadata)
  const baseModelId = modelId(metadata.baseModel)
  if (!baseModelId) return null

  const revision = typeof metadata.sourceRevision === 'string'
    && /^[a-f0-9]{40}$/i.test(metadata.sourceRevision)
    ? metadata.sourceRevision
    : null
  return {
    baseModelId,
    sourceModelId: modelId(metadata.sourceRepository),
    sourceRevision: revision,
  }
}

export function parseNInferManifest(value: unknown): NInferManifestFacts | null {
  const manifest = record(value)
  const base = record(manifest.base)
  const artifact = record(manifest.artifact)
  const baseModelId = modelId(base.repo_id)
  const baseRevision = typeof base.revision === 'string' ? base.revision : null
  if (!baseModelId) {
    return null
  }
  if (!baseRevision || !/^[a-f0-9]{40}$/i.test(baseRevision)) return null

  const artifactPath = typeof artifact.path === 'string'
    && !artifact.path.startsWith('/')
    && !artifact.path.split('/').includes('..')
    ? artifact.path
    : null
  const artifactSizeBytes = typeof artifact.bytes === 'number'
    && Number.isFinite(artifact.bytes) && artifact.bytes > 0
    ? artifact.bytes
    : null
  return {
    artifactPath,
    artifactSizeBytes,
    baseModelId,
    baseRevision,
    weightsId: typeof manifest.weights_id === 'string' ? manifest.weights_id : null,
  }
}

export function applyReleaseManifest(
  variants: HuggingFaceVariant[],
  value: unknown,
): HuggingFaceVariant[] {
  const rawVariants = record(value).variants
  if (!Array.isArray(rawVariants)) return variants
  const sizes = new Map<string, number>()
  for (const item of rawVariants) {
    const variant = record(item)
    const path = typeof variant.path === 'string' ? variant.path : null
    const size = typeof variant.total_size_bytes === 'number' ? variant.total_size_bytes : null
    if (path && !path.split('/').includes('..') && size !== null && Number.isFinite(size) && size > 0) {
      sizes.set(path.replace(/\/$/, ''), size)
    }
  }
  return variants.map((variant) => ({
    ...variant,
    totalSizeBytes: sizes.get(variant.path.replace(/\/$/, '')) ?? variant.totalSizeBytes,
  }))
}

function safeFile(entry: HuggingFaceTreeEntry) {
  return entry.type === 'file'
    && Number.isFinite(entry.size)
    && entry.size > 0
    && !entry.path.startsWith('/')
    && !entry.path.split('/').includes('..')
}

function stableId(revision: string, path: string) {
  return `${revision}:${path}`.toLowerCase().replace(/[^a-z0-9._:-]+/g, '-')
}

function precisionFromText(value: string) {
  const bpw = value.match(/(\d+(?:\.\d+)?)\s*bpw/i)
  if (bpw) return Number(bpw[1])
  const bits = value.match(/(?:^|[^\d])(\d+(?:\.\d+)?)\s*[-_ ]?bit(?:s)?(?:[^\d]|$)/i)
  if (bits) return Number(bits[1])
  if (/\bbf16\b/i.test(value) || /\bfp16\b/i.test(value)) return 16
  if (/\bfp8\b/i.test(value) || /\bq8(?:_0)?\b/i.test(value)) return 8
  const gguf = value.match(/(?:^|[-_.])(?:i?q)([2-8])(?:[-_.]|$)/i)
  return gguf ? Number(gguf[1]) : null
}

function ggufLabel(path: string) {
  const name = path.split('/').at(-1)?.replace(/\.gguf$/i, '') ?? 'GGUF'
  const quant = name.match(/(?:^|[-_.])((?:IQ|Q)[2-8](?:_[A-Z0-9]+)+)(?:[-_.]|$)/i)?.[1]
  const precision = quant?.toUpperCase() ?? (/\bbf16\b/i.test(name) ? 'BF16' : name)
  const mtp = /(?:^|[-_.])mtp(?:[-_.]|$)/i.test(name) ? ' + MTP' : ''
  return `GGUF ${precision}${mtp}`
}

function artifactRole(path: string): HuggingFaceVariant['role'] {
  if (/(?:^|\/)mtp(?:\/|[-_.])/i.test(path)) return 'addon'
  const name = path.split('/').at(-1)?.toLowerCase() ?? ''
  if (/^(?:mmproj|projector)|(?:^|[-_.])mmproj(?:[-_.]|$)/.test(name)) return 'projector'
  if (/(?:^|[-_.])(?:mtp[-_.]?head|sidecar)(?:[-_.]|$)/.test(name)) return 'addon'
  return 'model'
}

function groupedFormat(tags: string[]): HuggingFaceVariantFormat {
  const normalized = tags.map((tag) => tag.toLowerCase())
  if (normalized.some((tag) => tag.includes('exl3'))) return 'exl3'
  if (normalized.some((tag) => tag.includes('exl2'))) return 'exl2'
  if (normalized.some((tag) => tag === 'mlx' || tag.includes('mlx-vlm'))) return 'mlx'
  return 'safetensors'
}

function groupedLabel(format: HuggingFaceVariantFormat, text: string) {
  const bits = precisionFromText(text)
  const prefix = format === 'mlx' ? 'MLX' : format.toUpperCase()
  if (/\bbf16\b/i.test(text)) return `${prefix} BF16`
  if (/bpw/i.test(text) && bits !== null) return `${prefix} ${bits.toFixed(2)} bpw`
  if (bits !== null) return `${prefix} ${Number.isInteger(bits) ? bits : bits.toFixed(2)}-bit`
  return `${prefix} ${text}`
}

export function parseHuggingFaceVariants(
  snapshots: HuggingFaceRepoSnapshot[],
  tags: string[],
): HuggingFaceVariant[] {
  const variants: HuggingFaceVariant[] = []
  const format = groupedFormat(tags)
  const allowsSafetensorVariants = format !== 'safetensors'
    || tags.some((tag) => /quantized|\bfp8\b|\b[2-8](?:\.\d+)?-?bit\b/i.test(tag))

  for (const snapshot of snapshots) {
    const files = snapshot.entries.filter(safeFile)
    const completeShardPaths = new Set<string>()
    const shardGroups = new Map<string, Array<{ entry: HuggingFaceTreeEntry; index: number; total: number; prefix: string }>>()
    for (const entry of files) {
      const match = entry.path.match(/^(.*)-(\d{5})-of-(\d{5})\.gguf$/i)
      if (!match) continue
      const index = Number(match[2])
      const total = Number(match[3])
      if (!Number.isInteger(index) || !Number.isInteger(total) || index < 1 || total < 2 || index > total) continue
      const key = `${match[1]}:${total}`
      shardGroups.set(key, [...(shardGroups.get(key) ?? []), {
        entry,
        index,
        total,
        prefix: match[1],
      }])
    }
    for (const shards of shardGroups.values()) {
      if (shards.length !== shards[0].total
        || new Set(shards.map((shard) => shard.index)).size !== shards[0].total) continue
      const sorted = [...shards].sort((a, b) => a.index - b.index)
      sorted.forEach((shard) => completeShardPaths.add(shard.entry.path))
      const weightSizeBytes = sorted.reduce((sum, shard) => sum + shard.entry.size, 0)
      variants.push({
        id: stableId(snapshot.revision, sorted[0].entry.path),
        label: ggufLabel(`${sorted[0].prefix}.gguf`),
        format: 'gguf',
        revision: snapshot.revision,
        path: sorted[0].entry.path,
        source: 'file',
        role: artifactRole(sorted[0].entry.path),
        bitsPerWeight: precisionFromText(sorted[0].prefix),
        weightSizeBytes,
        totalSizeBytes: weightSizeBytes,
      })
    }

    for (const entry of files) {
      const lowerPath = entry.path.toLowerCase()
      const artifactFormat = lowerPath.endsWith('.gguf')
        ? 'gguf'
        : lowerPath.endsWith('.ninfer')
          ? 'ninfer'
          : null
      if (!artifactFormat) continue
      if (artifactFormat === 'gguf' && completeShardPaths.has(entry.path)) continue
      variants.push({
        id: stableId(snapshot.revision, entry.path),
        label: artifactFormat === 'gguf' ? ggufLabel(entry.path) : 'NInfer',
        format: artifactFormat,
        revision: snapshot.revision,
        path: entry.path,
        source: 'file',
        role: artifactRole(entry.path),
        bitsPerWeight: precisionFromText(entry.path),
        weightSizeBytes: entry.size,
        totalSizeBytes: entry.size,
      })
    }

    if (!allowsSafetensorVariants) continue
    const weightFiles = files.filter((entry) => entry.path.toLowerCase().endsWith('.safetensors'))
    const groups = new Map<string, HuggingFaceTreeEntry[]>()
    for (const entry of weightFiles) {
      const parts = entry.path.split('/')
      const group = parts.length > 1 ? parts[0] : '.'
      groups.set(group, [...(groups.get(group) ?? []), entry])
    }

    for (const [group, weights] of groups) {
      const isBranch = snapshot.label !== 'main'
      const descriptor = isBranch ? snapshot.label : group === '.' ? snapshot.label : group
      const relatedFiles = group === '.'
        ? files.filter((entry) => !entry.path.includes('/'))
        : files.filter((entry) => entry.path === group || entry.path.startsWith(`${group}/`))
      const path = group === '.' ? '' : group
      variants.push({
        id: stableId(snapshot.revision, path || snapshot.label),
        label: groupedLabel(format, descriptor),
        format,
        revision: snapshot.revision,
        path,
        source: isBranch ? 'branch' : group === '.' ? 'file' : 'directory',
        role: 'model',
        bitsPerWeight: precisionFromText(descriptor),
        weightSizeBytes: weights.reduce((sum, entry) => sum + entry.size, 0),
        totalSizeBytes: relatedFiles.reduce((sum, entry) => sum + entry.size, 0),
      })
    }
  }

  return variants.sort((a, b) => {
    const roleDelta = (a.role === 'model' ? 0 : 1) - (b.role === 'model' ? 0 : 1)
    if (roleDelta !== 0) return roleDelta
    if (a.bitsPerWeight !== null && b.bitsPerWeight !== null) return a.bitsPerWeight - b.bitsPerWeight
    if (a.bitsPerWeight !== null) return -1
    if (b.bitsPerWeight !== null) return 1
    return a.label.localeCompare(b.label)
  })
}
