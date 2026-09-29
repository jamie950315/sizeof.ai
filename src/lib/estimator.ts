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
  mlaCacheMode?: 'expanded' | 'latent'
  weightBytesOverride?: number
  additionalWeightBytes?: number
}

export interface VramEstimate {
  baseWeightsGiB: number
  addonWeightsGiB: number
  weightsGiB: number
  kvCacheGiB: number
  runtimeGiB: number
  totalGiB: number
  exceedsNativeContext: boolean
  isLowerBound: boolean
}

export type Fit = 'comfortable' | 'tight' | 'too-large'

export interface RankedModel {
  model: ModelSpec
  estimate: VramEstimate
  fit: Fit
  headroomGiB: number
}

export function estimateVram(model: ModelSpec, options: EstimateOptions): VramEstimate {
  if (!Number.isSafeInteger(options.context) || options.context <= 0) {
    throw new Error('Context must be a positive integer')
  }

  const quantization = quantizations.find((item) => item.id === options.quantization)
  const kvPrecision = kvPrecisions.find((item) => item.id === options.kvPrecision)
  if (!quantization || !kvPrecision) throw new Error('Unknown precision')
  if (!Number.isFinite(model.parametersB) || model.parametersB <= 0) throw new Error('Invalid model parameter count')
  if (!Number.isSafeInteger(model.layers) || model.layers <= 0
    || !Number.isSafeInteger(model.maxContext) || model.maxContext <= 0) throw new Error('Invalid model geometry')
  if (options.weightBytesOverride !== undefined
    && (!Number.isFinite(options.weightBytesOverride) || options.weightBytesOverride <= 0)) throw new Error('Invalid artifact weight size')
  if (options.additionalWeightBytes !== undefined
    && (!Number.isFinite(options.additionalWeightBytes) || options.additionalWeightBytes < 0)) throw new Error('Invalid additional weight size')

  const baseWeightsGiB = options.weightBytesOverride !== undefined
    ? options.weightBytesOverride / BYTES_PER_GIB
    : (model.parametersB * 1_000_000_000 * quantization.bitsPerWeight) / 8 / BYTES_PER_GIB
  const addonWeightsGiB = (options.additionalWeightBytes ?? 0) / BYTES_PER_GIB
  const weightsGiB = baseWeightsGiB + addonWeightsGiB
  if (model.kvCache?.kind === 'mla' && !options.mlaCacheMode) {
    throw new Error('MLA cache mode is required')
  }
  const dimensions = model.kvCache?.kind === 'mla'
    ? [model.kvCache.heads, model.kvCache.keyHeadDim, model.kvCache.valueHeadDim, model.kvCache.latentDim, model.kvCache.ropeDim]
    : model.kvCache?.kind === 'standard'
      ? [model.kvCache.heads, model.kvCache.headDim]
      : [model.kvHeads, model.headDim]
  if (!dimensions.every((value) => Number.isSafeInteger(value) && value! > 0)) throw new Error('Unknown KV cache layout')
  if (options.mlaCacheMode !== undefined && options.mlaCacheMode !== 'expanded' && options.mlaCacheMode !== 'latent') {
    throw new Error('Unknown MLA cache mode')
  }

  const kvElementsPerLayer = model.kvCache?.kind === 'mla'
    ? options.mlaCacheMode === 'latent'
      ? model.kvCache.latentDim + model.kvCache.ropeDim
      : model.kvCache.heads * (model.kvCache.keyHeadDim + model.kvCache.valueHeadDim)
    : model.kvCache?.kind === 'standard'
      ? model.kvCache.heads * model.kvCache.headDim * 2
      : (model.kvHeads ?? 0) * (model.headDim ?? 0) * 2

  if (!Number.isSafeInteger(kvElementsPerLayer) || kvElementsPerLayer <= 0) throw new Error('Unknown KV cache layout')

  const fullAttentionLayers = model.attentionProfile?.fullLayers
    ?? model.attentionLayers
    ?? model.layers
  const slidingLayers = model.attentionProfile?.slidingLayers ?? 0
  if (!Number.isSafeInteger(fullAttentionLayers) || fullAttentionLayers < 0
    || !Number.isSafeInteger(slidingLayers) || slidingLayers < 0
    || fullAttentionLayers + slidingLayers > model.layers) throw new Error('Invalid attention layer count')
  if (model.attentionProfile?.slidingWindow != null
    && (!Number.isSafeInteger(model.attentionProfile.slidingWindow) || model.attentionProfile.slidingWindow <= 0)) {
    throw new Error('Invalid sliding attention window')
  }
  const slidingAttentionTokens = model.attentionProfile?.slidingLayers
    ? model.attentionProfile.slidingLayers * Math.min(
        options.context,
        model.attentionProfile.slidingWindow ?? options.context,
      )
    : 0
  const kvCacheGiB =
    ((fullAttentionLayers * options.context + slidingAttentionTokens) *
      kvElementsPerLayer *
      kvPrecision.bytes) /
    BYTES_PER_GIB
  const runtimeGiB = (weightsGiB + kvCacheGiB) * 0.1 + 0.5
  if (!Number.isFinite(weightsGiB + kvCacheGiB + runtimeGiB)) throw new Error('Memory estimate exceeds numeric limits')

  return {
    baseWeightsGiB,
    addonWeightsGiB,
    weightsGiB,
    kvCacheGiB,
    runtimeGiB,
    totalGiB: weightsGiB + kvCacheGiB + runtimeGiB,
    exceedsNativeContext: options.context > model.maxContext,
    isLowerBound: model.estimateConfidence === 'runtime-specific',
  }
}

export function classifyFit(totalGiB: number, vramGiB: number): Fit {
  if (!Number.isFinite(totalGiB) || totalGiB < 0 || !Number.isFinite(vramGiB) || vramGiB <= 0) {
    throw new Error('Fit requires finite memory and positive capacity')
  }
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
