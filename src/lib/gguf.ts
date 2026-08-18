export interface GgufModelFacts {
  parameterCount: number
  config: {
    architectures: string[]
    model_type: string
    num_hidden_layers: number
    num_attention_heads: number
    num_key_value_heads: number
    head_dim: number
    max_position_embeddings: number
    layer_types: string[]
  }
}

class GgufPrefixReader {
  private offset = 0
  private readonly view: DataView
  private readonly decoder = new TextDecoder()

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer)
  }

  private take(length: number) {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.view.byteLength) {
      throw new Error('Truncated GGUF metadata prefix')
    }
    const start = this.offset
    this.offset += length
    return start
  }

  uint8() { return this.view.getUint8(this.take(1)) }
  int8() { return this.view.getInt8(this.take(1)) }
  uint16() { return this.view.getUint16(this.take(2), true) }
  int16() { return this.view.getInt16(this.take(2), true) }
  uint32() { return this.view.getUint32(this.take(4), true) }
  int32() { return this.view.getInt32(this.take(4), true) }
  float32() { return this.view.getFloat32(this.take(4), true) }
  uint64() {
    const value = this.view.getBigUint64(this.take(8), true)
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Unsafe GGUF integer')
    return Number(value)
  }
  int64() {
    const value = this.view.getBigInt64(this.take(8), true)
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new Error('Unsafe GGUF integer')
    }
    return Number(value)
  }
  float64() { return this.view.getFloat64(this.take(8), true) }
  string() {
    const length = this.uint64()
    if (length > 1_048_576) throw new Error('Oversized GGUF metadata string')
    const start = this.take(length)
    return this.decoder.decode(new Uint8Array(this.view.buffer, start, length))
  }

  value(type: number, depth = 0): unknown {
    if (depth > 2) throw new Error('Nested GGUF array is too deep')
    if (type === 0) return this.uint8()
    if (type === 1) return this.int8()
    if (type === 2) return this.uint16()
    if (type === 3) return this.int16()
    if (type === 4) return this.uint32()
    if (type === 5) return this.int32()
    if (type === 6) return this.float32()
    if (type === 7) return this.uint8() !== 0
    if (type === 8) return this.string()
    if (type === 9) {
      const itemType = this.uint32()
      const length = this.uint64()
      if (length > 1_024) throw new Error('Large GGUF array is outside the metadata prefix')
      return Array.from({ length }, () => this.value(itemType, depth + 1))
    }
    if (type === 10) return this.uint64()
    if (type === 11) return this.int64()
    if (type === 12) return this.float64()
    throw new Error('Unknown GGUF metadata value type')
  }
}

export function parseGgufMetadataPrefix(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 24 || new TextDecoder().decode(bytes.slice(0, 4)) !== 'GGUF') return {}

  const metadata: Record<string, unknown> = {}
  try {
    const reader = new GgufPrefixReader(buffer)
    reader.uint32()
    const version = reader.uint32()
    if (version < 2 || version > 3) return {}
    reader.uint64()
    const entryCount = reader.uint64()
    if (entryCount > 1_024) return {}

    for (let index = 0; index < entryCount; index += 1) {
      const key = reader.string()
      const type = reader.uint32()
      if (key.startsWith('tokenizer.')) break
      metadata[key] = reader.value(type)
    }
  } catch {
    // A bounded Range response can end after the architecture fields we need.
  }
  return metadata
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function positiveInteger(value: unknown) {
  const number = typeof value === 'bigint' ? Number(value) : value
  return typeof number === 'number' && Number.isSafeInteger(number) && number > 0
    ? number
    : null
}

function parameterCountFromSizeLabel(value: unknown) {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([KMBT])$/i)
  if (!match) return null
  const scale = { K: 1_000, M: 1_000_000, B: 1_000_000_000, T: 1_000_000_000_000 }[match[2].toUpperCase() as 'K' | 'M' | 'B' | 'T']
  const count = Number(match[1]) * scale
  return Number.isSafeInteger(count) && count > 0 ? count : null
}

export function deriveGgufModelFacts(
  value: unknown,
  rawParameterCount: unknown,
): GgufModelFacts | null {
  const metadata = record(value)
  const architecture = typeof metadata['general.architecture'] === 'string'
    ? metadata['general.architecture']
    : null
  const generalType = typeof metadata['general.type'] === 'string'
    ? metadata['general.type']
    : null
  const parameterCount = positiveInteger(rawParameterCount)
    ?? parameterCountFromSizeLabel(metadata['general.size_label'])
  if (!architecture || architecture === 'clip' || generalType !== 'model' || parameterCount === null) {
    return null
  }

  const blockCount = positiveInteger(metadata[`${architecture}.block_count`])
  const nextnLayers = positiveInteger(metadata[`${architecture}.nextn_predict_layers`]) ?? 0
  const layers = blockCount === null ? null : blockCount - nextnLayers
  const attentionHeads = positiveInteger(metadata[`${architecture}.attention.head_count`])
  const kvHeads = positiveInteger(metadata[`${architecture}.attention.head_count_kv`])
  const embeddingLength = positiveInteger(metadata[`${architecture}.embedding_length`])
  const headDim = positiveInteger(metadata[`${architecture}.attention.key_length`])
    ?? (embeddingLength !== null && attentionHeads !== null && embeddingLength % attentionHeads === 0
      ? embeddingLength / attentionHeads
      : null)
  const maxContext = positiveInteger(metadata[`${architecture}.context_length`])
  if (layers === null || layers <= 0 || attentionHeads === null || kvHeads === null
    || headDim === null || maxContext === null) return null

  const fullAttentionInterval = positiveInteger(metadata[`${architecture}.full_attention_interval`]) ?? 1
  const layerTypes = Array.from({ length: layers }, (_, index) => (
    index % fullAttentionInterval === fullAttentionInterval - 1 ? 'full_attention' : 'linear_attention'
  ))
  return {
    parameterCount,
    config: {
      architectures: [`${architecture.toUpperCase()}ForCausalLM`],
      model_type: architecture,
      num_hidden_layers: layers,
      num_attention_heads: attentionHeads,
      num_key_value_heads: kvHeads,
      head_dim: headDim,
      max_position_embeddings: maxContext,
      layer_types: layerTypes,
    },
  }
}
