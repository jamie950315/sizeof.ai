import type { ModelSpec } from '../data/models'

export interface HuggingFaceRoute {
  owner: string
  repo: string
}

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
  const safetensors = asRecord(metadata.safetensors)
  const parameters = positiveNumber(safetensors.total)
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
  const layerTypes = stringArray(textConfig.layer_types)
  const fullAttentionLayers = layerTypes.filter((item) => item === 'full_attention').length
  const attentionLayers = fullAttentionLayers > 0 ? fullAttentionLayers : layers
  const architecture = stringArray(config.architectures)[0] ?? null
  const modelType = asString(config.model_type) ?? asString(textConfig.model_type)
  const pipelineTag = asString(metadata.pipeline_tag)
  const sourceUrl = `https://huggingface.co/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
  const licenseFromTag = tags.find((tag) => tag.startsWith('license:'))?.slice('license:'.length) ?? null
  const lastModified = asString(metadata.lastModified)
  const releaseYear = lastModified ? new Date(lastModified).getUTCFullYear() : new Date().getUTCFullYear()

  const canEstimate = [parameters, layers, attentionLayers, kvHeads, headDim, maxContext]
    .every((value) => value !== null && Number.isFinite(value) && value > 0)

  const spec: ModelSpec | null = canEstimate ? {
    id: createModelId(owner, name),
    name,
    family: modelType ?? 'Hugging Face',
    maker: asString(metadata.author) ?? owner,
    parametersB: parameters! / 1_000_000_000,
    layers: layers!,
    attentionLayers: attentionLayers!,
    kvHeads: kvHeads!,
    headDim: headDim!,
    maxContext: maxContext!,
    releaseYear: Number.isFinite(releaseYear) ? releaseYear : new Date().getUTCFullYear(),
    strengths: pipelineTag ? [pipelineTag] : [],
    sourceUrl,
  } : null

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
    license: asString(cardData.license) ?? licenseFromTag,
    tags: tags.filter((tag) => !tag.startsWith('license:')).slice(0, 12),
    architecture,
    modelType,
    sourceUrl,
    spec,
  }
}
