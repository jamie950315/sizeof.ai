import type { ModelSpec } from '../data/models'
import { quantizations, type KvPrecisionId, type QuantizationId } from '../data/quantizations'
import { estimateVram, type EstimateOptions, type VramEstimate } from './estimator'

export type EstimateOptionsWithoutContext = Omit<EstimateOptions, 'context'>

export type PlannerUnavailableReason =
  | 'invalid-capacity'
  | 'runtime-specific'
  | 'weights-only'
  | 'missing-safe-geometry'
  | 'mla-mode-required'
  | 'native-context-too-small'
  | 'weights-do-not-fit'
  | 'no-precision-fits'

export type MaximumSafeContextResult =
  | { kind: 'available'; context: number; estimate: VramEstimate }
  | { kind: 'unavailable'; reason: Exclude<PlannerUnavailableReason, 'no-precision-fits'> }

export type HighestPrecisionFitResult =
  | { kind: 'available'; quantization: QuantizationId; estimate: VramEstimate }
  | {
      kind: 'unavailable'
      reason:
        | 'invalid-capacity'
        | 'runtime-specific'
        | 'weights-only'
        | 'missing-safe-geometry'
        | 'mla-mode-required'
        | 'native-context-too-small'
        | 'no-precision-fits'
    }

export interface FitAdjustment {
  field: 'context' | 'kvPrecision' | 'quantization'
  value: number | KvPrecisionId | QuantizationId
  estimate: VramEstimate
}

export interface FitAdjustmentOptions extends EstimateOptions {
  capacityGiB: number
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function hasSafeGeometry(
  model: ModelSpec,
  options: Pick<EstimateOptions, 'mlaCacheMode' | 'weightBytesOverride' | 'additionalWeightBytes'>,
): boolean {
  if (!isPositiveFinite(model.parametersB)
    || !isPositiveInteger(model.layers)
    || !isPositiveInteger(model.maxContext)) return false
  if (model.attentionLayers !== undefined
    && (!isPositiveInteger(model.attentionLayers) || model.attentionLayers > model.layers)) return false
  if (model.attentionProfile) {
    const profile = model.attentionProfile
    if (!isPositiveInteger(profile.fullLayers)
      || profile.fullLayers > model.layers
      || ![profile.slidingLayers, profile.linearLayers, profile.kdaLayers, profile.recurrentLayers, profile.ssmLayers]
        .every(isNonNegativeInteger)
      || (profile.slidingWindow !== null && !isPositiveInteger(profile.slidingWindow))) return false
  }
  if (model.kvCache?.kind === 'standard') {
    if (!isPositiveInteger(model.kvCache.heads) || !isPositiveInteger(model.kvCache.headDim)) return false
  } else if (model.kvCache?.kind === 'mla') {
    if (![model.kvCache.heads, model.kvCache.keyHeadDim, model.kvCache.valueHeadDim,
      model.kvCache.latentDim, model.kvCache.ropeDim].every(isPositiveInteger)) return false
  } else if (!isPositiveInteger(model.kvHeads) || !isPositiveInteger(model.headDim)) {
    return false
  }
  return (options.weightBytesOverride === undefined || isPositiveFinite(options.weightBytesOverride))
    && (options.additionalWeightBytes === undefined
      || (Number.isFinite(options.additionalWeightBytes) && options.additionalWeightBytes >= 0))
}

function safetyReason(
  model: ModelSpec,
  options: Pick<EstimateOptions, 'mlaCacheMode' | 'weightBytesOverride' | 'additionalWeightBytes'>,
  capacityGiB: number,
) {
  if (!Number.isFinite(capacityGiB) || capacityGiB <= 0) return 'invalid-capacity' as const
  if (model.estimateConfidence === 'runtime-specific') return 'runtime-specific' as const
  if (model.estimateConfidence === 'weights-only') return 'weights-only' as const
  if (!hasSafeGeometry(model, options)) return 'missing-safe-geometry' as const
  if (model.kvCache?.kind === 'mla' && !options.mlaCacheMode) return 'mla-mode-required' as const
  if (model.maxContext < 1024) return 'native-context-too-small' as const
  return null
}

function estimateAt(
  model: ModelSpec,
  options: EstimateOptionsWithoutContext,
  context: number,
): VramEstimate | null {
  try {
    const estimate = estimateVram(model, { ...options, context })
    return Object.values(estimate).every((value) => typeof value !== 'number' || Number.isFinite(value))
      ? estimate
      : null
  } catch {
    return null
  }
}

export function findMaximumSafeContext(
  model: ModelSpec,
  options: EstimateOptionsWithoutContext,
  capacityGiB: number,
): MaximumSafeContextResult {
  const unsafe = safetyReason(model, options, capacityGiB)
  if (unsafe) return { kind: 'unavailable', reason: unsafe }

  const firstEstimate = estimateAt(model, options, 1024)
  if (!firstEstimate) return { kind: 'unavailable', reason: 'missing-safe-geometry' }
  if (firstEstimate.totalGiB > capacityGiB) return { kind: 'unavailable', reason: 'weights-do-not-fit' }

  let low = 1
  let high = Math.floor(model.maxContext / 1024)
  let bestEstimate = firstEstimate
  while (low <= high) {
    const midpoint = Math.floor((low + high) / 2)
    const estimate = estimateAt(model, options, midpoint * 1024)
    if (!estimate) return { kind: 'unavailable', reason: 'missing-safe-geometry' }
    if (estimate.totalGiB <= capacityGiB) {
      low = midpoint + 1
      bestEstimate = estimate
    } else {
      high = midpoint - 1
    }
  }

  return { kind: 'available', context: high * 1024, estimate: bestEstimate }
}

export function findHighestPrecisionFit(
  model: ModelSpec,
  options: Omit<EstimateOptions, 'quantization'>,
  capacityGiB: number,
): HighestPrecisionFitResult {
  const unsafe = safetyReason(model, options, capacityGiB)
  if (unsafe) return { kind: 'unavailable', reason: unsafe }
  if (options.context > model.maxContext || options.context < 1024 || options.context % 1024 !== 0) {
    return { kind: 'unavailable', reason: 'missing-safe-geometry' }
  }

  for (const quantization of [...quantizations].sort((a, b) => b.bitsPerWeight - a.bitsPerWeight)) {
    const estimate = estimateAt(model, { ...options, quantization: quantization.id }, options.context)
    if (!estimate) return { kind: 'unavailable', reason: 'missing-safe-geometry' }
    if (estimate && estimate.totalGiB <= capacityGiB) {
      return { kind: 'available', quantization: quantization.id, estimate }
    }
  }
  return { kind: 'unavailable', reason: 'no-precision-fits' }
}

export function buildFitAdjustments(model: ModelSpec, options: FitAdjustmentOptions): FitAdjustment[] {
  const { capacityGiB, context, quantization, kvPrecision, ...estimateOptions } = options
  const baseline = estimateAt(model, { ...estimateOptions, quantization, kvPrecision }, context)
  if (!baseline || baseline.totalGiB <= capacityGiB || safetyReason(model, estimateOptions, capacityGiB)) return []

  const adjustments: FitAdjustment[] = []
  const contextFit = findMaximumSafeContext(model, { ...estimateOptions, quantization, kvPrecision }, capacityGiB)
  if (contextFit.kind === 'available' && contextFit.context < context) {
    adjustments.push({ field: 'context', value: contextFit.context, estimate: contextFit.estimate })
  }

  const lowerKvPrecisions: KvPrecisionId[] = kvPrecision === 'fp16'
    ? ['q8_0', 'q4_0']
    : kvPrecision === 'q8_0' ? ['q4_0'] : []
  for (const nextKvPrecision of lowerKvPrecisions) {
    const estimate = estimateAt(model, { ...estimateOptions, quantization, kvPrecision: nextKvPrecision }, context)
    if (estimate && estimate.totalGiB <= capacityGiB) {
      adjustments.push({ field: 'kvPrecision', value: nextKvPrecision, estimate })
      break
    }
  }

  const currentBits = quantizations.find((item) => item.id === quantization)?.bitsPerWeight
  if (currentBits !== undefined) {
    for (const nextQuantization of [...quantizations].sort((a, b) => b.bitsPerWeight - a.bitsPerWeight)) {
      if (nextQuantization.bitsPerWeight >= currentBits) continue
      const estimate = estimateAt(model, { ...estimateOptions, quantization: nextQuantization.id, kvPrecision }, context)
      if (estimate && estimate.totalGiB <= capacityGiB) {
        adjustments.push({ field: 'quantization', value: nextQuantization.id, estimate })
        break
      }
    }
  }
  return adjustments
}
