import { describe, expect, it } from 'vitest'
import { curatedHuggingFaceResourceProfiles } from './huggingface-resource-profiles'

function staticBytes(modelId: string, optionId: string) {
  const profile = curatedHuggingFaceResourceProfiles[modelId]
  const option = profile?.resourceEstimate.options.find((item) => item.id === optionId)
  return option?.components.reduce((total, component) => total + component.sizeBytes, 0)
}

describe('curated Hugging Face resource profiles', () => {
  it('records the Tiny VAE preview decoder as a standalone optional artifact', () => {
    const profile = curatedHuggingFaceResourceProfiles['Kijai/MiniMax-H3-TAE']

    expect(profile?.resourceEstimate).toMatchObject({
      kind: 'preview-decoder',
      baseModelId: null,
      options: [{ components: [{
        path: 'vae_approx/taeh3.safetensors',
        sizeBytes: 9_791_388,
      }] }],
    })
  })

  it('keeps Wan Base and Distillation as mutually exclusive complete pipeline options', () => {
    const profile = curatedHuggingFaceResourceProfiles['Wan-AI/Wan2.2-Animate-2-14B']

    expect(profile?.resourceEstimate.kind).toBe('video-pipeline')
    expect(staticBytes('Wan-AI/Wan2.2-Animate-2-14B', 'base-bf16')).toBe(49_707_987_335)
    expect(staticBytes('Wan-AI/Wan2.2-Animate-2-14B', 'distillation-bf16')).toBe(49_707_987_335)
    expect(profile?.resourceEstimate.options[1]?.components[0]).toMatchObject({
      path: 'wan_animate_2/wan_animate_2_bf16_distillation.safetensors',
      sizeBytes: 32_789_901_704,
    })
  })

  it('adds the Looping Sketch LoRA to the declared MiniMax H3 R2V component set', () => {
    const profile = curatedHuggingFaceResourceProfiles['Inner-Reflections/MiniMax-H3-Looping-Sketch-Anime']

    expect(profile?.resourceEstimate.baseModelId).toBe('Comfy-Org/MiniMax-H3')
    expect(staticBytes('Inner-Reflections/MiniMax-H3-Looping-Sketch-Anime', 'r2v-nvfp4')).toBe(43_067_035_239)
    expect(profile?.resourceEstimate.options[0]?.components.at(-1)).toMatchObject({
      label: 'Looping Sketch LoRA',
      path: 'minimax_h3_looping_sketch_anime_v1.safetensors',
      sizeBytes: 596_449_768,
    })
  })
})
