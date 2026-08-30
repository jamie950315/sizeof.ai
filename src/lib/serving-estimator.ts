import type { ModelSpec } from '../data/models'
import { getEngineApplicability, getEngineProfile, getVerifiedServingArchitecture, type EngineApplicability, type EngineProfile, type EngineProfileId, type ServingHardwareKind } from '../data/engine-profiles'
import type { HuggingFaceVariantFormat } from './huggingface-variants'
import { estimateVram, type EstimateOptions } from './estimator'

export interface ServingScenarioInput extends Omit<EstimateOptions, 'context'> {
  profileId: EngineProfileId
  promptTokens: number
  maxGeneratedTokens: number
  concurrency: number
  batchLabel?: string
  artifactFormat: HuggingFaceVariantFormat | null
  hardwareKind: ServingHardwareKind
}

export interface ServingComponents {
  weightsGiB: number
  addonWeightsGiB: number
  runtimeGiB: number | null
  perRequestKvGiB: number | null
  totalConcurrentKvGiB: number | null
  decodeResidentGiB: number | null
}

export interface ServingScenarioEstimate {
  kind: 'lower-bound' | 'unavailable' | 'weights-only'
  profile: EngineProfile
  inputs: {
    profileId: EngineProfileId
    promptTokens: number
    maxGeneratedTokens: number
    concurrency: number
    batchLabel: string | null
    quantization: EstimateOptions['quantization']
    kvPrecision: EstimateOptions['kvPrecision']
    mlaCacheMode: NonNullable<EstimateOptions['mlaCacheMode']> | null
    weightBytesOverride: number | null
    additionalWeightBytes: number | null
    artifactFormat: HuggingFaceVariantFormat | null
    hardwareKind: ServingHardwareKind
  }
  applicability: EngineApplicability
  components: ServingComponents | null
  prefillPeakGiB: null
  unknownFactors: readonly string[]
}

function validateInteger(value: number, label: string, maximum: number) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`)
  if (value > maximum) throw new Error(`${label} must be between 1 and ${maximum}`)
}

export function estimateServingScenario(model: ModelSpec, input: ServingScenarioInput): ServingScenarioEstimate {
  validateInteger(input.promptTokens, 'Prompt tokens', model.maxContext)
  validateInteger(input.maxGeneratedTokens, 'Maximum generated tokens', model.maxContext)
  validateInteger(input.concurrency, 'Concurrency', 256)
  if (input.promptTokens + input.maxGeneratedTokens > model.maxContext) {
    throw new Error('Prompt and generated tokens cannot exceed the native context')
  }

  const inputs = {
    profileId: input.profileId,
    promptTokens: input.promptTokens,
    maxGeneratedTokens: input.maxGeneratedTokens,
    concurrency: input.concurrency,
    batchLabel: input.batchLabel?.trim() || null,
    quantization: input.quantization,
    kvPrecision: input.kvPrecision,
    mlaCacheMode: input.mlaCacheMode ?? null,
    weightBytesOverride: input.weightBytesOverride ?? null,
    additionalWeightBytes: input.additionalWeightBytes ?? null,
    artifactFormat: input.artifactFormat,
    hardwareKind: input.hardwareKind,
  }
  const profile = getEngineProfile(input.profileId)
  const applicability = getEngineApplicability(profile, { ...input, model })
  const unknownFactors = [...profile.unknownFactors]
  if (model.estimateConfidence === 'weights-only') {
    const singleSequence = estimateVram(model, {
      quantization: input.quantization,
      kvPrecision: input.kvPrecision,
      mlaCacheMode: input.mlaCacheMode,
      weightBytesOverride: input.weightBytesOverride,
      additionalWeightBytes: input.additionalWeightBytes,
      context: input.promptTokens + input.maxGeneratedTokens,
    })
    return {
      kind: 'weights-only', profile, inputs, applicability,
      components: {
        weightsGiB: singleSequence.weightsGiB,
        addonWeightsGiB: singleSequence.addonWeightsGiB,
        runtimeGiB: null,
        perRequestKvGiB: null,
        totalConcurrentKvGiB: null,
        decodeResidentGiB: null,
      },
      prefillPeakGiB: null,
      unknownFactors: [...unknownFactors, 'KV cache geometry and runtime state'],
    }
  }
  const architecture = getVerifiedServingArchitecture(model)
  if (!architecture.applicable) {
    return { kind: 'unavailable', profile, inputs, applicability: architecture, components: null, prefillPeakGiB: null, unknownFactors: [...unknownFactors, 'Architecture-specific runtime state'] }
  }
  if (!applicability.applicable) {
    return { kind: 'unavailable', profile, inputs, applicability, components: null, prefillPeakGiB: null, unknownFactors }
  }

  const singleSequence = estimateVram(model, {
    quantization: input.quantization,
    kvPrecision: input.kvPrecision,
    mlaCacheMode: input.mlaCacheMode,
    weightBytesOverride: input.weightBytesOverride,
    additionalWeightBytes: input.additionalWeightBytes,
    context: input.promptTokens + input.maxGeneratedTokens,
  })
  const totalConcurrentKvGiB = singleSequence.kvCacheGiB * input.concurrency
  return {
    kind: 'lower-bound', profile, inputs, applicability,
    components: {
      weightsGiB: singleSequence.weightsGiB,
      addonWeightsGiB: singleSequence.addonWeightsGiB,
      runtimeGiB: singleSequence.runtimeGiB,
      perRequestKvGiB: singleSequence.kvCacheGiB,
      totalConcurrentKvGiB,
      decodeResidentGiB: singleSequence.weightsGiB + singleSequence.runtimeGiB + totalConcurrentKvGiB,
    },
    prefillPeakGiB: null,
    unknownFactors,
  }
}
