import type {
  HuggingFaceModelKind,
  HuggingFaceResourceEstimate,
} from '../lib/huggingface'

export interface CuratedHuggingFaceResourceProfile {
  modelKind: HuggingFaceModelKind
  resourceEstimate: HuggingFaceResourceEstimate
}

export const curatedHuggingFaceResourceProfiles: Record<string, CuratedHuggingFaceResourceProfile> = {
  'Kijai/MiniMax-H3-TAE': {
    modelKind: 'video',
    resourceEstimate: {
      kind: 'preview-decoder',
      title: 'Tiny preview decoder weights',
      description: 'A preview-only Tiny VAE decoder for MiniMax-H3 latents. It is not the official video VAE or a required MiniMax-H3 pipeline component.',
      note: 'This is the published decoder-weight footprint only. Preview resolution and frames determine activation memory, so it is not a video-generation peak VRAM estimate.',
      baseModelId: null,
      options: [{
        id: 'taeh3-preview-decoder',
        label: 'Tiny VAE preview decoder',
        components: [{
          id: 'taeh3-preview-decoder',
          label: 'Tiny preview decoder',
          path: 'vae_approx/taeh3.safetensors',
          sizeBytes: 9_791_388,
        }],
      }],
    },
  },
  'Wan-AI/Wan2.2-Animate-2-14B': {
    modelKind: 'video',
    resourceEstimate: {
      kind: 'video-pipeline',
      title: 'Video pipeline loaded weights',
      description: 'The official inference configuration loads one Wan Animate Transformer together with its UMT5 text encoder, CLIP vision encoder, and VAE. It does not use an autoregressive KV cache.',
      note: 'Base and Distillation are alternative Transformer weights; select one, never both. This is static published weight residency, not peak VRAM: resolution, frames, reference video, activations, and sharding add runtime memory.',
      baseModelId: null,
      options: [
        {
          id: 'base-bf16',
          label: 'Base BF16 pipeline',
          components: [
            {
              id: 'wan-transformer-base',
              label: 'Diffusion Transformer / Base BF16',
              path: 'wan_animate_2/wan_animate_2_bf16.safetensors',
              sizeBytes: 32_789_901_704,
            },
            {
              id: 'wan-umt5',
              label: 'UMT5-XXL text encoder',
              path: 'videomodel/Wan-AI/models_t5_umt5-xxl-enc-bf16.pth',
              sizeBytes: 11_361_920_418,
            },
            {
              id: 'wan-clip',
              label: 'CLIP vision encoder',
              path: 'videomodel/Wan-AI/models_clip_open-clip-xlm-roberta-large-vit-huge-14.pth',
              sizeBytes: 4_772_359_047,
            },
            {
              id: 'wan-vae',
              label: 'Video VAE',
              path: 'videomodel/Wan-AI/vae.pth',
              sizeBytes: 783_806_166,
            },
          ],
        },
        {
          id: 'distillation-bf16',
          label: 'Distillation BF16 pipeline',
          components: [
            {
              id: 'wan-transformer-distillation',
              label: 'Diffusion Transformer / Distillation BF16',
              path: 'wan_animate_2/wan_animate_2_bf16_distillation.safetensors',
              sizeBytes: 32_789_901_704,
            },
            {
              id: 'wan-umt5',
              label: 'UMT5-XXL text encoder',
              path: 'videomodel/Wan-AI/models_t5_umt5-xxl-enc-bf16.pth',
              sizeBytes: 11_361_920_418,
            },
            {
              id: 'wan-clip',
              label: 'CLIP vision encoder',
              path: 'videomodel/Wan-AI/models_clip_open-clip-xlm-roberta-large-vit-huge-14.pth',
              sizeBytes: 4_772_359_047,
            },
            {
              id: 'wan-vae',
              label: 'Video VAE',
              path: 'videomodel/Wan-AI/vae.pth',
              sizeBytes: 783_806_166,
            },
          ],
        },
      ],
    },
  },
  'Inner-Reflections/MiniMax-H3-Looping-Sketch-Anime': {
    modelKind: 'adapter',
    resourceEstimate: {
      kind: 'video-lora',
      title: 'Video LoRA loaded weights',
      description: 'This is a MiniMax-H3 video LoRA. The published card declares Comfy-Org/MiniMax-H3 as its base; this profile uses the R2V component set plus the LoRA, not an autoregressive KV cache.',
      note: 'This is static published weight residency for the selected R2V set. Video resolution, frames, activations, offload, and runtime sharding determine the real peak VRAM.',
      baseModelId: 'Comfy-Org/MiniMax-H3',
      options: [{
        id: 'r2v-nvfp4',
        label: 'R2V NVFP4 component set + LoRA',
        components: [
          {
            id: 'minimax-r2v',
            label: 'R2V Diffusion Transformer / INT8 ConvRot',
            repositoryId: 'Comfy-Org/MiniMax-H3',
            path: 'diffusion_models/minimax_h3_ref2va_int8_convrot.safetensors',
            sizeBytes: 20_970_379_616,
          },
          {
            id: 'minimax-qwen3vl',
            label: 'Qwen3-VL text encoder / NVFP4 AWQ',
            repositoryId: 'Comfy-Org/MiniMax-H3',
            path: 'text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
            sizeBytes: 15_687_142_551,
          },
          {
            id: 'minimax-video-vae',
            label: 'Video VAE / FP16',
            repositoryId: 'Comfy-Org/MiniMax-H3',
            path: 'vae/minimax_h3_video_vae_fp16.safetensors',
            sizeBytes: 5_207_808_496,
          },
          {
            id: 'minimax-audio-vae',
            label: 'Audio VAE / FP32',
            repositoryId: 'Comfy-Org/MiniMax-H3',
            path: 'vae/minimax_h3_audio_vae_fp32.safetensors',
            sizeBytes: 605_254_808,
          },
          {
            id: 'looping-sketch-lora',
            label: 'Looping Sketch LoRA',
            path: 'minimax_h3_looping_sketch_anime_v1.safetensors',
            sizeBytes: 596_449_768,
          },
        ],
      }],
    },
  },
}
