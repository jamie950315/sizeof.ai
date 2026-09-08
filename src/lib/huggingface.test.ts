import { describe, expect, it } from 'vitest'
import {
  normalizeHuggingFaceModel,
  parseHuggingFaceModelPath,
} from './huggingface'
import type { HuggingFaceVariant } from './huggingface-variants'
import { curatedHuggingFaceConfigs } from '../data/huggingface-configs'

it('counts repeated layer patterns without allocating an array per declared layer', () => {
  const value = normalizeHuggingFaceModel({ id: 'test/model' }, {
    num_hidden_layers: 1_000_000_000,
    layer_types: ['full_attention', 'linear_attention'],
  })
  expect(value.attentionProfile.fullLayers).toBe(500_000_000)
  expect(value.attentionProfile.linearLayers).toBe(500_000_000)
  expect(normalizeHuggingFaceModel({ id: 'test/model' }, {
    num_hidden_layers: 3.5,
  }).layers).toBeNull()
})

const metadata = {
  id: 'Qwen/Qwen3.8-27B',
  author: 'Qwen',
  lastModified: '2026-08-14T15:00:01.000Z',
  downloads: 665513,
  likes: 10977,
  pipeline_tag: 'image-text-to-text',
  library_name: 'transformers',
  tags: ['transformers', 'safetensors', 'qwen3_5', 'license:apache-2.0'],
  cardData: { license: 'apache-2.0' },
  safetensors: { total: 27781427952 },
}

const hybridConfig = {
  architectures: ['Qwen3_5ForConditionalGeneration'],
  model_type: 'qwen3_5',
  text_config: {
    dtype: 'bfloat16',
    head_dim: 256,
    hidden_size: 5120,
    max_position_embeddings: 262144,
    num_attention_heads: 24,
    num_hidden_layers: 64,
    num_key_value_heads: 4,
    layer_types: Array.from({ length: 64 }, (_, index) =>
      (index + 1) % 4 === 0 ? 'full_attention' : 'linear_attention',
    ),
  },
}

describe('parseHuggingFaceModelPath', () => {
  it('maps a Hugging Face-style owner and repository path', () => {
    expect(parseHuggingFaceModelPath('/Qwen/Qwen3.8-27B')).toEqual({
      owner: 'Qwen',
      repo: 'Qwen3.8-27B',
    })
  })

  it('does not treat reserved or malformed paths as models', () => {
    expect(parseHuggingFaceModelPath('/api/models/Qwen/Qwen3.8-27B')).toBeNull()
    expect(parseHuggingFaceModelPath('/Qwen/not%2Fa-model')).toBeNull()
    expect(parseHuggingFaceModelPath('/only-one-segment')).toBeNull()
  })
})

describe('normalizeHuggingFaceModel', () => {
  it('uses the verified Muse Glimmer nested text config as a runtime-specific lower bound', () => {
    const model = normalizeHuggingFaceModel({
      ...metadata,
      id: 'meta-models/Muse-Glimmer-30B',
      pipeline_tag: 'image-text-to-text',
      safetensors: { total: 29_776_626_688 },
    }, curatedHuggingFaceConfigs['meta-models/Muse-Glimmer-30B'])

    expect(model.spec).toMatchObject({
      layers: 52,
      attentionLayers: 13,
      kvHeads: 2,
      headDim: 128,
      maxContext: 131072,
      estimateConfidence: 'runtime-specific',
    })
    expect(model.attentionProfile).toMatchObject({ fullLayers: 13, slidingLayers: 39, slidingWindow: 2048 })
    expect(model.estimateReason).toBeNull()
  })
  it('normalizes nested text config and counts only full-attention KV layers', () => {
    const model = normalizeHuggingFaceModel(metadata, hybridConfig)

    expect(model.id).toBe('Qwen/Qwen3.8-27B')
    expect(model.modelKind).toBe('vision-language')
    expect(model.estimateReason).toBeNull()
    expect(model.parametersB).toBeCloseTo(27.7814, 4)
    expect(model.license).toBe('apache-2.0')
    expect(model.architecture).toBe('Qwen3_5ForConditionalGeneration')
    expect(model.spec).toMatchObject({
      parametersB: 27.781427952,
      layers: 64,
      attentionLayers: 16,
      kvHeads: 4,
      headDim: 256,
      maxContext: 262144,
    })
  })

  it('supports conventional top-level text model configs', () => {
    const model = normalizeHuggingFaceModel(
      { ...metadata, id: 'Example/Model-8B', safetensors: { total: 8_000_000_000 } },
      {
        architectures: ['ExampleForCausalLM'],
        num_hidden_layers: 32,
        num_key_value_heads: 8,
        num_attention_heads: 32,
        hidden_size: 4096,
        max_position_embeddings: 131072,
      },
    )

    expect(model.spec).toMatchObject({ layers: 32, attentionLayers: 32, headDim: 128 })
  })

  it('normalizes MLA cache dimensions and explicit hybrid attention layers', () => {
    const model = normalizeHuggingFaceModel(
      {
        ...metadata,
        id: 'moonshotai/Kimi-K3',
        author: 'moonshotai',
        cardData: { license: 'other', license_name: 'kimi-k3' },
        safetensors: { total: 2_779_931_837_184 },
      },
      {
        architectures: ['KimiK3ForConditionalGeneration'],
        model_type: 'kimi_k3',
        text_config: {
          model_type: 'kimi_linear',
          num_hidden_layers: 93,
          num_attention_heads: 96,
          num_key_value_heads: 96,
          hidden_size: 7168,
          max_position_embeddings: 1_048_576,
          kv_lora_rank: 512,
          qk_rope_head_dim: 64,
          qk_nope_head_dim: 128,
          v_head_dim: 128,
          quantization_config: { format: 'mxfp4-pack-quantized' },
          linear_attn_config: {
            full_attn_layers: [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48,
              52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 92, 93],
            kda_layers: Array.from({ length: 92 }, (_, index) => index + 1)
              .filter((index) => index % 4 !== 0),
          },
        },
      },
    )

    expect(model.spec).toMatchObject({
      layers: 93,
      attentionLayers: 24,
      maxContext: 1_048_576,
      kvCache: {
        kind: 'mla',
        heads: 96,
        keyHeadDim: 192,
        valueHeadDim: 128,
        latentDim: 512,
        ropeDim: 64,
      },
    })
    expect(model).toMatchObject({
      layers: 93,
      attentionLayers: 24,
      maxContext: 1_048_576,
      quantizationFormat: 'mxfp4-pack-quantized',
      license: 'kimi-k3',
      estimateConfidence: 'runtime-specific',
      attentionProfile: {
        fullLayers: 24,
        slidingLayers: 0,
        linearLayers: 0,
        kdaLayers: 69,
        recurrentLayers: 0,
        ssmLayers: 0,
        slidingWindow: null,
        stateKind: 'kda',
      },
    })
  })

  it('keeps MoE routing facts separate from resident total parameters', () => {
    const model = normalizeHuggingFaceModel(
      {
        ...metadata,
        id: 'Qwen/Qwen3.6-35B-A3B',
        safetensors: { total: 35_951_822_704, parameters: { BF16: 35_951_822_704 } },
      },
      {
        architectures: ['Qwen3_5MoeForConditionalGeneration'],
        model_type: 'qwen3_5_moe',
        text_config: {
          num_hidden_layers: 40,
          num_attention_heads: 16,
          num_key_value_heads: 2,
          head_dim: 256,
          max_position_embeddings: 262144,
          num_experts: 256,
          num_experts_per_tok: 8,
          layer_types: Array.from({ length: 40 }, (_, index) => index % 4 === 3
            ? 'full_attention'
            : 'linear_attention'),
        },
      },
    )

    expect(model.parametersB).toBeCloseTo(35.9518, 4)
    expect(model.spec?.parametersB).toBeCloseTo(35.9518, 4)
    expect(model.moe).toEqual({
      totalExperts: 256,
      routedExperts: null,
      sharedExperts: null,
      expertsPerToken: 8,
      activeParametersB: 3,
      denseLayers: null,
    })
  })

  it('models mixed full and sliding attention with a runtime-specific cache window', () => {
    const model = normalizeHuggingFaceModel(
      {
        ...metadata,
        id: 'openai/gpt-oss-20b',
        pipeline_tag: 'text-generation',
        safetensors: { total: 21_512_000_000 },
      },
      {
        architectures: ['GptOssForCausalLM'],
        model_type: 'gpt_oss',
        num_hidden_layers: 24,
        num_attention_heads: 64,
        num_key_value_heads: 8,
        head_dim: 64,
        max_position_embeddings: 131072,
        sliding_window: 128,
        layer_types: Array.from({ length: 24 }, (_, index) => index % 2
          ? 'full_attention'
          : 'sliding_attention'),
        num_local_experts: 32,
        num_experts_per_tok: 4,
      },
    )

    expect(model).toMatchObject({
      estimateConfidence: 'runtime-specific',
      attentionProfile: {
        fullLayers: 12,
        slidingLayers: 12,
        linearLayers: 0,
        slidingWindow: 128,
      },
      moe: { totalExperts: 32, expertsPerToken: 4 },
    })
    expect(model.spec?.attentionProfile).toMatchObject({ fullLayers: 12, slidingLayers: 12, slidingWindow: 128 })
    expect(model.moe?.activeParametersB).toBe(3.6)
  })

  it('detects config-declared integrated MTP even when the repository name omits MTP', () => {
    const model = normalizeHuggingFaceModel(
      {
        ...metadata,
        id: 'deepseek-ai/DeepSeek-V3',
        pipeline_tag: 'text-generation',
        safetensors: { total: 685_000_000_000 },
      },
      {
        architectures: ['DeepseekV3ForCausalLM'], model_type: 'deepseek_v3',
        num_hidden_layers: 61, num_attention_heads: 128, num_key_value_heads: 128,
        hidden_size: 7168, max_position_embeddings: 163840,
        n_routed_experts: 256, n_shared_experts: 1, num_experts_per_tok: 8,
        first_k_dense_replace: 3, num_nextn_predict_layers: 1,
      },
    )

    expect(model.speculative).toEqual({
      family: 'mtp', relation: 'integrated',
      targetModelId: 'deepseek-ai/DeepSeek-V3', blockSize: null,
    })
    expect(model.moe).toMatchObject({
      routedExperts: 256, sharedExperts: 1, expertsPerToken: 8,
      activeParametersB: 37, denseLayers: 3,
    })
  })

  it('recognizes DFlash as a separate speculative draft with a declared target', () => {
    const model = normalizeHuggingFaceModel(
      {
        ...metadata,
        id: 'z-lab/Qwen3.6-35B-A3B-DFlash',
        pipeline_tag: 'text-generation',
        tags: [
          'transformers', 'safetensors', 'feature-extraction', 'dflash',
          'speculative-decoding-draft', 'draft-model',
          'base_model:Qwen/Qwen3.6-35B-A3B',
          'base_model:finetune:Qwen/Qwen3.6-35B-A3B',
        ],
        safetensors: { total: 385_906_176, parameters: { BF16: 385_906_176 } },
      },
      {
        architectures: ['DFlashDraftModel'],
        model_type: 'qwen3',
        dflash_config: { block_size: 16 },
        num_hidden_layers: 6,
        num_attention_heads: 32,
        num_key_value_heads: 8,
        head_dim: 128,
        max_position_embeddings: 262144,
        sliding_window: 4096,
        layer_types: ['sliding_attention', 'sliding_attention', 'sliding_attention', 'sliding_attention', 'sliding_attention', 'full_attention'],
      },
    )

    expect(model).toMatchObject({
      modelKind: 'speculative-draft',
      componentKind: 'draft',
      estimateReason: 'speculative-draft',
      spec: null,
      speculative: {
        family: 'dflash',
        relation: 'separate-model',
        targetModelId: 'Qwen/Qwen3.6-35B-A3B',
        blockSize: 16,
      },
    })
  })

  it('does not classify an ordinary Eagle causal language model as a speculative draft', () => {
    const model = normalizeHuggingFaceModel(
      {
        ...metadata,
        id: 'Example/Eagle-7B', pipeline_tag: 'text-generation',
        tags: ['transformers', 'safetensors', 'base_model:Qwen/Qwen-Target'],
        safetensors: { total: 7_000_000_000, parameters: { BF16: 7_000_000_000 } },
      },
      {
        architectures: ['EagleForCausalLM'], model_type: 'eagle',
        num_hidden_layers: 32, num_attention_heads: 32, num_key_value_heads: 8,
        hidden_size: 4096, max_position_embeddings: 32768,
      },
    )

    expect(model.modelKind).toBe('language')
    expect(model.speculative).toBeNull()
  })

  it('recognizes a config-only DFlash draft without relying on its repository name', () => {
    const model = normalizeHuggingFaceModel(
      {
        ...metadata,
        id: 'Example/Qwen-Draft', pipeline_tag: 'text-generation',
        tags: ['transformers', 'safetensors', 'base_model:Qwen/Qwen3.6-35B-A3B'],
      },
      {
        architectures: ['QwenForCausalLM'], model_type: 'qwen3',
        dflash_config: { block_size: 16 },
        num_hidden_layers: 6, num_attention_heads: 32, num_key_value_heads: 8,
        head_dim: 128, max_position_embeddings: 262144,
      },
    )

    expect(model.modelKind).toBe('speculative-draft')
    expect(model.speculative).toMatchObject({
      family: 'dflash', relation: 'separate-model',
      targetModelId: 'Qwen/Qwen3.6-35B-A3B', blockSize: 16,
    })
  })

  it('expands a short layer type pattern across every declared layer', () => {
    const model = normalizeHuggingFaceModel(metadata, {
      architectures: ['ExampleForCausalLM'], model_type: 'example',
      num_hidden_layers: 8, num_attention_heads: 8, num_key_value_heads: 2,
      hidden_size: 1024, max_position_embeddings: 32768, sliding_window: 4096,
      layer_types: ['sliding_attention', 'full_attention'],
    })

    expect(model.attentionProfile).toMatchObject({ fullLayers: 4, slidingLayers: 4 })
    expect(model.attentionLayers).toBe(4)
  })

  it('ignores layer type entries beyond the declared layer count', () => {
    const model = normalizeHuggingFaceModel(metadata, {
      architectures: ['ExampleForCausalLM'], model_type: 'example',
      num_hidden_layers: 2, num_attention_heads: 8, num_key_value_heads: 2,
      hidden_size: 1024, max_position_embeddings: 32768,
      layer_types: ['full_attention', 'linear_attention', 'full_attention'],
    })

    expect(model.attentionProfile).toMatchObject({ fullLayers: 1, linearLayers: 1 })
  })

  it('treats full_attention block types as full-cache layers', () => {
    const model = normalizeHuggingFaceModel(metadata, {
      architectures: ['ExampleForCausalLM'], model_type: 'example',
      num_hidden_layers: 6, num_attention_heads: 8, num_key_value_heads: 2,
      hidden_size: 1024, max_position_embeddings: 32768,
      block_types: ['full_attention', 'recurrent'],
    })

    expect(model.attentionProfile).toMatchObject({ fullLayers: 3, slidingLayers: 0, recurrentLayers: 3 })
  })

  it('honors a zero full-attention layer offset', () => {
    const model = normalizeHuggingFaceModel(metadata, {
      architectures: ['JambaForCausalLM'], model_type: 'jamba',
      num_hidden_layers: 32, num_attention_heads: 32, num_key_value_heads: 8,
      hidden_size: 4096, max_position_embeddings: 262144,
      attn_layer_period: 8, attn_layer_offset: 0, mamba_d_state: 16,
    })

    expect(model.attentionProfile).toMatchObject({ fullLayers: 4, ssmLayers: 28 })
  })

  it('marks full-model MTP repositories as integrated speculative models', () => {
    const model = normalizeHuggingFaceModel(
      {
        ...metadata,
        id: 'unsloth/Qwen3.5-9B-MTP-GGUF',
        tags: ['transformers', 'gguf', 'base_model:Qwen/Qwen3.5-9B', 'base_model:quantized:Qwen/Qwen3.5-9B'],
        gguf: { total: 9_197_093_888, context_length: 262144, architecture: 'qwen35' },
      },
      hybridConfig,
    )

    expect(model.speculative).toEqual({
      family: 'mtp',
      relation: 'integrated',
      targetModelId: 'Qwen/Qwen3.5-9B',
      blockSize: null,
    })
  })

  it('recognizes Jamba recurrent state and avoids presenting its partial cache as safe', () => {
    const model = normalizeHuggingFaceModel(
      { ...metadata, id: 'ai21labs/Jamba-v0.1', pipeline_tag: 'text-generation' },
      {
        architectures: ['JambaForCausalLM'], model_type: 'jamba', num_hidden_layers: 32,
        num_attention_heads: 32, num_key_value_heads: 8, hidden_size: 4096,
        max_position_embeddings: 262144, attn_layer_period: 8, attn_layer_offset: 4,
        mamba_d_state: 16, mamba_d_conv: 4,
      },
    )

    expect(model).toMatchObject({
      estimateConfidence: 'runtime-specific',
      attentionLayers: 4,
      attentionProfile: {
        fullLayers: 4,
        ssmLayers: 28,
        stateKind: 'mamba',
      },
    })
  })

  it('keeps pure Mamba models as stateful published weights instead of applying a KV formula', () => {
    const model = normalizeHuggingFaceModel(
      {
        ...metadata,
        id: 'state-spaces/mamba-130m-hf',
        pipeline_tag: 'text-generation',
        safetensors: { parameters: { BF16: 130_000_000 }, total: 130_000_000 },
      },
      {
        architectures: ['MambaForCausalLM'], model_type: 'mamba', num_hidden_layers: 24,
        hidden_size: 768, state_size: 16, conv_kernel: 4,
      },
    )

    expect(model).toMatchObject({
      modelKind: 'language',
      estimateReason: 'stateful-runtime',
      estimateConfidence: 'weights-only',
      spec: null,
      attentionProfile: { ssmLayers: 24, stateKind: 'mamba' },
      resourceEstimate: { kind: 'model-weights' },
    })
  })

  it('keeps known facts when a safe memory estimate is unavailable', () => {
    const model = normalizeHuggingFaceModel(
      { ...metadata, id: 'Example/Partial' },
      { num_hidden_layers: 40, max_position_embeddings: 131072 },
    )

    expect(model.spec).toBeNull()
    expect(model.layers).toBe(40)
    expect(model.maxContext).toBe(131072)
  })

  it('counts zero-indexed full-attention layer lists without dropping layer zero', () => {
    const model = normalizeHuggingFaceModel(
      metadata,
      {
        num_hidden_layers: 8,
        num_key_value_heads: 2,
        num_attention_heads: 8,
        head_dim: 128,
        max_position_embeddings: 32768,
        linear_attn_config: { full_attn_layers: [0, 0, 3, 9] },
      },
    )

    expect(model.spec?.attentionLayers).toBe(2)
  })

  it('reads repository quantization from a top-level text model config', () => {
    const model = normalizeHuggingFaceModel(
      metadata,
      {
        num_hidden_layers: 8,
        num_key_value_heads: 2,
        num_attention_heads: 8,
        head_dim: 128,
        max_position_embeddings: 32768,
        quantization_config: { format: 'gptq' },
      },
    )

    expect(model.quantizationFormat).toBe('gptq')
  })

  it('uses Hub GGUF metadata for logical parameters and published context', () => {
    const model = normalizeHuggingFaceModel(
      {
        ...metadata,
        id: 'unsloth/Qwen3.8-27B-GGUF',
        safetensors: undefined,
        gguf: {
          total: 27_320_697_856,
          architecture: 'qwen35',
          context_length: 262144,
          totalFileSize: 16_337_628_128,
        },
      },
      {
        num_hidden_layers: 64,
        num_key_value_heads: 4,
        num_attention_heads: 24,
        head_dim: 256,
      },
    )

    expect(model.parametersB).toBe(27.320697856)
    expect(model.maxContext).toBe(262144)
    expect(model.quantizationFormat).toBe('gguf')
    expect(model.spec).toMatchObject({ parametersB: 27.320697856, maxContext: 262144 })
  })

  it('falls back to a root quantization config for nested text architectures', () => {
    const model = normalizeHuggingFaceModel(
      metadata,
      {
        quantization_config: { format: 'awq' },
        text_config: {
          num_hidden_layers: 8,
          num_key_value_heads: 2,
          num_attention_heads: 8,
          head_dim: 128,
          max_position_embeddings: 32768,
        },
      },
    )

    expect(model.quantizationFormat).toBe('awq')
  })

  it('keeps metadata available when a model cannot be estimated safely', () => {
    const model = normalizeHuggingFaceModel(
      { ...metadata, id: 'Example/Incomplete', safetensors: undefined },
      { architectures: ['UnknownArchitecture'] },
    )

    expect(model.spec).toBeNull()
    expect(model.parametersB).toBeNull()
  })

  it('profiles image model tensors without applying the LLM KV-cache formula', () => {
    const model = normalizeHuggingFaceModel(
      {
        id: 'black-forest-labs/FLUX.1-dev',
        pipeline_tag: 'text-to-image',
        library_name: 'diffusers',
        tags: ['diffusers', 'safetensors', 'text-to-image', 'image-generation'],
        safetensors: {
          parameters: { BF16: 11_901_408_320 },
          total: 11_901_408_320,
        },
        usedStorage: 69_256_397_749,
      },
      {
        architectures: ['FluxTransformer2DModel'],
        num_hidden_layers: 57,
        num_key_value_heads: 24,
        num_attention_heads: 24,
        head_dim: 128,
        max_position_embeddings: 4096,
      },
    )

    expect(model).toMatchObject({
      modelKind: 'image',
      tensorSizeBytes: 23_802_816_640,
      repositorySizeBytes: 69_256_397_749,
      estimateReason: 'modality-specific',
      spec: null,
    })
  })

  it('does not turn a VAE config with layer-like fields into an autoregressive model', () => {
    const model = normalizeHuggingFaceModel(
      {
        id: 'Example/Layered-VAE',
        safetensors: { parameters: { F16: 1_000_000 } },
      },
      {
        architectures: ['AutoencoderKL'],
        model_type: 'autoencoder_kl',
        num_hidden_layers: 8,
        num_key_value_heads: 2,
        num_attention_heads: 8,
        head_dim: 64,
        max_position_embeddings: 32_768,
      },
    )

    expect(model.spec).toBeNull()
    expect(model.modelKind).toBe('image')
    expect(model.componentKind).toBe('vae')
    expect(model.resourceEstimate?.kind).toBe('vae')
  })

  it('classifies TTS and adapter repositories with useful unavailable reasons', () => {
    const tts = normalizeHuggingFaceModel(
      {
        id: 'IndexTeam/IndexTTS-2.5',
        pipeline_tag: 'text-to-speech',
        library_name: 'indextts',
        tags: ['indextts', 'text-to-speech', 'tts'],
        usedStorage: 5_485_798_498,
      },
      {},
    )
    const adapter = normalizeHuggingFaceModel(
      {
        id: 'Jojocodex/minimax-h3-spatial-physics-lora',
        pipeline_tag: 'text-to-video',
        tags: ['lora', 'base_model:adapter:Comfy-Org/MiniMax-H3'],
        usedStorage: 474_154_786,
      },
      {},
    )

    expect(tts).toMatchObject({
      modelKind: 'audio',
      repositorySizeBytes: 5_485_798_498,
      tensorSizeBytes: null,
      estimateReason: 'modality-specific',
    })
    expect(adapter).toMatchObject({
      modelKind: 'adapter',
      repositorySizeBytes: 474_154_786,
      estimateReason: 'adapter-only',
    })
  })

  it('does not report a partial tensor footprint when a dtype is unknown', () => {
    const model = normalizeHuggingFaceModel(
      {
        id: 'Example/Future-Dtype',
        pipeline_tag: 'text-to-image',
        safetensors: {
          parameters: { BF16: 100, FUTURE4: 900 },
          total: 1000,
        },
      },
      {},
    )

    expect(model.tensorSizeBytes).toBeNull()
  })

  it('uses the floating dtype map when the Hub safetensors total is self-contradictory', () => {
    const model = normalizeHuggingFaceModel(
      {
        ...metadata,
        id: 'tencent/UI-Mate-27B',
        safetensors: {
          total: 3_054_832,
          parameters: { BF16: 27_356_728_560 },
        },
      },
      hybridConfig,
    )

    expect(model.parametersB).toBe(27.35672856)
    expect(model.spec?.parametersB).toBe(27.35672856)
  })

  it('keeps bidirectional encoders out of autoregressive KV-cache estimates', () => {
    const model = normalizeHuggingFaceModel(
      {
        id: 'LiquidAI/LFM2.5-Encoder-350M',
        pipeline_tag: 'fill-mask',
        tags: ['transformers', 'fill-mask', 'bidirectional', 'masked-lm', 'encoder'],
        safetensors: { total: 354_483_968, parameters: { BF16: 354_483_968 } },
      },
      {
        architectures: ['Lfm2BidirectionalForMaskedLM'],
        model_type: 'lfm2',
        num_hidden_layers: 16,
        num_key_value_heads: 6,
        num_attention_heads: 24,
        head_dim: 64,
        max_position_embeddings: 128000,
      },
    )

    expect(model.modelKind).toBe('embedding')
    expect(model.estimateReason).toBe('encoder-model')
    expect(model.spec).toBeNull()
  })

  it('does not infer a text-generation KV cache from Transformer layer fields alone', () => {
    const model = normalizeHuggingFaceModel(
      {
        id: 'Example/CLIP-Vision',
        safetensors: { parameters: { BF16: 1_000_000 } },
      },
      {
        architectures: ['CLIPVisionModel'],
        model_type: 'clip_vision_model',
        num_hidden_layers: 24,
        num_key_value_heads: 8,
        num_attention_heads: 16,
        head_dim: 64,
        max_position_embeddings: 16_384,
      },
    )

    expect(model.modelKind).toBe('image')
    expect(model.spec).toBeNull()
    expect(model.resourceEstimate).toMatchObject({
      kind: 'model-weights',
      options: [{ components: [{ sizeBytes: 2_000_000 }] }],
    })
  })

  it('gives an encoder a static loaded-weight estimate without an autoregressive spec', () => {
    const model = normalizeHuggingFaceModel(
      {
        id: 'LiquidAI/LFM2.5-Encoder-350M',
        pipeline_tag: 'fill-mask',
        tags: ['transformers', 'fill-mask', 'bidirectional', 'encoder'],
        safetensors: { parameters: { BF16: 354_483_968 } },
      },
      {
        architectures: ['Lfm2BidirectionalForMaskedLM'],
        model_type: 'lfm2',
        num_hidden_layers: 16,
        num_key_value_heads: 6,
        num_attention_heads: 24,
        head_dim: 64,
        max_position_embeddings: 128000,
      },
    )

    expect(model).toMatchObject({
      spec: null,
      resourceEstimate: {
        kind: 'encoder',
        options: [{
          id: 'published-weights',
          label: 'Encoder weights',
          components: [{
            label: 'Encoder weights',
            sizeBytes: 708_967_936,
          }],
        }],
      },
    })
  })

  it('classifies segmentation and speech-analysis pipelines by their primary modality', () => {
    const image = normalizeHuggingFaceModel(
      {
        id: 'facebook/sam3',
        pipeline_tag: 'mask-generation',
        tags: ['feature-extraction', 'mask-generation'],
        safetensors: { total: 859_922_360, parameters: { BF16: 859_922_360 } },
      },
      {},
    )
    const audio = normalizeHuggingFaceModel(
      {
        id: 'pyannote/segmentation-3.0',
        pipeline_tag: 'voice-activity-detection',
        tags: ['speaker-segmentation', 'feature-extraction'],
      },
      {},
    )

    expect(image.modelKind).toBe('image')
    expect(image.estimateReason).toBe('modality-specific')
    expect(audio.modelKind).toBe('audio')
    expect(audio.estimateReason).toBe('modality-specific')
  })

  it('keeps modality-specific reasons when lineage checks also fail', () => {
    const model = normalizeHuggingFaceModel(
      {
        id: 'Example/Video-Quant',
        pipeline_tag: 'image-to-video',
        gguf: { total: 21_004_025_600 },
      },
      {},
      { allowEstimate: false, estimateReason: 'parameter-mismatch' },
    )

    expect(model.modelKind).toBe('video')
    expect(model.estimateReason).toBe('modality-specific')
  })

  it('describes quantization from method and bit fields when format is absent', () => {
    const model = normalizeHuggingFaceModel(
      metadata,
      {
        ...hybridConfig,
        quantization_config: { quant_method: 'auto-round', bits: 4 },
      },
    )

    expect(model.quantizationFormat).toBe('auto-round-4bit')
  })

  it('preserves detected variants, parameter semantics, and MTP addon facts', () => {
    const variants: HuggingFaceVariant[] = [{
      id: 'main:model.gguf',
      label: 'GGUF Q4_K_M',
      format: 'gguf',
      revision: 'mainsha',
      path: 'model.gguf',
      source: 'file',
      role: 'model',
      bitsPerWeight: 4,
      weightSizeBytes: 1_000_000_000,
      totalSizeBytes: 1_000_000_000,
    }]
    const model = normalizeHuggingFaceModel(metadata, hybridConfig, {
      variants,
      parameterCountKind: 'tensor-elements',
      addon: {
        kind: 'mtp',
        baseModelId: 'Qwen/Qwen3.8-27B',
        parametersB: 0.46,
        sizeBytes: 1_000_000_000,
      },
    })

    expect(model.variants).toEqual(variants)
    expect(model.parameterCountKind).toBe('tensor-elements')
    expect(model.addon).toEqual({
      kind: 'mtp',
      baseModelId: 'Qwen/Qwen3.8-27B',
      parametersB: 0.46,
      sizeBytes: 1_000_000_000,
    })
  })

  it('does not invent a fractional head dimension', () => {
    const model = normalizeHuggingFaceModel(
      metadata,
      {
        num_hidden_layers: 32,
        num_key_value_heads: 8,
        num_attention_heads: 24,
        hidden_size: 5120,
        max_position_embeddings: 32768,
      },
    )

    expect(model.spec).toBeNull()
  })
})
