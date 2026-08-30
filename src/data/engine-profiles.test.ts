import { describe, expect, it } from 'vitest'
import { engineProfiles, getEngineApplicability, getEngineProfile } from './engine-profiles'

describe('serving engine profiles', () => {
  it('ships versioned official profiles without invented numeric performance claims', () => {
    expect(engineProfiles.map((profile) => profile.id)).toEqual(['llama.cpp', 'mlx', 'vllm'])

    for (const profile of engineProfiles) {
      expect(profile.reviewedAt).toBe('2026-08-30')
      expect(profile.sourceUrl).toMatch(/^https:\/\//)
      expect(profile.supportedPlatformsAndFormats).toBeTruthy()
      expect(profile.cacheBehavior).toBeTruthy()
      expect(profile.unknownFactors.length).toBeGreaterThan(0)
      expect(JSON.stringify(profile)).not.toMatch(/tokens\/?sec|throughput|workspace.*\d|\d.*workspace/i)
    }
  })

  it('requires compatible artifact and hardware facts before claiming an engine applies', () => {
    expect(getEngineApplicability(getEngineProfile('llama.cpp'), { artifactFormat: 'gguf', hardwareKind: 'discrete-gpu' }).applicable).toBe(true)
    expect(getEngineApplicability(getEngineProfile('llama.cpp'), { artifactFormat: 'mlx', hardwareKind: 'discrete-gpu' })).toMatchObject({
      applicable: false,
      reason: expect.stringMatching(/GGUF/i),
    })
    expect(getEngineApplicability(getEngineProfile('mlx'), { artifactFormat: 'mlx', hardwareKind: 'unified-memory' }).applicable).toBe(true)
    expect(getEngineApplicability(getEngineProfile('mlx'), { artifactFormat: 'mlx', hardwareKind: 'discrete-gpu' })).toMatchObject({
      applicable: false,
      reason: expect.stringMatching(/unified-memory|Apple/i),
    })
    expect(getEngineApplicability(getEngineProfile('vllm'), { artifactFormat: null, hardwareKind: 'discrete-gpu' }).applicable).toBe(true)
    expect(getEngineApplicability(getEngineProfile('vllm'), { artifactFormat: 'gguf', hardwareKind: 'discrete-gpu' })).toMatchObject({
      applicable: false,
      reason: expect.stringMatching(/Transformers|Safetensors/i),
    })
  })
})
