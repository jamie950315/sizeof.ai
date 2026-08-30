import { describe, expect, it } from 'vitest'
import { engineProfiles, getEngineApplicability, getEngineProfile } from './engine-profiles'
import type { ModelSpec } from './models'

const safeModel: ModelSpec = {
  id: 'engine-test', name: 'Engine test', family: 'Qwen3.8', maker: 'test', parametersB: 8,
  layers: 32, attentionLayers: 32, kvHeads: 8, headDim: 128, maxContext: 8192,
  releaseYear: 2026, strengths: [], sourceUrl: 'https://example.test/model', estimateConfidence: 'safe',
}

describe('serving engine profiles', () => {
  it('ships versioned official profiles without invented numeric performance claims', () => {
    expect(engineProfiles.map((profile) => profile.id)).toEqual(['llama.cpp', 'mlx', 'vllm'])

    for (const profile of engineProfiles) {
      expect(profile.reviewedAt).toBe('2026-08-30')
      expect(profile.sourceUrl).toMatch(/^https:\/\//)
      expect(profile.supportedPlatformsAndFormats).toBeTruthy()
      expect(profile.cacheBehavior).toBeTruthy()
      expect(profile.unknownFactors.length).toBeGreaterThan(0)
      expect(JSON.stringify(profile)).not.toMatch(/tokens\/?sec|throughput|latency|speed|uncertainty|workspace/i)
    }
  })

  it('requires compatible artifact and hardware facts before claiming an engine applies', () => {
    expect(getEngineApplicability(getEngineProfile('llama.cpp'), { model: safeModel, artifactFormat: 'gguf', hardwareKind: 'discrete-gpu' }).applicable).toBe(true)
    expect(getEngineApplicability(getEngineProfile('llama.cpp'), { model: safeModel, artifactFormat: 'mlx', hardwareKind: 'discrete-gpu' })).toMatchObject({
      applicable: false,
      reason: expect.stringMatching(/GGUF/i),
    })
    expect(getEngineApplicability(getEngineProfile('mlx'), { model: safeModel, artifactFormat: 'mlx', hardwareKind: 'unified-memory' }).applicable).toBe(true)
    expect(getEngineApplicability(getEngineProfile('mlx'), { model: safeModel, artifactFormat: 'mlx', hardwareKind: 'discrete-gpu' })).toMatchObject({
      applicable: false,
      reason: expect.stringMatching(/unified-memory|Apple/i),
    })
    expect(getEngineApplicability(getEngineProfile('vllm'), { model: safeModel, artifactFormat: null, hardwareKind: 'discrete-gpu' }).applicable).toBe(true)
    expect(getEngineApplicability(getEngineProfile('vllm'), { model: safeModel, artifactFormat: 'gguf', hardwareKind: 'discrete-gpu' })).toMatchObject({
      applicable: false,
      reason: expect.stringMatching(/Transformers|Safetensors/i),
    })
  })

  it('rejects artifact-only claims when model architecture facts are unknown or stateful', () => {
    expect(getEngineApplicability(getEngineProfile('llama.cpp'), {
      model: { ...safeModel, family: 'custom', estimateConfidence: undefined }, artifactFormat: 'gguf', hardwareKind: 'discrete-gpu',
    })).toMatchObject({ applicable: false, reason: expect.stringMatching(/verified safe|architecture/i) })
    expect(getEngineApplicability(getEngineProfile('vllm'), {
      model: { ...safeModel, attentionProfile: { fullLayers: 32, slidingLayers: 0, linearLayers: 0, kdaLayers: 0, recurrentLayers: 0, ssmLayers: 32, slidingWindow: null, stateKind: 'mamba' } },
      artifactFormat: 'safetensors', hardwareKind: 'discrete-gpu',
    })).toMatchObject({ applicable: false, reason: expect.stringMatching(/stateful|architecture/i) })
  })

  it.each([
    ['llama.cpp' as const, 'gguf' as const],
    ['vllm' as const, 'safetensors' as const],
  ])('refuses explicit-safe custom architecture for %s despite matching %s artifact facts', (profileId, artifactFormat) => {
    expect(getEngineApplicability(getEngineProfile(profileId), {
      model: { ...safeModel, family: 'custom', estimateConfidence: 'safe' }, artifactFormat, hardwareKind: 'discrete-gpu',
    })).toMatchObject({ applicable: false, reason: expect.stringMatching(/support.*not verified|architecture/i) })
  })
})
