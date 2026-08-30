import type { EvidenceEntry } from './evidence'

export const EXPORT_SCHEMA_VERSION = 2
export const EXPORT_DISCLAIMER = 'Estimate, not a benchmark or guarantee.'

export interface SizingExportRecordInput {
  model: { id: string; sourceUrl?: string | null }
  configuration: { quantization?: string | null; contextTokens?: number | null; kvPrecision?: string | null; mlaCacheMode?: string | null; source?: string | null; variantId?: string | null; artifactWeightGiB?: number | null }
  hardware: { capacityGiB?: number | null }
  estimate?: { kind: 'estimate' | 'lower-bound'; totalGiB?: number | null; weightsGiB?: number | null; kvCacheGiB?: number | null; runtimeGiB?: number | null } | null
  resourceProfile?: { kind: string; title: string; totalGiB?: number | null } | null
  evidence: EvidenceEntry[]
}

export interface SizingExportInput { generatedAt: string; records: SizingExportRecordInput[] }
type ExportRecord = Record<string, unknown>
export interface SizingExportDocument { schemaVersion: number; generatedAt: string; disclaimer: string; records: Array<{ model: { canonicalId: string; sourceUrl?: string }; configuration: ExportRecord; hardware: ExportRecord; estimate?: ExportRecord; resourceProfile?: ExportRecord; evidence: ExportRecord[] }> }

function finite(value: number | null | undefined) { return typeof value === 'number' && Number.isFinite(value) ? value : undefined }
function safeText(value: string, maxLength = 512) { return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength) }
function safeUrl(value: string | null | undefined) {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return undefined
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch { return undefined }
}
function defined(value: ExportRecord) { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) }

function exportRecord(input: SizingExportRecordInput): SizingExportDocument['records'][number] {
  const estimate = input.estimate ? defined({
    status: input.estimate.kind, totalGiB: finite(input.estimate.totalGiB), weightsGiB: finite(input.estimate.weightsGiB),
    kvCacheGiB: finite(input.estimate.kvCacheGiB), runtimeGiB: finite(input.estimate.runtimeGiB),
  }) : undefined
  const resourceProfile = input.resourceProfile ? defined({ kind: safeText(input.resourceProfile.kind, 96), title: safeText(input.resourceProfile.title), totalGiB: finite(input.resourceProfile.totalGiB) }) : undefined
  return defined({
    model: defined({ canonicalId: safeText(input.model.id, 193), sourceUrl: safeUrl(input.model.sourceUrl) }),
    configuration: defined({ quantization: input.configuration.quantization ? safeText(input.configuration.quantization, 96) : undefined, contextTokens: finite(input.configuration.contextTokens), kvPrecision: input.configuration.kvPrecision ? safeText(input.configuration.kvPrecision, 96) : undefined, mlaCacheMode: input.configuration.mlaCacheMode ? safeText(input.configuration.mlaCacheMode, 96) : undefined, source: input.configuration.source ? safeText(input.configuration.source, 96) : undefined, variantId: input.configuration.variantId ? safeText(input.configuration.variantId, 160) : undefined, artifactWeightGiB: finite(input.configuration.artifactWeightGiB) }),
    hardware: defined({ capacityGiB: finite(input.hardware.capacityGiB) }),
    estimate,
    resourceProfile,
    evidence: input.evidence.slice(0, 24).map((entry) => defined({ id: safeText(entry.id, 120), kind: entry.kind, label: safeText(entry.label), detail: safeText(entry.detail), sourceUrl: safeUrl(entry.sourceUrl), revision: entry.revision ? safeText(entry.revision, 128) : undefined, fetchedAt: entry.fetchedAt ? safeText(entry.fetchedAt, 64) : undefined, repositoryUpdatedAt: entry.repositoryUpdatedAt ? safeText(entry.repositoryUpdatedAt, 64) : undefined })),
  }) as SizingExportDocument['records'][number]
}

export function createSizingExport(input: SizingExportInput): SizingExportDocument {
  return { schemaVersion: EXPORT_SCHEMA_VERSION, generatedAt: safeText(input.generatedAt, 64), disclaimer: EXPORT_DISCLAIMER, records: input.records.slice(0, 4).map(exportRecord) }
}

function flatten(value: unknown, prefix = ''): Array<[string, string | number]> {
  if (typeof value === 'string' || typeof value === 'number') return [[prefix, value]]
  if (Array.isArray(value)) return value.flatMap((item, index) => flatten(item, `${prefix}[${index}]`))
  if (!value || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => flatten(item, prefix ? `${prefix}.${key}` : key))
}
function csvCell(value: string | number) { const raw = String(value); const formulaSafe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw; return /[",\r\n]/.test(formulaSafe) ? `"${formulaSafe.replaceAll('"', '""')}"` : formulaSafe }
export function exportSizingCsv(input: SizingExportInput) { return ['field,value', ...flatten(createSizingExport(input)).map(([key, value]) => `${csvCell(key)},${csvCell(value)}`)].join('\r\n') }
function markdownText(value: unknown) { return safeText(String(value)).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '\\|') }
export function exportSizingMarkdown(input: SizingExportInput) {
  const document = createSizingExport(input)
  const lines = ['# sizeof.ai sizing export', '', `Schema version: ${document.schemaVersion}`, `Generated: ${document.generatedAt}`]
  document.records.forEach((record, index) => {
    const model = record.model as ExportRecord; const config = record.configuration as ExportRecord; const estimate = record.estimate as ExportRecord | undefined; const resource = record.resourceProfile as ExportRecord | undefined
    lines.push('', `## Model ${index + 1}: ${markdownText(model.canonicalId)}`, `- Source URL: ${markdownText(model.sourceUrl ?? '—')}`, `- Quantization: ${markdownText(config.quantization ?? '—')}`, `- Context: ${markdownText(config.contextTokens ?? '—')}`, `- KV precision: ${markdownText(config.kvPrecision ?? '—')}`, `- MLA mode: ${markdownText(config.mlaCacheMode ?? '—')}`, `- Capacity: ${markdownText((record.hardware as ExportRecord).capacityGiB ?? '—')} GiB`)
    if (estimate) lines.push(`- Status: ${markdownText(String(estimate.status).replace('-', ' ').toUpperCase())}`, `- Total: ${markdownText(estimate.totalGiB ?? '—')} GiB`)
    if (resource) lines.push(`- Resource profile: ${markdownText(resource.kind)} / ${markdownText(resource.title)}`, `- Resource total: ${markdownText(resource.totalGiB ?? '—')} GiB`)
  })
  lines.push('', `> ${EXPORT_DISCLAIMER}`)
  return lines.join('\n')
}
