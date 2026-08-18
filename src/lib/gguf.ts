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
