import type { ModelSpec } from '../data/models'
import {
  kvPrecisions,
  quantizations,
  type KvPrecisionId,
  type QuantizationId,
} from '../data/quantizations'

const BYTES_PER_GIB = 1024 ** 3

export interface EstimateOptions {
  quantization: QuantizationId
  context: number
  kvPrecision: KvPrecisionId
}

export interface VramEstimate {
  weightsGiB: number
  kvCacheGiB: number
  runtimeGiB: number
  totalGiB: number
  exceedsNativeContext: boolean
}

export type Fit = 'comfortable' | 'tight' | 'too-large'

export interface RankedModel {
  model: ModelSpec
  estimate: VramEstimate
  fit: Fit
  headroomGiB: number
}

export function estimateVram(model: ModelSpec, options: EstimateOptions): VramEstimate {
  if (!Number.isInteger(options.context) || options.context <= 0) {
    throw new Error('Context must be a positive integer')
  }

  const quantization = quantizations.find((item) => item.id === options.quantization)
  const kvPrecision = kvPrecisions.find((item) => item.id === options.kvPrecision)
  if (!quantization || !kvPrecision) throw new Error('Unknown precision')

  const weightsGiB =
    (model.parametersB * 1_000_000_000 * quantization.bitsPerWeight) / 8 / BYTES_PER_GIB
  const kvCacheGiB =
    (model.layers * model.kvHeads * model.headDim * 2 * options.context * kvPrecision.bytes) /
    BYTES_PER_GIB
  const runtimeGiB = (weightsGiB + kvCacheGiB) * 0.1 + 0.5

  return {
    weightsGiB,
    kvCacheGiB,
    runtimeGiB,
    totalGiB: weightsGiB + kvCacheGiB + runtimeGiB,
    exceedsNativeContext: options.context > model.maxContext,
  }
}

export function classifyFit(totalGiB: number, vramGiB: number): Fit {
  if (totalGiB > vramGiB) return 'too-large'
  if (totalGiB > vramGiB * 0.85) return 'tight'
  return 'comfortable'
}

export function rankModelsForVram(
  models: ModelSpec[],
  options: EstimateOptions & { vramGiB: number },
): RankedModel[] {
  return models
    .map((model) => {
      const estimate = estimateVram(model, options)
      return {
        model,
        estimate,
        fit: classifyFit(estimate.totalGiB, options.vramGiB),
        headroomGiB: options.vramGiB - estimate.totalGiB,
      }
    })
    .sort((a, b) => {
      const fitOrder: Record<Fit, number> = { comfortable: 0, tight: 1, 'too-large': 2 }
      const fitDelta = fitOrder[a.fit] - fitOrder[b.fit]
      if (fitDelta !== 0) return fitDelta
      return b.model.parametersB - a.model.parametersB
    })
}
