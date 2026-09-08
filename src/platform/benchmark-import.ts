import { benchmarkByteLimit, parseBenchmark, type BenchmarkRow } from './benchmark'

export const benchmarkImportSource = 'https://github.com/vllm-project/vllm/blob/main/vllm/benchmarks/serve.py'
export const llamaBenchImportSource = 'https://github.com/ggml-org/llama.cpp/blob/master/tools/llama-bench/llama-bench.cpp'
export type ImportedMeasurement = Pick<BenchmarkRow, 'outcome' | 'promptTokens' | 'ttftMs' | 'decodeTokens' | 'decodeSeconds' | 'totalSeconds' | 'peakGiB'>
export interface BenchmarkImportPreview { format: 'vLLM detailed JSON' | 'llama-bench generation JSON'; samples: ImportedMeasurement[]; warnings: string[] }
export type BenchmarkImportSetup = Pick<BenchmarkRow, 'modelId' | 'runtimeVersion' | 'modelRevision' | 'device' | 'quantization' | 'context' | 'concurrency' | 'loadState' | 'workload' | 'date'>
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a vLLM object or a llama-bench array with one generation test. Notebook backups use the separate backup importer.')
  return value as Record<string, unknown>
}
function numeric(value: unknown, name: string, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) throw new Error(`Invalid ${name}: expected a finite non-negative ${integer ? 'integer' : 'number'}.`)
  return value
}
export function parseBenchmarkResult(body: string): BenchmarkImportPreview {
  if (new TextEncoder().encode(body).length > benchmarkByteLimit) throw new Error('Result file exceeds 2 MB.')
  let parsed: unknown
  try { parsed = JSON.parse(body) } catch { throw new Error('Result must be valid JSON, not console text, CSV, or JSONL.') }
  if (Array.isArray(parsed)) {
    if (parsed.length !== 1) throw new Error('llama-bench import requires exactly one configuration. Export one generation-only test with -p 0 and -o json.')
    const test = record(parsed[0])
    if (test.n_prompt !== 0 || test.n_depth !== 0 || numeric(test.n_gen, 'n_gen', true) < 1) throw new Error('Only llama-bench generation-only tests with explicit n_prompt=0 and n_depth=0 are supported. Older formats missing these fields, prefill, mixed and depth tests must not be relabeled as decode.')
    if (!Array.isArray(test.samples_ns) || !test.samples_ns.length || test.samples_ns.length > 200) throw new Error('llama-bench needs 1–200 raw samples_ns. Aggregate-only results cannot become repetitions.')
    const samples = test.samples_ns.map((ns, i): ImportedMeasurement => {
      const sample: ImportedMeasurement = { outcome: 'success', promptTokens: 0, ttftMs: null, decodeTokens: test.n_gen as number, decodeSeconds: numeric(ns, 'samples_ns', true) / 1e9, totalSeconds: null, peakGiB: null }
      parseBenchmark({ ...sample, id: `preview-${i}`, date: '2026-01-01T00:00:00Z', modelId: 'preview/model', runtime: 'llama-bench', runtimeVersion: '', modelRevision: '', device: 'preview', quantization: 'preview', context: 10_000_000, concurrency: 1, loadState: 'warm', workload: 'preview' })
      return sample
    })
    return { format: 'llama-bench generation JSON', samples, warnings: ['These are successful generation microbenchmark repetitions, not HTTP requests or a failure-rate survey. Aborted runs are not represented.', 'The raw nanosecond interval covers n_gen single-token decode operations; no first-token wait, request-total time or peak memory is reported.', 'Prompt count 0 is the explicit n_prompt=0 benchmark setting, not a count from an HTTP request. Zero depth is also required. Confirm one exact model, runtime build, hardware and benchmark settings; no file paths or source text are saved.'] }
  }
  const data = record(parsed)
  const fields = ['input_lens', 'output_lens', 'ttfts', 'latencies', 'errors'] as const
  if (!fields.every(key => Array.isArray(data[key]))) throw new Error('Unsupported or aggregate-only result. Export vLLM with --save-result --save-detailed; input_lens, output_lens, ttfts, latencies and errors must all be present. Averages and percentiles cannot become individual attempts.')
  const arrays = Object.fromEntries(fields.map(key => [key, data[key]])) as Record<typeof fields[number], unknown[]>
  const count = arrays.input_lens.length
  if (!count || count > 200) throw new Error('Import requires 1–200 individual requests; split larger runs outside this site.')
  if (fields.some(key => arrays[key].length !== count)) throw new Error('Detailed arrays have different lengths. No requests were imported.')
  const completed = numeric(data.completed, 'completed', true)
  const samples = arrays.input_lens.map((value, i): ImportedMeasurement => {
    const promptTokens = numeric(value, 'input_lens', true), output = numeric(arrays.output_lens[i], 'output_lens', true)
    const ttft = numeric(arrays.ttfts[i], 'ttfts'), latency = numeric(arrays.latencies[i], 'latencies')
    if (typeof arrays.errors[i] !== 'string') throw new Error('Every errors entry must be a string.')
    const failed = (arrays.errors[i] as string).length > 0
    if (failed && output !== 0) throw new Error('Failed request has nonzero output_lens; this result does not match the supported vLLM schema.')
    if (!failed && (output < 1 || latency <= 0 || ttft > latency)) throw new Error('Successful request has invalid token counts or timing.')
    // vLLM uses (latency - ttft)/(output_len - 1). Zero TTFT is also a
    // non-streaming default, so it never establishes a decode interval here.
    const decode = !failed && ttft > 0 && output > 1 && latency > ttft
    const row: ImportedMeasurement = { outcome: failed ? 'error' : 'success', promptTokens, ttftMs: !failed && ttft > 0 ? ttft * 1000 : null, decodeTokens: decode ? output - 1 : null, decodeSeconds: decode ? latency - ttft : null, totalSeconds: !failed ? latency : null, peakGiB: null }
    // Apply notebook limits during preview, not only after confirmation.
    parseBenchmark({ ...row, id: `preview-${i}`, date: '2026-01-01T00:00:00Z', modelId: 'preview/model', runtime: 'vLLM', runtimeVersion: '', modelRevision: '', device: 'preview', quantization: 'preview', context: 10_000_000, concurrency: 1, loadState: 'warm', workload: 'preview' })
    return row
  })
  const successCount = samples.filter(s => s.outcome === 'success').length
  if (completed !== successCount || (data.failed !== undefined && numeric(data.failed, 'failed', true) !== count - successCount)) throw new Error('Summary counts disagree with detailed request outcomes. Import stopped.')
  return { format: 'vLLM detailed JSON', samples, warnings: ['Counts and timings are reported by the benchmark, not independently verified. Some vLLM backends re-tokenize output; their counts may differ from server usage.', 'Decode uses the vLLM output-minus-one convention, not throughput from averages. Zero TTFT stays unknown. Do not use this for non-streaming or multi-token first-chunk output.', 'Generated text, prompts, error messages and source paths are not saved. Missing memory measurements stay unknown. Run date and setup must be confirmed below.'] }
}
export function materializeBenchmarkImport(preview: BenchmarkImportPreview, setup: BenchmarkImportSetup, batchId: string = crypto.randomUUID()): BenchmarkRow[] {
  if (!setup.workload.trim() || setup.workload.length > 170) throw new Error('Describe the exact workload and settings using 1–170 characters.')
  if (preview.format === 'llama-bench generation JSON' && (setup.concurrency !== 1 || preview.samples.some(sample => (sample.decodeTokens ?? 0) > setup.context))) throw new Error('This llama-bench format is a single-sequence test: concurrency must be 1 and context must hold n_gen tokens.')
  // A per-import identity isolates unverifiable source settings across imports.
  const runtime = preview.format === 'vLLM detailed JSON' ? 'vLLM' : 'llama-bench'
  return preview.samples.map((sample, i) => parseBenchmark({ ...setup, ...sample, runtime, workload: `[${runtime} ${batchId}] ${setup.workload}`, id: `${batchId}-${i}` }))
}
