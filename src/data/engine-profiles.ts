import type { HuggingFaceVariantFormat } from '../lib/huggingface-variants'

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
  input: { artifactFormat: HuggingFaceVariantFormat | null; hardwareKind: ServingHardwareKind },
): EngineApplicability {
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
