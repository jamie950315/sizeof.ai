import { beforeEach, describe, expect, it } from 'vitest'
import { decodeSpeed, mergeBenchmarks, readBenchmarks, summarizeBenchmarks } from './benchmark'
import { materializeBenchmarkImport, parseBenchmarkResult, type BenchmarkImportSetup } from './benchmark-import'

// Synthetic values in the real schema, not claimed hardware measurements.
// Sources: https://github.com/vllm-project/vllm/blob/main/vllm/benchmarks/serve.py
// https://github.com/ggml-org/llama.cpp/blob/master/tools/llama-bench/llama-bench.cpp
const fixture = () => ({ completed: 2, failed: 1, input_lens: [64, 64, 64], output_lens: [5, 1, 0], ttfts: [0.5, 0.25, 0], latencies: [1.5, 0.25, 0], errors: ['', '', 'private error text'], generated_texts: ['private answer', '', ''], mean_ttft_ms: 375 })
const setup: BenchmarkImportSetup = { modelId: 'owner/model', runtimeVersion: '', modelRevision: '', device: 'test device', quantization: 'test file', context: 4096, concurrency: 1, loadState: 'warm', workload: 'fixed synthetic prompt set', date: '2026-09-08T00:00:00Z' }
const preview = (data: unknown) => parseBenchmarkResult(JSON.stringify(data))
beforeEach(() => localStorage.clear())
describe('real benchmark result formats', () => {
  it('imports aligned request observations, subtracts first token, converts seconds and retains failures', () => {
    const result = preview(fixture()), rows = materializeBenchmarkImport(result, setup, 'batch')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ promptTokens: 64, ttftMs: 500, decodeTokens: 4, decodeSeconds: 1, totalSeconds: 1.5, peakGiB: null })
    expect(decodeSpeed(rows[0])).toBe(4)
    expect(rows[1]).toMatchObject({ decodeTokens: null, decodeSeconds: null, ttftMs: 250 })
    expect(rows[2]).toMatchObject({ outcome: 'error', totalSeconds: null, ttftMs: null })
    expect(JSON.stringify(rows)).not.toMatch(/private/)
  })
  it('does not interpret a zero TTFT default as instant streaming', () => {
    const data = fixture(); data.ttfts[0] = 0
    expect(preview(data).samples[0]).toMatchObject({ ttftMs: null, decodeTokens: null, decodeSeconds: null })
  })
  it('accepts llama-bench generation raw repetitions without fabricating request metrics', () => {
    const result = preview([{ n_prompt: 0, n_gen: 128, n_depth: 0, samples_ns: [2_000_000_000, 4_000_000_000], avg_ts: 48 }])
    const rows = materializeBenchmarkImport(result, setup, 'llama-batch')
    expect(rows).toHaveLength(2); expect(decodeSpeed(rows[0])).toBe(64)
    expect(rows[0]).toMatchObject({ runtime: 'llama-bench', ttftMs: null, totalSeconds: null, promptTokens: 0 })
    expect(rows[0].workload).toContain('llama-bench')
  })
  it.each([{ n_prompt: 512, n_gen: 128 }, { n_prompt: 512, n_gen: 0 }, { n_prompt: 0, n_gen: 128, n_depth: 32 }])('rejects llama-bench unsupported phase %j', fields => {
    expect(() => preview([{ ...fields, samples_ns: [1000000] }])).toThrow(/generation-only/)
  })
  it('rejects aggregates instead of inventing attempts', () => {
    expect(() => preview({ completed: 100, mean_ttft_ms: 10 })).toThrow(/aggregate-only/)
    expect(() => preview([{ n_prompt: 0, n_gen: 128, n_depth: 0, avg_ns: 1000000 }])).toThrow(/raw samples_ns/)
  })
  it('rejects incomplete arrays and inconsistent counts', () => {
    expect(() => preview({ ...fixture(), ttfts: [1] })).toThrow(/different lengths/)
    expect(() => preview({ ...fixture(), completed: 3 })).toThrow(/counts disagree/)
    expect(() => preview({ ...fixture(), failed: 0 })).toThrow(/counts disagree/)
  })
  it.each(['latencies', 'input_lens', 'output_lens', 'ttfts', 'errors'])('requires %s', key => {
    const data = { ...fixture(), [key]: undefined }; expect(() => preview(data)).toThrow(/Unsupported/)
  })
  it('rejects invalid values and timing', () => {
    expect(() => preview({ ...fixture(), latencies: [0.1, 0.25, 0] })).toThrow(/invalid token counts or timing/)
    expect(() => preview({ ...fixture(), output_lens: [5.1, 1, 0] })).toThrow(/integer/)
    expect(() => preview({ ...fixture(), output_lens: [5, 1, 2] })).toThrow(/Failed request/)
    expect(() => preview({ ...fixture(), ttfts: [-1, 0.25, 0] })).toThrow(/non-negative/)
    expect(() => preview([{ n_prompt: 0, n_gen: 128, n_depth: 0, samples_ns: [0] }])).toThrow()
  })
  it('bounds files, rows and notebook values', () => {
    expect(() => parseBenchmarkResult(' '.repeat(2 * 1024 * 1024 + 1))).toThrow(/2 MB/)
    expect(() => preview([{ n_prompt: 0, n_gen: 128, n_depth: 0, samples_ns: Array(201).fill(10000) }])).toThrow(/1–200/)
    expect(() => preview({ ...fixture(), input_lens: [10_000_001, 64, 64] })).toThrow(/limits/)
  })
  it('rejects JSONL, bad JSON, multiple llama configs and invalid setup without saving', () => {
    expect(() => parseBenchmarkResult('{}\n{}')).toThrow(/valid JSON/)
    expect(() => preview([{}, {}])).toThrow(/one configuration/)
    expect(() => materializeBenchmarkImport(preview(fixture()), { ...setup, context: 32 })).toThrow(/Prompt tokens/)
    expect(() => materializeBenchmarkImport(preview(fixture()), { ...setup, workload: '' })).toThrow(/workload/)
    expect(readBenchmarks()).toEqual([])
  })
  it('merges against current storage without overwriting existing records, isolates separate imports', () => {
    const result = preview(fixture()), first = materializeBenchmarkImport(result, setup, 'first'), second = materializeBenchmarkImport(result, setup, 'second')
    mergeBenchmarks(first); mergeBenchmarks(second)
    expect(readBenchmarks()).toHaveLength(6); expect(readBenchmarks()[0]).toEqual(first[0])
    expect(first[0].workload).not.toEqual(second[0].workload)
    mergeBenchmarks(first); expect(readBenchmarks()).toHaveLength(6)
  })
  it('preserves storage when an import would exceed capacity', () => {
    const result = preview([{ n_prompt: 0, n_gen: 128, n_depth: 0, samples_ns: Array(200).fill(1000000) }])
    const rows = materializeBenchmarkImport(result, setup, 'full'); mergeBenchmarks(rows)
    expect(() => mergeBenchmarks(materializeBenchmarkImport(preview(fixture()), setup, 'extra'))).toThrow(/200/)
    expect(readBenchmarks()).toEqual(rows)
  })
  it('does not mislabel llama-bench repetitions as concurrent requests', () => {
    const result = preview([{ n_prompt: 0, n_gen: 128, n_depth: 0, samples_ns: [1000000] }])
    expect(() => materializeBenchmarkImport(result, { ...setup, concurrency: 2 })).toThrow(/single-sequence/)
    expect(() => materializeBenchmarkImport(result, { ...setup, context: 64 })).toThrow(/context/)
  })
  it('groups same-source generation repetitions only when model and runtime versions are known', () => {
    const result = preview([{ n_prompt: 0, n_gen: 128, n_depth: 0, samples_ns: [2_000_000_000, 4_000_000_000] }])
    const knownSetup = { ...setup, runtimeVersion: 'b12345', modelRevision: 'a'.repeat(40) }
    const first = materializeBenchmarkImport(result, knownSetup, 'first')
    const groups = summarizeBenchmarks(first)
    expect(groups).toHaveLength(1); expect(groups[0]).toMatchObject({ speed: 48, speedSamples: 2, count: 2 })
    expect(summarizeBenchmarks([...first, ...materializeBenchmarkImport(result, knownSetup, 'second')])).toHaveLength(2)
    expect(summarizeBenchmarks(materializeBenchmarkImport(result, setup, 'unknown'))).toHaveLength(2)
  })
  it('rejects older llama-bench results with missing depth instead of assuming zero', () => {
    expect(() => preview([{ n_prompt: 0, n_gen: 128, samples_ns: [1000000] }])).toThrow(/explicit n_prompt=0 and n_depth=0/)
  })
})
