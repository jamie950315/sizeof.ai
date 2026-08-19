import { describe, expect, it } from 'vitest'
import {
  normalizeHuggingFaceModel,
  parseHuggingFaceModelPath,
} from './huggingface'
import type { HuggingFaceVariant } from './huggingface-variants'

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
