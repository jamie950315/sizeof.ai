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
