import { describe, expect, it } from 'vitest'
import { deriveGgufModelFacts } from './gguf'

describe('deriveGgufModelFacts', () => {
  it('turns full-model GGUF metadata into calculator architecture facts', () => {
    const facts = deriveGgufModelFacts({
      'general.architecture': 'qwen35',
      'general.type': 'model',
      'general.name': 'Qwen3.8 27B',
      'qwen35.block_count': 65,
      'qwen35.context_length': 262_144,
      'qwen35.embedding_length': 5_120,
      'qwen35.attention.head_count': 24,
      'qwen35.attention.head_count_kv': 4,
      'qwen35.attention.key_length': 256,
      'qwen35.nextn_predict_layers': 1,
      'qwen35.full_attention_interval': 4,
    }, 27_320_697_856)

    expect(facts?.parameterCount).toBe(27_320_697_856)
    expect(facts?.config).toMatchObject({
      model_type: 'qwen35',
      num_hidden_layers: 64,
      num_attention_heads: 24,
      num_key_value_heads: 4,
      head_dim: 256,
      max_position_embeddings: 262_144,
    })
    expect(facts?.config.layer_types).toHaveLength(64)
    expect(facts?.config.layer_types.filter((type) => type === 'full_attention')).toHaveLength(16)
  })

  it('rejects projectors and incomplete model metadata', () => {
    expect(deriveGgufModelFacts({
      'general.architecture': 'clip',
      'general.type': 'model',
      'clip.block_count': 24,
    }, 460_730_096)).toBeNull()
  })
})
