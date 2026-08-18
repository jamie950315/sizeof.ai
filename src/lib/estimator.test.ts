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
