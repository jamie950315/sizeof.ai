import { describe, expect, it } from 'vitest'
import {
  normalizeHuggingFaceModel,
  parseHuggingFaceModelPath,
} from './huggingface'

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
