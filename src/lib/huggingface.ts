import type { ModelSpec } from '../data/models'
import type { HuggingFaceVariant } from './huggingface-variants'

export interface HuggingFaceRoute {
  owner: string
  repo: string
}

export type HuggingFaceModelKind =
  | 'language'
  | 'vision-language'
  | 'image'
  | 'video'
  | 'audio'
  | 'embedding'
  | 'adapter'
  | 'workflow'
  | 'other'

export type HuggingFaceEstimateReason =
  | 'adapter-only'
  | 'modality-specific'
  | 'workflow-artifact'
  | 'encoder-model'
  | 'parameter-mismatch'
  | 'unverified-base'
  | 'missing-parameters'
  | 'missing-layers'
  | 'missing-context'
  | 'missing-kv-geometry'

export interface HuggingFaceModel {
  id: string
  owner: string
  name: string
  author: string
  parametersB: number | null
  downloads: number
  likes: number
  lastModified: string | null
  pipelineTag: string | null
  libraryName: string | null
  license: string | null
  tags: string[]
  architecture: string | null
  modelType: string | null
  modelKind: HuggingFaceModelKind
  tensorSizeBytes: number | null
  repositorySizeBytes: number | null
  parameterCountKind: 'logical' | 'tensor-elements'
  variants: HuggingFaceVariant[]
  addon: {
    kind: 'mtp'
    baseModelId: string
    parametersB: number | null
    sizeBytes: number | null
  } | null
  estimateReason: HuggingFaceEstimateReason | null
  layers: number | null
  attentionLayers: number | null
  maxContext: number | null
  quantizationFormat: string | null
  configSourceId: string | null
  sourceUrl: string
  spec: ModelSpec | null
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : {}
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function positiveNumber(value: unknown): number | null {
  const number = asNumber(value)
  return number !== null && number > 0 ? number : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

const TENSOR_DTYPE_BYTES: Record<string, number> = {
  BOOL: 1,
  BF16: 2,
  F16: 2,
  F32: 4,
  F64: 8,
  F8_E4M3: 1,
  F8_E5M2: 1,
  F4: 0.5,
  F4_E2M1: 0.5,
  I8: 1,
  U8: 1,
  I16: 2,
  U16: 2,
  I32: 4,
  U32: 4,
  I64: 8,
  U64: 8,
}

function safetensorsSizeBytes(metadata: UnknownRecord): number | null {
  const parameters = asRecord(asRecord(metadata.safetensors).parameters)
  const entries = Object.entries(parameters)
  if (entries.length === 0) return null

  let total = 0
  for (const [dtype, rawCount] of entries) {
    const count = positiveNumber(rawCount)
    const bytesPerParameter = TENSOR_DTYPE_BYTES[dtype.toUpperCase()]
    if (count === null || bytesPerParameter === undefined) return null
    total += count * bytesPerParameter
  }
  return Number.isFinite(total) && total > 0 ? total : null
}

function classifyModel(metadata: UnknownRecord, config: UnknownRecord): HuggingFaceModelKind {
  const pipeline = asString(metadata.pipeline_tag)?.toLowerCase() ?? ''
  const library = asString(metadata.library_name)?.toLowerCase() ?? ''
  const tags = stringArray(metadata.tags).map((tag) => tag.toLowerCase())
  const markers = new Set([pipeline, library, ...tags])
  const contains = (values: string[]) => values.some((value) =>
    markers.has(value) || [...markers].some((marker) => marker.includes(value)))

  if (contains(['base_model:adapter:', 'lora', 'peft', 'adapter'])) return 'adapter'
  if (contains(['image-text-to-text', 'visual-question-answering', 'document-question-answering'])) {
    return 'vision-language'
  }
  if (contains(['text-to-video', 'image-to-video', 'video-generation', 'video-classification'])) {
    return 'video'
  }
  if (contains([
    'text-to-speech', 'text-to-audio', 'automatic-speech-recognition', 'audio-to-audio',
    'audio-classification', 'voice-cloning', 'voice-activity-detection',
    'speaker-diarization', 'speaker-segmentation', 'music-transcription', 'audio-to-midi', 'tts',
  ])) return 'audio'
  if (contains([
    'text-to-image', 'image-to-image', 'image-generation', 'unconditional-image-generation',
    'image-classification', 'mask-generation', 'image-segmentation', 'object-detection',
    'depth-estimation', 'diffusers',
  ])) return 'image'
  if (contains(['comfyui', 'workflow', 'chat-template', 'chat_template'])) return 'workflow'
  if (contains([
    'visual-document-retrieval', 'sentence-similarity', 'feature-extraction',
    'fill-mask', 'masked-lm', 'bidirectional', 'document-retrieval', 'embedding',
  ])) return 'embedding'
  if (contains([
    'text-generation', 'text2text-generation', 'conversational',
    'question-answering', 'summarization', 'translation',
  ])) return 'language'

  const textConfig = Object.keys(asRecord(config.text_config)).length > 0
    ? asRecord(config.text_config)
    : config
  return positiveNumber(textConfig.num_hidden_layers) !== null ? 'language' : 'other'
}

const MODEL_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/

export function parseHuggingFaceModelPath(pathname: string): HuggingFaceRoute | null {
  const rawSegments = pathname.split('/').filter(Boolean)
  if (rawSegments.length !== 2 || rawSegments[0]?.toLowerCase() === 'api') return null

  try {
    const owner = decodeURIComponent(rawSegments[0])
    const repo = decodeURIComponent(rawSegments[1])
    if (!MODEL_SEGMENT.test(owner) || !MODEL_SEGMENT.test(repo)) return null
    return { owner, repo }
  } catch {
    return null
  }
}

function createModelId(owner: string, name: string) {
  return `hf-${owner}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function normalizeHuggingFaceModel(
  rawMetadata: unknown,
  rawConfig: unknown,
  options: {
    allowEstimate?: boolean
    configSourceId?: string
    estimateReason?: HuggingFaceEstimateReason
    modelKindOverride?: HuggingFaceModelKind
    parameterCountOverride?: number
    parameterCountKind?: 'logical' | 'tensor-elements'
    variants?: HuggingFaceVariant[]
    addon?: HuggingFaceModel['addon']
  } = {},
): HuggingFaceModel {
  const metadata = asRecord(rawMetadata)
  const config = asRecord(rawConfig)
  const textConfigCandidate = asRecord(config.text_config)
  const textConfig = Object.keys(textConfigCandidate).length > 0 ? textConfigCandidate : config
  const rawId = asString(metadata.id) ?? asString(metadata.modelId) ?? 'unknown/unknown'
  const [owner = 'unknown', ...nameParts] = rawId.split('/')
  const name = nameParts.join('/') || 'unknown'
  const tags = stringArray(metadata.tags)
  const cardData = asRecord(metadata.cardData)
  const gguf = asRecord(metadata.gguf)
  const parameters = positiveNumber(options.parameterCountOverride)
    ?? getHuggingFaceParameterCount(metadata)
  const layers = positiveNumber(textConfig.num_hidden_layers)
  const kvHeads = positiveNumber(textConfig.num_key_value_heads)
  const attentionHeads = positiveNumber(textConfig.num_attention_heads)
  const hiddenSize = positiveNumber(textConfig.hidden_size)
  const explicitHeadDim = positiveNumber(textConfig.head_dim)
  const headDim = explicitHeadDim ?? (
    hiddenSize !== null && attentionHeads !== null && hiddenSize % attentionHeads === 0
      ? hiddenSize / attentionHeads
      : null
  )
  const maxContext = positiveNumber(textConfig.max_position_embeddings)
    ?? positiveNumber(gguf.context_length)
  const layerTypes = stringArray(textConfig.layer_types)
  const fullAttentionLayers = layerTypes.filter((item) => item === 'full_attention').length
  const linearAttentionConfig = asRecord(textConfig.linear_attn_config)
  const explicitFullAttentionLayers = Array.isArray(linearAttentionConfig.full_attn_layers)
    ? new Set(linearAttentionConfig.full_attn_layers.filter((item): item is number =>
        typeof item === 'number' && Number.isInteger(item) && item >= 0
          && (layers === null || item <= layers),
      )).size
    : 0
  const attentionLayers = fullAttentionLayers > 0
    ? fullAttentionLayers
    : explicitFullAttentionLayers > 0
      ? explicitFullAttentionLayers
      : layers
  const kvLoraRank = positiveNumber(textConfig.kv_lora_rank)
  const qkRopeHeadDim = positiveNumber(textConfig.qk_rope_head_dim)
  const qkNopeHeadDim = positiveNumber(textConfig.qk_nope_head_dim)
  const valueHeadDim = positiveNumber(textConfig.v_head_dim)
  const kvCache = kvLoraRank !== null && qkRopeHeadDim !== null && qkNopeHeadDim !== null
      && valueHeadDim !== null && attentionHeads !== null
    ? {
        kind: 'mla' as const,
        heads: attentionHeads,
        keyHeadDim: qkNopeHeadDim + qkRopeHeadDim,
        valueHeadDim,
        latentDim: kvLoraRank,
        ropeDim: qkRopeHeadDim,
      }
    : kvHeads !== null && headDim !== null
      ? { kind: 'standard' as const, heads: kvHeads, headDim }
      : null
  const architecture = stringArray(config.architectures)[0] ?? null
  const modelType = asString(config.model_type) ?? asString(textConfig.model_type)
    ?? asString(gguf.architecture)
  const pipelineTag = asString(metadata.pipeline_tag)
  const modelKind = options.modelKindOverride ?? classifyModel(metadata, config)
  const tensorSizeBytes = safetensorsSizeBytes(metadata)
  const repositorySizeBytes = positiveNumber(metadata.usedStorage)
  const sourceUrl = `https://huggingface.co/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
  const licenseFromTag = tags.find((tag) => tag.startsWith('license:'))?.slice('license:'.length) ?? null
  const lastModified = asString(metadata.lastModified)
  const releaseYear = lastModified ? new Date(lastModified).getUTCFullYear() : new Date().getUTCFullYear()
  const textQuantizationConfig = asRecord(textConfig.quantization_config)
  const quantizationConfig = Object.keys(textQuantizationConfig).length > 0
    ? textQuantizationConfig
    : asRecord(config.quantization_config)
  const mlxBitTag = asString(metadata.library_name)?.toLowerCase() === 'mlx'
    ? tags.find((tag) => /^\d+-bit$/i.test(tag))?.toLowerCase() ?? null
    : null
  const quantizationFormat = asString(quantizationConfig.format)
    ?? (() => {
      const method = asString(quantizationConfig.quant_method)
        ?? asString(quantizationConfig.quantization_method)
        ?? asString(quantizationConfig.method)
      const bits = positiveNumber(quantizationConfig.bits)
      return method ? `${method}${bits ? `-${bits}bit` : ''}` : null
    })()
    ?? (tags.some((tag) => tag.toLowerCase() === 'fp8') ? 'fp8' : null)
    ?? (mlxBitTag ? `mlx-${mlxBitTag}` : null)
    ?? (positiveNumber(gguf.total) !== null ? 'gguf' : null)
  const cardLicense = asString(cardData.license)
  const license = cardLicense === 'other'
    ? asString(cardData.license_name) ?? cardLicense
    : cardLicense ?? licenseFromTag

  const isLlmMemoryModel = modelKind === 'language' || modelKind === 'vision-language'
    || modelKind === 'other'
  const canEstimate = options.allowEstimate !== false && isLlmMemoryModel
    && [parameters, layers, attentionLayers, maxContext]
    .every((value) => value !== null && Number.isFinite(value) && value > 0)
    && kvCache !== null

  const spec: ModelSpec | null = canEstimate ? {
    id: createModelId(owner, name),
    name,
    family: modelType ?? 'Hugging Face',
    maker: asString(metadata.author) ?? owner,
    parametersB: parameters! / 1_000_000_000,
    layers: layers!,
    attentionLayers: attentionLayers!,
    kvHeads: kvCache?.kind === 'standard' ? kvCache.heads : undefined,
    headDim: kvCache?.kind === 'standard' ? kvCache.headDim : undefined,
    kvCache: kvCache!,
    maxContext: maxContext!,
    releaseYear: Number.isFinite(releaseYear) ? releaseYear : new Date().getUTCFullYear(),
    strengths: pipelineTag ? [pipelineTag] : [],
    sourceUrl,
  } : null

  const estimateReason: HuggingFaceEstimateReason | null = spec !== null
    ? null
    : modelKind === 'adapter'
      ? 'adapter-only'
      : modelKind === 'workflow'
        ? 'workflow-artifact'
        : modelKind === 'embedding'
          ? 'encoder-model'
          : !isLlmMemoryModel
            ? 'modality-specific'
            : options.estimateReason
              ?? (parameters === null
                ? 'missing-parameters'
                : layers === null || attentionLayers === null
                  ? 'missing-layers'
                  : maxContext === null
                    ? 'missing-context'
                    : 'missing-kv-geometry')

  return {
    id: rawId,
    owner,
    name,
    author: asString(metadata.author) ?? owner,
    parametersB: parameters === null ? null : parameters / 1_000_000_000,
    downloads: asNumber(metadata.downloads) ?? 0,
    likes: asNumber(metadata.likes) ?? 0,
    lastModified,
    pipelineTag,
    libraryName: asString(metadata.library_name),
    license,
    tags: tags.filter((tag) => !tag.startsWith('license:')).slice(0, 12),
    architecture,
    modelType,
    modelKind,
    tensorSizeBytes,
    repositorySizeBytes,
    parameterCountKind: options.parameterCountKind ?? 'logical',
    variants: options.variants ?? [],
    addon: options.addon ?? null,
    estimateReason,
    layers,
    attentionLayers,
    maxContext,
    quantizationFormat,
    configSourceId: options.configSourceId ?? null,
    sourceUrl,
    spec,
  }
}

export function getHuggingFaceParameterCount(rawMetadata: unknown): number | null {
  const metadata = asRecord(rawMetadata)
  const safetensors = asRecord(metadata.safetensors)
  const gguf = asRecord(metadata.gguf)
  const dtypeParameters = asRecord(safetensors.parameters)
  const dtypeEntries = Object.entries(dtypeParameters)
  const floatingDtypes = new Set(['BF16', 'F16', 'F32', 'F64'])
  const floatingTotal = dtypeEntries.length > 0
    && dtypeEntries.every(([dtype, count]) => floatingDtypes.has(dtype.toUpperCase())
      && positiveNumber(count) !== null)
    ? dtypeEntries.reduce((sum, [, count]) => sum + (positiveNumber(count) ?? 0), 0)
    : null
  return positiveNumber(floatingTotal)
    ?? positiveNumber(safetensors.total)
    ?? positiveNumber(gguf.total)
}
