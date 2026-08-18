import { describe, expect, it } from 'vitest'
import { estimateVram, rankModelsForVram } from './estimator'
import type { ModelSpec } from '../data/models'

const fixture: ModelSpec = {
  id: 'fixture-1b',
  name: 'Fixture 1B',
  family: 'Fixture',
  maker: 'Lab',
  parametersB: 1,
  layers: 10,
  kvHeads: 2,
  headDim: 64,
  maxContext: 8192,
  releaseYear: 2026,
  strengths: ['testing'],
  sourceUrl: 'https://example.com/model',
}

describe('estimateVram', () => {
  it('uses effective quantization bits for weight memory', () => {
    const result = estimateVram(fixture, {
      quantization: 'q4_k_m',
      context: 4096,
      kvPrecision: 'fp16',
    })

    expect(result.weightsGiB).toBeCloseTo(0.565, 3)
  })

  it('uses a detected variant file size instead of a hypothetical quantization', () => {
    const result = estimateVram(fixture, {
      quantization: 'q4_k_m',
      context: 4096,
      kvPrecision: 'fp16',
      weightBytesOverride: 2 * 1024 ** 3,
    })

    expect(result.baseWeightsGiB).toBe(2)
    expect(result.addonWeightsGiB).toBe(0)
    expect(result.weightsGiB).toBe(2)
  })

  it('adds an MTP sidecar to the selected base-model weights', () => {
    const result = estimateVram(fixture, {
      quantization: 'q4_k_m',
      context: 4096,
      kvPrecision: 'fp16',
      additionalWeightBytes: 256 * 1024 ** 2,
    })

    expect(result.baseWeightsGiB).toBeCloseTo(0.5646, 4)
    expect(result.addonWeightsGiB).toBe(0.25)
    expect(result.weightsGiB).toBeCloseTo(0.8146, 4)
  })

  it('calculates grouped-query KV cache independently from model weights', () => {
    const result = estimateVram(fixture, {
      quantization: 'q4_k_m',
      context: 4096,
      kvPrecision: 'fp16',
    })

    expect(result.kvCacheGiB).toBeCloseTo(0.0195, 4)
    expect(result.runtimeGiB).toBeCloseTo(0.5584, 4)
    expect(result.totalGiB).toBeCloseTo(1.1426, 4)
  })

  it('calculates an explicit standard KV cache layout with the legacy formula', () => {
    const result = estimateVram(
      { ...fixture, kvCache: { kind: 'standard', heads: 2, headDim: 64 } },
      { quantization: 'q4_k_m', context: 4096, kvPrecision: 'fp16' },
    )

    expect(result.kvCacheGiB).toBeCloseTo(0.0195, 4)
  })

  it('uses only full-attention layers for hybrid model KV cache', () => {
    const result = estimateVram(
      { ...fixture, attentionLayers: 2 },
      { quantization: 'q4_k_m', context: 4096, kvPrecision: 'fp16' },
    )

    expect(result.kvCacheGiB).toBeCloseTo(0.00390625, 7)
  })

  it('makes the engine-dependent MLA cache layout explicit', () => {
    const model: ModelSpec = {
      ...fixture,
      layers: 93,
      attentionLayers: 24,
      kvCache: {
        kind: 'mla',
        heads: 96,
        keyHeadDim: 192,
        valueHeadDim: 128,
        latentDim: 512,
        ropeDim: 64,
      },
    }

    const expanded = estimateVram(model, {
      quantization: 'q4_k_m', context: 8192, kvPrecision: 'fp16', mlaCacheMode: 'expanded',
    })
    const latent = estimateVram(model, {
      quantization: 'q4_k_m', context: 8192, kvPrecision: 'fp16', mlaCacheMode: 'latent',
    })

    expect(expanded.kvCacheGiB).toBeCloseTo(11.25, 7)
    expect(latent.kvCacheGiB).toBeCloseTo(0.2109375, 7)
    expect(() => estimateVram(model, {
      quantization: 'q4_k_m', context: 8192, kvPrecision: 'fp16',
    })).toThrow('MLA cache mode is required')
  })

  it('reports requests beyond the model native context', () => {
    const result = estimateVram(fixture, {
      quantization: 'q8_0',
      context: 16384,
      kvPrecision: 'q8_0',
    })

    expect(result.exceedsNativeContext).toBe(true)
  })

  it('rejects invalid context sizes', () => {
    expect(() =>
      estimateVram(fixture, {
        quantization: 'q4_k_m',
        context: 0,
        kvPrecision: 'fp16',
      }),
    ).toThrow('Context must be a positive integer')
  })
})

describe('rankModelsForVram', () => {
  const larger: ModelSpec = { ...fixture, id: 'larger', name: 'Larger', parametersB: 3 }

  it('ranks the strongest model that fits with usable headroom first', () => {
    const results = rankModelsForVram([fixture, larger], {
      vramGiB: 3,
      context: 4096,
      quantization: 'q4_k_m',
      kvPrecision: 'fp16',
    })

    expect(results[0]?.model.id).toBe('larger')
    expect(results[0]?.fit).toBe('comfortable')
  })

  it('marks an estimate over budget as too large', () => {
    const results = rankModelsForVram([larger], {
      vramGiB: 1,
      context: 4096,
      quantization: 'q8_0',
      kvPrecision: 'fp16',
    })

    expect(results[0]?.fit).toBe('too-large')
  })
})
