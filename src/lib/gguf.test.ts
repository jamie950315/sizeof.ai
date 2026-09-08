import { describe, expect, it } from 'vitest'
import { deriveGgufModelFacts, parseGgufMetadataPrefix } from './gguf'

function ggufMetadataFixture(entries: Array<[string, string | number]>) {
  const bytes: number[] = [...new TextEncoder().encode('GGUF')]
  const uint32 = (value: number) => {
    const buffer = new ArrayBuffer(4)
    new DataView(buffer).setUint32(0, value, true)
    bytes.push(...new Uint8Array(buffer))
  }
  const uint64 = (value: number) => {
    const buffer = new ArrayBuffer(8)
    new DataView(buffer).setBigUint64(0, BigInt(value), true)
    bytes.push(...new Uint8Array(buffer))
  }
  const string = (value: string) => {
    const encoded = new TextEncoder().encode(value)
    uint64(encoded.length)
    bytes.push(...encoded)
  }
  uint32(3)
  uint64(0)
  uint64(entries.length)
  for (const [key, value] of entries) {
    string(key)
    if (typeof value === 'string') {
      uint32(8)
      string(value)
    } else {
      uint32(4)
      uint32(value)
    }
  }
  return new Uint8Array(bytes).buffer
}

describe('deriveGgufModelFacts', () => {
  it('bounds layer allocations even for a tiny malicious metadata prefix', () => {
    expect(deriveGgufModelFacts({
      'general.architecture': 'llama', 'general.type': 'model',
      'llama.block_count': 4_294_967_295,
      'llama.attention.head_count': 32, 'llama.attention.head_count_kv': 8,
      'llama.attention.key_length': 128, 'llama.context_length': 8192,
    }, 8_000_000_000)).toBeNull()
  })
  it('reads calculator metadata from a bounded GGUF prefix', () => {
    const metadata = parseGgufMetadataPrefix(ggufMetadataFixture([
      ['general.architecture', 'qwen35'],
      ['general.type', 'model'],
      ['general.size_label', '27B'],
      ['qwen35.block_count', 65],
      ['qwen35.context_length', 262_144],
      ['qwen35.attention.head_count', 24],
      ['qwen35.attention.head_count_kv', 4],
      ['qwen35.attention.key_length', 256],
      ['qwen35.nextn_predict_layers', 1],
      ['qwen35.full_attention_interval', 4],
    ]))

    expect(metadata).toMatchObject({
      'general.architecture': 'qwen35',
      'general.size_label': '27B',
      'qwen35.block_count': 65,
      'qwen35.attention.key_length': 256,
    })
    expect(deriveGgufModelFacts(metadata, null)?.parameterCount).toBe(27_000_000_000)
  })

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
