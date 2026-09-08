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
  it('does not relabel a fixed artifact as a different precision', () => {
    expect(findHighestPrecisionFit(model, {
      context: 4096, kvPrecision: 'fp16', weightBytesOverride: 1024 ** 3,
    }, 32)).toEqual({ kind: 'unavailable', reason: 'fixed-artifact-precision' })
  })
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

  it('refuses invalid geometry and never returns a non-finite estimate', () => {
    const invalidModels: ModelSpec[] = [
      { ...model, maxContext: Number.NaN },
      { ...model, maxContext: Number.POSITIVE_INFINITY },
      { ...model, maxContext: 0 },
      { ...model, parametersB: Number.NaN },
      { ...model, parametersB: Number.POSITIVE_INFINITY },
      { ...model, parametersB: 0 },
      { ...model, layers: Number.NaN },
      { ...model, layers: Number.POSITIVE_INFINITY },
      { ...model, layers: 0 },
      { ...model, kvHeads: 0 },
      { ...model, kvHeads: Number.NaN },
      { ...model, headDim: Number.POSITIVE_INFINITY },
      { ...model, kvCache: { kind: 'standard', heads: 0, headDim: 64 } },
      { ...model, kvCache: { kind: 'standard', heads: Number.POSITIVE_INFINITY, headDim: 64 } },
      { ...model, kvCache: {
        kind: 'mla', heads: 8, keyHeadDim: 64, valueHeadDim: 64, latentDim: 0, ropeDim: 8,
      } },
    ]

    for (const invalidModel of invalidModels) {
      expect(findMaximumSafeContext(invalidModel, {
        ...options,
        ...(invalidModel.kvCache?.kind === 'mla' ? { mlaCacheMode: 'expanded' as const } : {}),
      }, 32)).toEqual({ kind: 'unavailable', reason: 'missing-safe-geometry' })
      expect(findHighestPrecisionFit(invalidModel, {
        context: 4096,
        kvPrecision: 'fp16',
        ...(invalidModel.kvCache?.kind === 'mla' ? { mlaCacheMode: 'expanded' as const } : {}),
      }, 32)).toEqual({ kind: 'unavailable', reason: 'missing-safe-geometry' })
    }

    const available = findMaximumSafeContext(model, options, 10)
    expect(available.kind).toBe('available')
    if (available.kind === 'available') {
      expect(Object.values(available.estimate).filter((value) => typeof value === 'number')
        .every(Number.isFinite)).toBe(true)
    }
  })

  it('reports geometry failures separately from an ordinary no-fit result', () => {
    expect(findHighestPrecisionFit({ ...model, kvHeads: 0 }, {
      context: 4096, kvPrecision: 'fp16',
    }, 32)).toEqual({ kind: 'unavailable', reason: 'missing-safe-geometry' })
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
