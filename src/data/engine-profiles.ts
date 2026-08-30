import type { HuggingFaceVariantFormat } from '../lib/huggingface-variants'
import type { ModelSpec } from './models'

export type EngineProfileId = 'llama.cpp' | 'mlx' | 'vllm'
export type ServingHardwareKind = 'discrete-gpu' | 'unified-memory' | null

export interface EngineProfile {
  id: EngineProfileId
  label: string
  reviewedAt: string
  sourceUrl: string
  supportedPlatformsAndFormats: string
  cacheBehavior: string
  unknownFactors: readonly string[]
}

export interface EngineApplicability {
  applicable: boolean
  reason: string
}

export function getVerifiedServingArchitecture(model: ModelSpec): EngineApplicability {
  if (model.estimateConfidence !== 'safe') {
    return { applicable: false, reason: 'A verified safe attention architecture is required for a numeric serving lower bound.' }
  }
  const attention = model.attentionProfile
  const hasStatefulFacts = attention !== undefined && (
    attention.stateKind !== null
    || attention.linearLayers > 0
    || attention.kdaLayers > 0
    || attention.recurrentLayers > 0
    || attention.ssmLayers > 0
  )
  if (hasStatefulFacts) {
    return { applicable: false, reason: 'Stateful architecture facts make engine-specific serving residency unavailable.' }
  }
  return { applicable: true, reason: 'Verified safe attention architecture facts are available.' }
}

export const engineProfiles: readonly EngineProfile[] = [
  {
    id: 'llama.cpp',
    label: 'llama.cpp',
    reviewedAt: '2026-08-30',
    sourceUrl: 'https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md',
    supportedPlatformsAndFormats: 'Local CPU/GPU serving with a selected GGUF model artifact.',
    cacheBehavior: 'Server slots and unified KV settings can change cache allocation.',
    unknownFactors: ['Device placement and offload choices', 'Server-slot and batching configuration', 'Prefill allocation'],
  },
  {
    id: 'mlx',
    label: 'MLX',
    reviewedAt: '2026-08-30',
    sourceUrl: 'https://github.com/ml-explore/mlx-lm',
    supportedPlatformsAndFormats: 'Apple silicon unified-memory serving with a selected MLX model artifact.',
    cacheBehavior: 'Model and cache residency share unified memory; runtime allocation remains implementation-dependent.',
    unknownFactors: ['Apple silicon memory pressure', 'MLX runtime allocation', 'Prefill allocation'],
  },
  {
    id: 'vllm',
    label: 'vLLM',
    reviewedAt: '2026-08-30',
    sourceUrl: 'https://docs.vllm.ai/en/latest/configuration/optimization/',
    supportedPlatformsAndFormats: 'Serving a base Transformers/Safetensors model; deployment support remains model-dependent.',
    cacheBehavior: 'Scheduling, parallelism, and cache configuration can change resident allocation.',
    unknownFactors: ['Parallelism and scheduler configuration', 'Prefix-cache sharing', 'Prefill allocation'],
  },
]

export function getEngineProfile(id: EngineProfileId): EngineProfile {
  const profile = engineProfiles.find((candidate) => candidate.id === id)
  if (!profile) throw new Error('Unknown engine profile')
  return profile
}

export function getEngineApplicability(
  profile: EngineProfile,
  input: { model: ModelSpec; artifactFormat: HuggingFaceVariantFormat | null; hardwareKind: ServingHardwareKind },
): EngineApplicability {
  const architecture = getVerifiedServingArchitecture(input.model)
  if (!architecture.applicable) return architecture
  if (profile.id === 'llama.cpp') {
    return input.artifactFormat === 'gguf'
      ? { applicable: true, reason: 'Selected GGUF artifact is compatible with this profile.' }
      : { applicable: false, reason: 'llama.cpp lower bounds require a selected GGUF model artifact.' }
  }
  if (profile.id === 'mlx') {
    if (input.artifactFormat !== 'mlx') return { applicable: false, reason: 'MLX lower bounds require a selected MLX model artifact.' }
    return input.hardwareKind === 'unified-memory'
      ? { applicable: true, reason: 'Selected MLX artifact and unified-memory hardware are compatible with this profile.' }
      : { applicable: false, reason: 'MLX lower bounds require Apple silicon unified-memory hardware.' }
  }
  return input.artifactFormat === null || input.artifactFormat === 'safetensors'
    ? { applicable: true, reason: 'Base Transformers/Safetensors model facts are compatible with this profile.' }
    : { applicable: false, reason: 'vLLM lower bounds require base Transformers/Safetensors model facts, not this artifact format.' }
}
