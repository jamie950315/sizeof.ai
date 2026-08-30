import { describe, expect, it } from 'vitest'
import type { ModelSpec } from '../data/models'
import {
  buildFitAdjustments,
  findHighestPrecisionFit,
  findMaximumSafeContext,
} from './planner'

const model: ModelSpec = {
  id: 'planner-fixture', name: 'Planner Fixture', family: 'Test', maker: 'Lab',
  parametersB: 1, layers: 10, kvHeads: 2, headDim: 64, maxContext: 8192,
  releaseYear: 2026, strengths: [], sourceUrl: 'https://example.com/model',
}

const options = { quantization: 'q4_k_m' as const, kvPrecision: 'fp16' as const }

describe('inverse fit planner', () => {
  it('finds the exact greatest 1024-aligned context and respects native context', () => {
    const at4096 = findMaximumSafeContext(model, options, 1.142578125)
    const justOver = findMaximumSafeContext(model, options, 1.1425)
    const nativeCapped = findMaximumSafeContext({ ...model, maxContext: 5000 }, options, 10)

    expect(at4096).toMatchObject({ kind: 'available', context: 4096 })
    expect(justOver).toMatchObject({ kind: 'available', context: 3072 })
    expect(nativeCapped).toMatchObject({ kind: 'available', context: 4096 })
  })

  it('refuses unsafe inputs and models that cannot make a safe geometry claim', () => {
    expect(findMaximumSafeContext(model, options, 0)).toEqual({ kind: 'unavailable', reason: 'invalid-capacity' })
    expect(findMaximumSafeContext({ ...model, estimateConfidence: 'runtime-specific' }, options, 32))
      .toEqual({ kind: 'unavailable', reason: 'runtime-specific' })
    expect(findMaximumSafeContext({ ...model, estimateConfidence: 'weights-only' }, options, 32))
      .toEqual({ kind: 'unavailable', reason: 'weights-only' })
    expect(findMaximumSafeContext({ ...model, parametersB: 100 }, options, 1))
      .toEqual({ kind: 'unavailable', reason: 'weights-do-not-fit' })
    expect(findMaximumSafeContext({ ...model, kvCache: {
      kind: 'mla', heads: 8, keyHeadDim: 64, valueHeadDim: 64, latentDim: 32, ropeDim: 8,
    } }, options, 32)).toEqual({ kind: 'unavailable', reason: 'mla-mode-required' })
  })

  it('uses estimator overrides and addon weights rather than duplicating its formula', () => {
    expect(findMaximumSafeContext(model, {
      ...options, weightBytesOverride: 1024 ** 3, additionalWeightBytes: 512 * 1024 ** 2,
    }, 1.7)).toEqual({ kind: 'unavailable', reason: 'weights-do-not-fit' })
  })

  it('returns the highest existing weight precision that fits or no fit', () => {
    expect(findHighestPrecisionFit(model, { context: 4096, kvPrecision: 'fp16' }, 1.5))
      .toMatchObject({ kind: 'available', quantization: 'q6_k' })
    expect(findHighestPrecisionFit(model, { context: 4096, kvPrecision: 'fp16' }, 0.1))
      .toEqual({ kind: 'unavailable', reason: 'no-precision-fits' })
  })

  it('suggests independently verifiable adjustments in context, KV, then weight order', () => {
    const adjustments = buildFitAdjustments(model, {
      quantization: 'q8_0', context: 8192, kvPrecision: 'fp16', capacityGiB: 1.61,
    })

    expect(adjustments.map((adjustment) => adjustment.field)).toEqual([
      'context', 'kvPrecision', 'quantization',
    ])
    expect(adjustments.every((adjustment) => adjustment.estimate.totalGiB <= 1.61)).toBe(true)
    expect(buildFitAdjustments(model, {
      quantization: 'q4_k_m', context: 4096, kvPrecision: 'fp16', capacityGiB: 2,
    })).toEqual([])
  })
})
