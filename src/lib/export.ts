import type { EvidenceEntry } from './evidence'

export const EXPORT_SCHEMA_VERSION = 1
export const EXPORT_DISCLAIMER = 'Estimate, not a benchmark or guarantee.'

export interface SizingExportInput {
  model: { id: string; sourceUrl?: string | null }
  configuration: { quantization: string; contextTokens: number; kvPrecision?: string | null; mlaCacheMode?: string | null }
  hardware: { capacityGiB: number }
  estimate: {
    kind: 'estimate' | 'lower-bound'
    totalGiB?: number | null
    weightsGiB?: number | null
    kvCacheGiB?: number | null
    runtimeGiB?: number | null
  }
  evidence: EvidenceEntry[]
  generatedAt: string
}

type ExportRecord = Record<string, unknown>

function finite(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function safeText(value: string, maxLength = 512) {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, maxLength)
}

function safeUrl(value: string | null | undefined) {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function objectEntries(value: Record<string, unknown>) {
  return Object.entries(value).filter(([, item]) => item !== undefined)
}

export function createSizingExport(input: SizingExportInput) {
  const configuration: ExportRecord = {
    contextTokens: finite(input.configuration.contextTokens),
    kvPrecision: input.configuration.kvPrecision ? safeText(input.configuration.kvPrecision, 96) : undefined,
    mlaCacheMode: input.configuration.mlaCacheMode ? safeText(input.configuration.mlaCacheMode, 96) : undefined,
    quantization: safeText(input.configuration.quantization, 96),
  }
  const estimate: ExportRecord = {
    status: input.estimate.kind,
    totalGiB: finite(input.estimate.totalGiB),
    weightsGiB: finite(input.estimate.weightsGiB),
    kvCacheGiB: finite(input.estimate.kvCacheGiB),
    runtimeGiB: finite(input.estimate.runtimeGiB),
  }
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    generatedAt: safeText(input.generatedAt, 64),
    disclaimer: EXPORT_DISCLAIMER,
    model: {
      canonicalId: safeText(input.model.id, 193),
      ...(safeUrl(input.model.sourceUrl) ? { sourceUrl: safeUrl(input.model.sourceUrl) } : {}),
    },
    configuration: Object.fromEntries(objectEntries(configuration)),
    hardware: Object.fromEntries(objectEntries({ capacityGiB: finite(input.hardware.capacityGiB) })),
    estimate: Object.fromEntries(objectEntries(estimate)),
    evidence: input.evidence.slice(0, 24).map((entry) => Object.fromEntries(objectEntries({
      id: safeText(entry.id, 120),
      kind: entry.kind,
      label: safeText(entry.label),
      detail: safeText(entry.detail),
      sourceUrl: safeUrl(entry.sourceUrl),
      revision: entry.revision ? safeText(entry.revision, 128) : undefined,
      fetchedAt: entry.fetchedAt ? safeText(entry.fetchedAt, 64) : undefined,
      repositoryUpdatedAt: entry.repositoryUpdatedAt ? safeText(entry.repositoryUpdatedAt, 64) : undefined,
    }))),
  }
}

function flatten(value: unknown, prefix = ''): Array<[string, string | number]> {
  if (typeof value === 'string' || typeof value === 'number') return [[prefix, value]]
  if (Array.isArray(value)) return value.flatMap((item, index) => flatten(item, `${prefix}[${index}]`))
  if (!value || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => flatten(item, prefix ? `${prefix}.${key}` : key))
}

function csvCell(value: string | number) {
  const raw = String(value)
  const formulaSafe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  return /[",\r\n]/.test(formulaSafe) ? `"${formulaSafe.replaceAll('"', '""')}"` : formulaSafe
}

export function exportSizingCsv(input: SizingExportInput) {
  return ['field,value', ...flatten(createSizingExport(input)).map(([key, value]) => `${csvCell(key)},${csvCell(value)}`)].join('\r\n')
}

function markdownText(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function exportSizingMarkdown(input: SizingExportInput) {
  const data = createSizingExport(input)
  const estimate = data.estimate as ExportRecord
  const configuration = data.configuration as ExportRecord
  const lines = [
    '# sizeof.ai sizing export',
    '',
    `- Model: ${markdownText(data.model.canonicalId)}`,
    `- Generated: ${data.generatedAt}`,
    `- Status: ${String(estimate.status).replace('-', ' ').toUpperCase()}`,
    `- Capacity: ${data.hardware.capacityGiB ?? '—'} GiB`,
    `- Quantization: ${markdownText(String(configuration.quantization))}`,
    `- Context: ${configuration.contextTokens ?? '—'} tokens`,
  ]
  for (const [label, key] of [['Total', 'totalGiB'], ['Weights', 'weightsGiB'], ['KV cache', 'kvCacheGiB'], ['Runtime', 'runtimeGiB']] as const) {
    if (typeof estimate[key] === 'number') lines.push(`- ${label}: ${estimate[key]} GiB`)
  }
  lines.push('', `> ${EXPORT_DISCLAIMER}`)
  return lines.join('\n')
}
