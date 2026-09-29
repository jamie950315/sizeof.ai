export const benchmarkStorageKey = 'sizeof-benchmarks-v1'
export const benchmarkByteLimit = 2 * 1024 * 1024
export interface BenchmarkRow {
  id: string; date: string; modelId: string; runtime: string; runtimeVersion: string; device: string; quantization: string; modelRevision: string
  context: number; concurrency: number; loadState: 'cold' | 'warm'; workload: string; outcome: 'success' | 'error'
  promptTokens: number | null; ttftMs: number | null; decodeTokens: number | null; decodeSeconds: number | null; totalSeconds: number | null; peakGiB: number | null
}
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid measurement record.'); return value as Record<string, unknown> }
function field(value: unknown, max = 160, optional = false): string { if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) throw new Error('A measurement field is missing or too long.'); return value.trim() }
function number(value: unknown, max: number, integer = false, nullable = true, zero = false): number | null {
  if (value === null && nullable) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (!zero && value === 0) || value > max || (integer && !Number.isInteger(value))) throw new Error('Measurement numbers must be finite and within the displayed limits.')
  return value
}
export function parseBenchmark(value: unknown): BenchmarkRow {
  const r = { ...record(value) }, id = field(r.id, 80), date = field(r.date, 40), modelId = field(r.modelId, 193), modelRevision = field(r.modelRevision, 40, true)
  // Earlier v1 exports called load state temperature; never interpret this as sampling temperature.
  if (r.loadState !== undefined && r.temperature !== undefined && r.loadState !== r.temperature) throw new Error('Conflicting load-state fields in measurement backup.')
  r.loadState = r.loadState === undefined ? r.temperature : r.loadState
  if (!/^[\w-]+$/.test(id) || !/^\d{4}-\d\d-\d\dT/.test(date) || !Number.isFinite(Date.parse(date))) throw new Error('Invalid measurement ID or date.')
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(modelId)) throw new Error('Use a model ID such as Qwen/Qwen3-8B.')
  if (modelRevision && !/^[a-f0-9]{40}$/i.test(modelRevision)) throw new Error('Model revision must be a complete 40-character commit hash, or blank.')
  if (r.loadState !== 'cold' && r.loadState !== 'warm') throw new Error('Choose cold or warm start.')
  if (r.outcome !== 'success' && r.outcome !== 'error') throw new Error('Choose success or error.')
  // Earlier v1 backups omitted promptTokens; absence means unknown, never context capacity.
  const row: BenchmarkRow = { id, date: new Date(date).toISOString(), modelId, modelRevision: modelRevision.toLowerCase(), runtime: field(r.runtime), runtimeVersion: field(r.runtimeVersion, 120, true), device: field(r.device), quantization: field(r.quantization), workload: field(r.workload, 240), loadState: r.loadState, outcome: r.outcome, context: number(r.context, 10_000_000, true, false)! , concurrency: number(r.concurrency, 10000, true, false)!, promptTokens: number(r.promptTokens === undefined ? null : r.promptTokens, 10_000_000, true, true, true), ttftMs: number(r.ttftMs, 86_400_000, false, true, true), decodeTokens: number(r.decodeTokens, 100_000_000, true), decodeSeconds: number(r.decodeSeconds, 86400), totalSeconds: number(r.totalSeconds, 86400), peakGiB: number(r.peakGiB, 1_000_000) }
  if (row.promptTokens !== null && row.promptTokens > row.context) throw new Error('Prompt tokens cannot exceed the recorded context capacity.')
  if ((row.decodeTokens === null) !== (row.decodeSeconds === null)) throw new Error('Enter both generated tokens and decode seconds, or leave both blank.')
  if (row.decodeSeconds !== null && row.decodeSeconds < 0.000001) throw new Error('Decode time must be at least one microsecond.')
  if (row.totalSeconds !== null && ((row.decodeSeconds ?? 0) > row.totalSeconds || (row.ttftMs ?? 0) / 1000 > row.totalSeconds)) throw new Error('Total time cannot be shorter than decode time or first-token time.')
  if (row.totalSeconds !== null && row.decodeSeconds !== null && row.ttftMs !== null && row.ttftMs / 1000 + row.decodeSeconds > row.totalSeconds + 1e-9 * Math.max(1, row.totalSeconds)) throw new Error('Total time cannot be shorter than first-token wait plus the decode interval.')
  return row
}
export function parseBenchmarks(value: unknown): BenchmarkRow[] {
  if (new TextEncoder().encode(JSON.stringify(value)).length > benchmarkByteLimit) throw new Error('Measurement backup exceeds 2 MB.')
  const data = record(value)
  if (data.version !== 1 || !Array.isArray(data.items) || data.items.length > 200) throw new Error('Unsupported measurement backup. Maximum 200 measurements.')
  const rows = data.items.map(parseBenchmark)
  if (new Set(rows.map(r => r.id)).size !== rows.length) throw new Error('Duplicate measurement IDs.')
  return rows
}
export function rawBenchmarks(): string { return localStorage.getItem(benchmarkStorageKey) ?? '{"version":1,"items":[]}' }
export function readBenchmarks(): BenchmarkRow[] { const raw = rawBenchmarks(); if (new TextEncoder().encode(raw).length > benchmarkByteLimit) throw new Error('Measurement backup exceeds 2 MB.'); return parseBenchmarks(JSON.parse(raw)) }
export function writeBenchmarks(rows: BenchmarkRow[]): BenchmarkRow[] { const valid = parseBenchmarks({ version: 1, items: rows }); localStorage.setItem(benchmarkStorageKey, JSON.stringify({ version: 1, items: valid })); return valid }
export function mergeBenchmarks(rows: BenchmarkRow[]): BenchmarkRow[] {
  const current = readBenchmarks()
  for (const row of parseBenchmarks({ version: 1, items: rows })) { const match = current.find(r => r.id === row.id); if (match && JSON.stringify(match) === JSON.stringify(row)) continue; current.push(match ? { ...row, id: crypto.randomUUID() } : row) }
  return writeBenchmarks(current)
}
export function decodeSpeed(row: BenchmarkRow): number | null { return row.outcome === 'success' && row.decodeTokens !== null && row.decodeSeconds !== null ? row.decodeTokens / row.decodeSeconds : null }
export function median(values: number[]): number | null { if (!values.length) return null; const s = [...values].sort((a, b) => a - b), mid = Math.floor(s.length / 2); return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2 }
export function comparisonKey(row: BenchmarkRow): string { return JSON.stringify([row.modelId, row.runtime, row.runtimeVersion, row.device, row.quantization, row.modelRevision, row.context, row.concurrency, row.loadState, row.workload, row.promptTokens]) }
export function summarizeBenchmarks(rows: BenchmarkRow[]) {
  const groups = new Map<string, BenchmarkRow[]>()
  // Missing revision, runtime version or actual input length cannot establish comparability.
  for (const row of rows) { const key = comparisonKey(row) + (!row.modelRevision || !row.runtimeVersion || row.promptTokens === null ? row.id : ''); groups.set(key, [...(groups.get(key) ?? []), row]) }
  return [...groups.entries()].map(([key, samples]) => {
    const success = samples.filter(r => r.outcome === 'success')
    const speeds = success.map(decodeSpeed).filter((n): n is number => n !== null), ttft = success.map(r => r.ttftMs).filter((n): n is number => n !== null)
    const peaks = success.map(r => r.peakGiB).filter((n): n is number => n !== null)
    return { key, sample: samples[0], count: samples.length, failures: samples.length - success.length, errorRate: (samples.length - success.length) / samples.length, speed: median(speeds), speedSamples: speeds.length, ttft: median(ttft), ttftSamples: ttft.length, peak: median(peaks), peakSamples: peaks.length }
  })
}
export function downloadBenchmarks(body: string) { const url = URL.createObjectURL(new Blob([body], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'sizeof-measurements.json'; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
