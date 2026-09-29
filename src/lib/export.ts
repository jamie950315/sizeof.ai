import type { EvidenceEntry } from './evidence'

export const EXPORT_SCHEMA_VERSION = 2
export const EXPORT_DISCLAIMER = 'Estimate, not a benchmark or guarantee.'

export interface SizingExportRecordInput {
  model: { id: string; sourceUrl?: string | null }
  configuration: { quantization?: string | null; contextTokens?: number | null; kvPrecision?: string | null; mlaCacheMode?: string | null; source?: string | null; variantId?: string | null; artifactWeightGiB?: number | null }
  hardware: {
    capacityGiB?: number | null
    profile?: {
      kind: string
      label: string
      capacityGiB?: number | null
      reservedGiB?: number | null
      systemRamGiB?: number | null
      usableCapacityGiB?: number | null
      applied?: boolean | null
    } | null
  }
  estimate?: { kind: 'estimate' | 'lower-bound'; totalGiB?: number | null; weightsGiB?: number | null; kvCacheGiB?: number | null; runtimeGiB?: number | null } | null
  resourceProfile?: {
    kind: string
    title: string
    totalGiB?: number | null
    components?: Array<{
      id: string
      label: string
      repositoryId?: string | null
      path?: string | null
      sizeBytes?: number | null
      provenance?: string | null
      sourceUrl?: string | null
      revision?: string | null
      repositoryUpdatedAt?: string | null
    }>
  } | null
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
  const resourceProfile = input.resourceProfile ? defined({
    kind: safeText(input.resourceProfile.kind, 96),
    title: safeText(input.resourceProfile.title),
    totalGiB: finite(input.resourceProfile.totalGiB),
    components: input.resourceProfile.components?.slice(0, 32).map((component) => defined({
      id: safeText(component.id, 120),
      label: safeText(component.label),
      repositoryId: component.repositoryId ? safeText(component.repositoryId, 193) : undefined,
      path: component.path ? safeText(component.path) : undefined,
      sizeBytes: finite(component.sizeBytes),
      provenance: component.provenance ? safeText(component.provenance) : undefined,
      sourceUrl: safeUrl(component.sourceUrl),
      revision: component.revision ? safeText(component.revision, 128) : undefined,
      repositoryUpdatedAt: component.repositoryUpdatedAt ? safeText(component.repositoryUpdatedAt, 64) : undefined,
    })),
  }) : undefined
  const profile = input.hardware.profile
  return defined({
    model: defined({ canonicalId: safeText(input.model.id, 193), sourceUrl: safeUrl(input.model.sourceUrl) }),
    configuration: defined({ quantization: input.configuration.quantization ? safeText(input.configuration.quantization, 96) : undefined, contextTokens: finite(input.configuration.contextTokens), kvPrecision: input.configuration.kvPrecision ? safeText(input.configuration.kvPrecision, 96) : undefined, mlaCacheMode: input.configuration.mlaCacheMode ? safeText(input.configuration.mlaCacheMode, 96) : undefined, source: input.configuration.source ? safeText(input.configuration.source, 96) : undefined, variantId: input.configuration.variantId ? safeText(input.configuration.variantId, 160) : undefined, artifactWeightGiB: finite(input.configuration.artifactWeightGiB) }),
    hardware: defined({
      capacityGiB: finite(input.hardware.capacityGiB),
      profile: profile ? defined({
        kind: safeText(profile.kind, 48),
        label: safeText(profile.label, 200),
        capacityGiB: finite(profile.capacityGiB),
        reservedGiB: finite(profile.reservedGiB),
        systemRamGiB: finite(profile.systemRamGiB),
        usableCapacityGiB: finite(profile.usableCapacityGiB),
        applied: profile.applied === true ? true : profile.applied === false ? false : undefined,
      }) : undefined,
    }),
    estimate,
    resourceProfile,
    evidence: input.evidence.slice(0, 24).map((entry) => defined({ id: safeText(entry.id, 120), kind: entry.kind, label: safeText(entry.label), detail: safeText(entry.detail), sourceUrl: safeUrl(entry.sourceUrl), revision: entry.revision ? safeText(entry.revision, 128) : undefined, fetchedAt: entry.fetchedAt ? safeText(entry.fetchedAt, 64) : undefined, repositoryUpdatedAt: entry.repositoryUpdatedAt ? safeText(entry.repositoryUpdatedAt, 64) : undefined })),
  }) as SizingExportDocument['records'][number]
}

export function createSizingExport(input: SizingExportInput): SizingExportDocument {
  return { schemaVersion: EXPORT_SCHEMA_VERSION, generatedAt: safeText(input.generatedAt, 64), disclaimer: EXPORT_DISCLAIMER, records: input.records.slice(0, 4).map(exportRecord) }
}

function flatten(value: unknown, prefix = ''): Array<[string, string | number]> {
  if (typeof value === 'boolean') return [[prefix, String(value)]]
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
  const lines = ['# sizeof.ai sizing export', '', `Schema version: ${document.schemaVersion}`, `Generated: ${markdownText(document.generatedAt)}`]
  document.records.forEach((record, index) => {
    const model = record.model as ExportRecord; const config = record.configuration as ExportRecord; const hardware = record.hardware as ExportRecord; const estimate = record.estimate as ExportRecord | undefined; const resource = record.resourceProfile as ExportRecord | undefined
    lines.push('', `## Model ${index + 1}: ${markdownText(model.canonicalId)}`, `- Source URL: ${markdownText(model.sourceUrl ?? '—')}`, `- Quantization: ${markdownText(config.quantization ?? '—')}`, `- Context: ${markdownText(config.contextTokens ?? '—')}`, `- KV precision: ${markdownText(config.kvPrecision ?? '—')}`, `- MLA mode: ${markdownText(config.mlaCacheMode ?? '—')}`, `- Selected source: ${markdownText(config.source ?? '—')}`, `- Selected artifact: ${markdownText(config.variantId ?? '—')}${config.artifactWeightGiB === undefined ? '' : ` (${markdownText(config.artifactWeightGiB)} GiB)`}`, `- Capacity: ${markdownText(hardware.capacityGiB ?? '—')} GiB`)
    const profile = hardware.profile as ExportRecord | undefined
    if (profile) {
      lines.push(`- Hardware profile: ${markdownText(profile.label)} (${profile.applied === undefined ? '' : `${profile.applied === true ? 'applied, ' : 'saved, '}`}${markdownText(profile.kind)})`)
      const usable = profile.usableCapacityGiB ?? hardware.capacityGiB
      const total = profile.capacityGiB
      const reserved = profile.reservedGiB
      lines.push(`- Usable capacity: ${markdownText(usable ?? '—')} GiB${total === undefined || reserved === undefined ? '' : ` (${markdownText(total)} GiB − ${markdownText(reserved)} GiB reserved)`}`)
      if (profile.systemRamGiB !== undefined) lines.push(`- System RAM: ${markdownText(profile.systemRamGiB)} GiB`)
    }
    if (estimate) lines.push(`- Status: ${markdownText(String(estimate.status).replace('-', ' ').toUpperCase())}`, `- Total: ${markdownText(estimate.totalGiB ?? '—')} GiB`, `- Weights: ${markdownText(estimate.weightsGiB ?? '—')} GiB`, `- KV cache: ${markdownText(estimate.kvCacheGiB ?? '—')} GiB`, `- Runtime: ${markdownText(estimate.runtimeGiB ?? '—')} GiB`)
    if (resource) {
      lines.push(`- Resource profile: ${markdownText(resource.kind)} / ${markdownText(resource.title)}`, `- Resource total: ${markdownText(resource.totalGiB ?? '—')} GiB`)
      for (const component of (resource.components as ExportRecord[] | undefined) ?? []) {
        const details = [
          component.repositoryId === undefined ? undefined : `repository ${markdownText(component.repositoryId)}`,
          component.path === undefined ? undefined : `path ${markdownText(component.path)}`,
          component.sizeBytes === undefined ? undefined : `${markdownText(Number(component.sizeBytes) / 1024 ** 3)} GiB`,
          component.provenance === undefined ? undefined : markdownText(component.provenance),
          component.sourceUrl === undefined ? undefined : markdownText(component.sourceUrl),
          component.revision === undefined ? undefined : `revision ${markdownText(component.revision)}`,
          component.repositoryUpdatedAt === undefined ? undefined : `updated ${markdownText(component.repositoryUpdatedAt)}`,
        ].filter((value): value is string => Boolean(value))
        lines.push(`- Resource component: ${markdownText(component.id)} — ${markdownText(component.label)}${details.length ? ` (${details.join('; ')})` : ''}`)
      }
    }
    for (const evidence of record.evidence as ExportRecord[]) {
      const details = [
        evidence.sourceUrl === undefined ? undefined : markdownText(evidence.sourceUrl),
        evidence.revision === undefined ? undefined : `revision ${markdownText(evidence.revision)}`,
        evidence.fetchedAt === undefined ? undefined : `fetched ${markdownText(evidence.fetchedAt)}`,
        evidence.repositoryUpdatedAt === undefined ? undefined : `updated ${markdownText(evidence.repositoryUpdatedAt)}`,
      ].filter((value): value is string => Boolean(value))
      lines.push(`- Evidence: ${markdownText(evidence.id)} [${markdownText(evidence.kind)}] ${markdownText(evidence.label)} — ${markdownText(evidence.detail)}${details.length ? ` (${details.join('; ')})` : ''}`)
    }
  })
  lines.push('', `> ${EXPORT_DISCLAIMER}`)
  return lines.join('\n')
}
