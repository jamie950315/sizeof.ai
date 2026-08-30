import { describe, expect, it } from 'vitest'
import { estimateVram } from './estimator'
import { estimateServingScenario } from './serving-estimator'
import type { ModelSpec } from '../data/models'

const model: ModelSpec = {
  id: 'serving-test', name: 'Serving test', family: 'test', maker: 'test', parametersB: 8,
  layers: 32, attentionLayers: 32, kvHeads: 8, headDim: 128, maxContext: 8192,
  releaseYear: 2026, strengths: [], sourceUrl: 'https://example.test/model', estimateConfidence: 'safe',
}

const baseInput = {
  profileId: 'vllm' as const,
  promptTokens: 1024,
  maxGeneratedTokens: 512,
  concurrency: 1,
  artifactFormat: null,
  hardwareKind: 'discrete-gpu' as const,
  quantization: 'q4_k_m' as const,
  kvPrecision: 'fp16' as const,
}

describe('serving scenario estimator', () => {
  it('keeps the single-sequence components at concurrency one and marks prefill as unknown', () => {
    const ordinary = estimateVram(model, { quantization: 'q4_k_m', kvPrecision: 'fp16', context: 1536 })
    const result = estimateServingScenario(model, baseInput)

    expect(result).toMatchObject({
      kind: 'lower-bound',
      profile: { id: 'vllm', reviewedAt: '2026-08-30', sourceUrl: expect.stringMatching(/^https:/) },
      inputs: {
        profileId: 'vllm', promptTokens: 1024, maxGeneratedTokens: 512, concurrency: 1,
        quantization: 'q4_k_m', kvPrecision: 'fp16', mlaCacheMode: null,
        weightBytesOverride: null, additionalWeightBytes: null, artifactFormat: null, hardwareKind: 'discrete-gpu',
      },
      prefillPeakGiB: null,
    })
    expect(result.components).toMatchObject({
      weightsGiB: ordinary.weightsGiB,
      runtimeGiB: ordinary.runtimeGiB,
      perRequestKvGiB: ordinary.kvCacheGiB,
      totalConcurrentKvGiB: ordinary.kvCacheGiB,
      decodeResidentGiB: ordinary.totalGiB,
    })
    expect(JSON.stringify(result)).not.toMatch(/throughput|tokensPer|latency|speed|uncertainty|workspace|prefillPeakGiB":\d/i)
  })

  it('scales only per-request KV cache with concurrency and never resident weights', () => {
    const single = estimateServingScenario(model, baseInput)
    const concurrent = estimateServingScenario(model, { ...baseInput, concurrency: 4 })

    expect(concurrent.components?.weightsGiB).toBe(single.components?.weightsGiB)
    expect(concurrent.components?.runtimeGiB).toBe(single.components?.runtimeGiB)
    expect(concurrent.components?.totalConcurrentKvGiB).toBe((single.components?.perRequestKvGiB ?? 0) * 4)
    expect(concurrent.components?.decodeResidentGiB).toBe(
      (single.components?.weightsGiB ?? 0) + (single.components?.runtimeGiB ?? 0) + (concurrent.components?.totalConcurrentKvGiB ?? 0),
    )
  })

  it.each([
    [{ ...baseInput, promptTokens: 0 }, /positive integer/i],
    [{ ...baseInput, concurrency: 257 }, /1 and 256/i],
    [{ ...baseInput, promptTokens: 8000, maxGeneratedTokens: 193 }, /native context/i],
    [{ ...baseInput, maxGeneratedTokens: 1.5 }, /positive integer/i],
  ])('rejects invalid bounded workload inputs', (input, message) => {
    expect(() => estimateServingScenario(model, input)).toThrow(message)
  })

  it('refuses runtime-specific and weights-only architectures without inventing a serving total', () => {
    const runtimeSpecific = estimateServingScenario({ ...model, estimateConfidence: 'runtime-specific' }, baseInput)
    const weightsOnly = estimateServingScenario({ ...model, estimateConfidence: 'weights-only' }, baseInput)

    expect(runtimeSpecific).toMatchObject({ kind: 'unavailable', components: null, prefillPeakGiB: null })
    expect(weightsOnly).toMatchObject({ kind: 'weights-only', components: { decodeResidentGiB: null, perRequestKvGiB: null }, prefillPeakGiB: null })
  })

  it('refuses stateful architecture facts even when confidence is absent or incorrectly safe', () => {
    const statefulAttention = { fullLayers: 32, slidingLayers: 0, linearLayers: 0, kdaLayers: 0, recurrentLayers: 0, ssmLayers: 32, slidingWindow: null, stateKind: 'mamba' as const }

    for (const estimateConfidence of [undefined, 'safe'] as const) {
      const result = estimateServingScenario({ ...model, estimateConfidence, attentionProfile: statefulAttention }, baseInput)
      expect(result).toMatchObject({ kind: 'unavailable', components: null, applicability: { applicable: false } })
    }
  })

  it('preserves exact estimator inputs and addon weights without forbidden serving claims', () => {
    const q4 = estimateServingScenario(model, { ...baseInput, additionalWeightBytes: 512 * 1024 ** 2 })
    const q8 = estimateServingScenario(model, {
      ...baseInput, quantization: 'q8_0', kvPrecision: 'q8_0', mlaCacheMode: 'expanded',
      weightBytesOverride: 20 * 1024 ** 3, additionalWeightBytes: 512 * 1024 ** 2,
      artifactFormat: 'safetensors', hardwareKind: 'unified-memory', batchLabel: 'batch-a',
    })

    expect(q4.components?.addonWeightsGiB).toBeCloseTo(0.5)
    expect(q4.inputs).not.toEqual(q8.inputs)
    expect(q8.inputs).toEqual({
      profileId: 'vllm', promptTokens: 1024, maxGeneratedTokens: 512, concurrency: 1, batchLabel: 'batch-a',
      quantization: 'q8_0', kvPrecision: 'q8_0', mlaCacheMode: 'expanded',
      weightBytesOverride: 20 * 1024 ** 3, additionalWeightBytes: 512 * 1024 ** 2,
      artifactFormat: 'safetensors', hardwareKind: 'unified-memory',
    })
    expect(JSON.stringify(q8)).not.toMatch(/latency|speed|uncertainty|workspace|throughput/i)
  })
})
