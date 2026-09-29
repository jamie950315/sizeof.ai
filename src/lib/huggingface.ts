import type { AttentionProfile, EstimateConfidence, ModelSpec } from '../data/models'
import type { HuggingFaceVariant } from './huggingface-variants'
import { classifyKnownModelTask } from './model-task'

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
  | 'speculative-draft'
  | 'other'

export type HuggingFaceComponentKind =
  | 'model'
  | 'encoder'
  | 'vae'
  | 'adapter'
  | 'workflow'
  | 'draft'
  | 'unknown'

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
  | 'speculative-draft'
  | 'stateful-runtime'

export type HuggingFaceResourceEstimateKind =
  | 'model-weights'
  | 'encoder'
  | 'vae'
  | 'preview-decoder'
  | 'video-pipeline'
  | 'video-lora'
  | 'speculative-draft'

export interface HuggingFaceMoeFacts {
  totalExperts: number | null
  routedExperts: number | null
  sharedExperts: number | null
  expertsPerToken: number | null
  activeParametersB: number | null
  denseLayers: number | null
}

export interface HuggingFaceSpeculativeFacts {
  family: 'mtp' | 'dflash' | 'dflash2' | 'eagle' | 'eagle3' | 'draft-model'
  relation: 'integrated' | 'addon' | 'separate-model'
  targetModelId: string | null
  blockSize: number | null
}

export interface HuggingFaceResourceComponent {
  id: string
  label: string
  sizeBytes: number
  path?: string
  repositoryId?: string
}

export interface HuggingFaceResourceEstimateOption {
  id: string
  label: string
  components: HuggingFaceResourceComponent[]
}

export interface HuggingFaceResourceEstimate {
  kind: HuggingFaceResourceEstimateKind
  title: string
  description: string
  note: string
  baseModelId: string | null
  options: HuggingFaceResourceEstimateOption[]
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
  modelKind: HuggingFaceModelKind
  componentKind: HuggingFaceComponentKind
  tensorSizeBytes: number | null
  repositorySizeBytes: number | null
  parameterCountKind: 'logical' | 'tensor-elements'
  moe: HuggingFaceMoeFacts | null
  speculative: HuggingFaceSpeculativeFacts | null
  attentionProfile: AttentionProfile
  estimateConfidence: EstimateConfidence
  variants: HuggingFaceVariant[]
  resourceEstimate: HuggingFaceResourceEstimate | null
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

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function nonNegativeInteger(value: unknown): number | null {
  const number = asNumber(value)
  return number !== null && Number.isInteger(number) && number >= 0 ? number : null
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

export function isHuggingFaceVae(metadataValue: unknown, configValue: unknown): boolean {
  const metadata = asRecord(metadataValue)
  const config = asRecord(configValue)
  const tags = stringArray(metadata.tags).join(' ')
  const architectures = stringArray(config.architectures).join(' ')
  const modelType = asString(config.model_type) ?? ''
  const text = [tags, architectures, modelType].join(' ').toLowerCase()
  return /(?:^|[\s_\-/])vae(?:$|[\s_\-/])|autoencoder/.test(text)
}

function declaredBaseModel(tags: string[]) {
  const tag = tags.find((item) => /^base_model:[^:]+\/[^:]+$/.test(item))
  return tag?.slice('base_model:'.length) ?? null
}

function speculativeFacts(
  metadata: UnknownRecord,
  config: UnknownRecord,
  addon: HuggingFaceModel['addon'] | null,
): HuggingFaceSpeculativeFacts | null {
  const tags = stringArray(metadata.tags)
  const textConfigCandidate = asRecord(config.text_config)
  const textConfig = Object.keys(textConfigCandidate).length > 0 ? textConfigCandidate : config
  const rawId = asString(metadata.id) ?? asString(metadata.modelId)
  const architectures = stringArray(config.architectures)
  const text = [
    asString(metadata.id) ?? asString(metadata.modelId) ?? '',
    ...tags,
    ...architectures,
    asString(config.model_type) ?? '',
  ].join(' ').toLowerCase()
  const speculatorsConfig = asRecord(config.speculators_config)
  const verifier = asRecord(speculatorsConfig.verifier)
  const targetModelId = asString(verifier.name_or_path) ?? declaredBaseModel(tags)
  const dflashConfig = asRecord(config.dflash_config)
  const blockSize = positiveNumber(dflashConfig.block_size)
  const hasDflashConfig = Object.keys(dflashConfig).length > 0
  const hasSpeculatorsConfig = Object.keys(speculatorsConfig).length > 0
  const hasDraftTag = tags.some((tag) => /^(?:draft-model|draft_model|speculative-decoding|speculative-decoding-draft|speculative-draft)$/i.test(tag))
  const hasDraftArchitecture = architectures.some((architecture) => /draft|speculator|speculative/i.test(architecture))

  const separateFamily = /dflash2/.test(text)
    ? 'dflash2' as const
    : /dflash/.test(text) || hasDflashConfig
      ? 'dflash' as const
      : /eagle3/.test(text)
        ? 'eagle3' as const
        : /eagle/.test(text)
          ? 'eagle' as const
          : /draft-model|draft_model|speculative-decoding-draft/.test(text)
            ? 'draft-model' as const
            : null
  const hasSeparateDraftEvidence = hasDflashConfig || hasSpeculatorsConfig
    || hasDraftTag || hasDraftArchitecture
  if (separateFamily && hasSeparateDraftEvidence) {
    return { family: separateFamily, relation: 'separate-model', targetModelId, blockSize }
  }

  if (addon?.kind === 'mtp') {
    return {
      family: 'mtp', relation: 'addon', targetModelId: addon.baseModelId, blockSize: null,
    }
  }
  const declaredMtpLayers = positiveNumber(textConfig.num_nextn_predict_layers)
    ?? positiveNumber(textConfig.nextn_predict_layers)
  if (declaredMtpLayers !== null || /(?:^|[-_.\s])mtp(?:[-_.\s]|$)/i.test(text)) {
    return { family: 'mtp', relation: 'integrated', targetModelId: targetModelId ?? rawId, blockSize: null }
  }
  return null
}

function isSeparateSpeculativeDraft(metadata: UnknownRecord, config: UnknownRecord) {
  const facts = speculativeFacts(metadata, config, null)
  return facts !== null && facts.relation === 'separate-model'
}

function classifyComponentKind(
  metadata: UnknownRecord,
  config: UnknownRecord,
  modelKind: HuggingFaceModelKind,
): HuggingFaceComponentKind {
  if (isHuggingFaceVae(metadata, config)) return 'vae'
  if (modelKind === 'speculative-draft') return 'draft'
  if (modelKind === 'embedding') return 'encoder'
  if (modelKind === 'adapter') return 'adapter'
  if (modelKind === 'workflow') return 'workflow'
  if (modelKind === 'language' || modelKind === 'vision-language'
    || modelKind === 'image' || modelKind === 'video' || modelKind === 'audio') return 'model'
  return 'unknown'
}

function staticResourceEstimate(
  modelKind: HuggingFaceModelKind,
  componentKind: HuggingFaceComponentKind,
  tensorSizeBytes: number | null,
): HuggingFaceResourceEstimate | null {
  if (tensorSizeBytes === null || tensorSizeBytes <= 0) return null

  if (componentKind === 'vae') {
    return {
      kind: 'vae',
      title: 'VAE loaded weights',
      description: 'Static VAE weights. This component does not use an autoregressive KV cache.',
      note: 'This is VAE weight residency only. Image or video resolution, frames, activations, and the surrounding pipeline add runtime memory.',
      baseModelId: null,
      options: [{
        id: 'published-weights',
        label: 'VAE weights',
        components: [{ id: 'vae-weights', label: 'VAE weights', sizeBytes: tensorSizeBytes }],
      }],
    }
  }

  if (modelKind === 'embedding') {
    return {
      kind: 'encoder',
      title: 'Encoder loaded weights',
      description: 'Static model weights for this bidirectional encoder. It does not use an autoregressive KV cache.',
      note: 'This is published model-weight residency only. Batch size, sequence length, and framework activations add runtime memory.',
      baseModelId: null,
      options: [{
        id: 'published-weights',
        label: 'Encoder weights',
        components: [{ id: 'encoder-weights', label: 'Encoder weights', sizeBytes: tensorSizeBytes }],
      }],
    }
  }

  if (modelKind === 'speculative-draft') {
    return {
      kind: 'speculative-draft',
      title: 'Speculative draft loaded weights',
      description: 'Published weights for this draft model. It must be paired with its declared target model.',
      note: 'This is draft weight residency only. The target model, target cache, draft cache, block size, batching, and inference engine add runtime memory.',
      baseModelId: null,
      options: [{
        id: 'published-draft-weights',
        label: 'Draft weights',
        components: [{ id: 'draft-weights', label: 'Draft weights', sizeBytes: tensorSizeBytes }],
      }],
    }
  }

  if (['image', 'video', 'audio'].includes(modelKind)) {
    return {
      kind: 'model-weights',
      title: 'Published loaded weights',
      description: 'Static weights published for this non-text-generation model. It does not use an autoregressive KV cache.',
      note: 'This is model-weight residency only, not a pipeline peak. Resolution, frames, batching, activations, and offload can add substantial runtime memory.',
      baseModelId: null,
      options: [{
        id: 'published-weights',
        label: 'Published weights',
        components: [{ id: 'published-weights', label: 'Published weights', sizeBytes: tensorSizeBytes }],
      }],
    }
  }

  if (modelKind === 'language' || modelKind === 'vision-language') {
    return {
      kind: 'model-weights',
      title: 'Published loaded weights',
      description: 'Published model weights. The repository does not expose enough cache or recurrent-state geometry for a safe total runtime estimate.',
      note: 'This is weight residency only. KV cache, recurrent state, activations, batching, and engine-specific workspaces are not included.',
      baseModelId: null,
      options: [{
        id: 'published-weights',
        label: 'Published weights',
        components: [{ id: 'published-weights', label: 'Published weights', sizeBytes: tensorSizeBytes }],
      }],
    }
  }

  return null
}

function classifyModel(metadata: UnknownRecord, config: UnknownRecord): HuggingFaceModelKind {
  const pipeline = asString(metadata.pipeline_tag)?.toLowerCase() ?? ''
  const library = asString(metadata.library_name)?.toLowerCase() ?? ''
  const tags = stringArray(metadata.tags).map((tag) => tag.toLowerCase())
  const markers = new Set([pipeline, library, ...tags])
  const contains = (values: string[]) => values.some((value) =>
    markers.has(value) || [...markers].some((marker) => marker.includes(value)))
  const architectureText = [
    ...stringArray(config.architectures),
    asString(config.model_type) ?? '',
    asString(asRecord(config.text_config).model_type) ?? '',
  ].join(' ').toLowerCase()

  if (isHuggingFaceVae(metadata, config)) return 'image'
  if (isSeparateSpeculativeDraft(metadata, config)) return 'speculative-draft'
  if (contains(['base_model:adapter:', 'lora', 'peft', 'adapter'])) return 'adapter'
  if (contains(['comfyui', 'workflow', 'chat-template', 'chat_template'])) return 'workflow'
  const knownTaskKind = classifyKnownModelTask(markers)
  if (knownTaskKind) return knownTaskKind

  if (/(?:clip.*vision|vision.*(?:model|encoder)|image.*encoder|vit(?:model)?)/.test(architectureText)) {
    return 'image'
  }
  if (/(?:audio.*(?:model|encoder)|wav2vec|whisper|hubert|speech)/.test(architectureText)) return 'audio'
  if (/(?:bert|roberta|encoder(?:model)?|embedding)/.test(architectureText)) return 'embedding'
  if (/(?:causallm|forcausal|gpt|llama|qwen|mistral|gemma|phi|falcon|deepseek|baichuan|mixtral|kimi)/.test(architectureText)) {
    return 'language'
  }
  return 'other'
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

function countPeriodicLayers(layers: number | null, period: number | null, offset: number | null) {
  if (layers === null || period === null || offset === null || period <= 0) return 0
  return Math.max(0, Math.ceil((layers - offset) / period))
}

function deriveAttentionProfile(textConfig: UnknownRecord, layers: number | null): AttentionProfile {
  const declaredLayerTypes = stringArray(textConfig.layer_types).map((item) => item.toLowerCase())
  const blockTypes = stringArray(textConfig.block_types).map((item) => item.toLowerCase())
  const layerTypes = declaredLayerTypes
  const repetitions = (index: number, length: number) => layers === null ? 1
    : Math.max(0, Math.ceil((layers - index) / length))
  const countTypes = (predicate: (type: string) => boolean) => layerTypes.reduce(
    (total, type, index) => total + (predicate(type) ? repetitions(index, layerTypes.length) : 0), 0)
  const linearConfig = asRecord(textConfig.linear_attn_config)
  const rawFullIndices = Array.isArray(linearConfig.full_attn_layers)
    ? linearConfig.full_attn_layers.filter((item): item is number => typeof item === 'number' && Number.isInteger(item))
    : []
  const rawKdaIndices = Array.isArray(linearConfig.kda_layers)
    ? linearConfig.kda_layers.filter((item): item is number => typeof item === 'number' && Number.isInteger(item))
    : []
  const allExplicitIndices = [...rawFullIndices, ...rawKdaIndices]
  const usesOneBasedIndices = layers !== null && allExplicitIndices.includes(layers)
    && !allExplicitIndices.includes(0)
  const normalizeIndices = (indices: number[]) => new Set(indices
    .map((item) => usesOneBasedIndices ? item - 1 : item)
    .filter((item) => item >= 0 && (layers === null || item < layers)))
  const explicitFull = normalizeIndices(rawFullIndices).size
  const explicitKda = normalizeIndices(rawKdaIndices).size
  let fullLayers = countTypes((item) => item === 'full_attention')
  let slidingLayers = countTypes((item) => /sliding|local/.test(item))
  let linearLayers = countTypes((item) => item === 'linear_attention')
  let kdaLayers = countTypes((item) => item.includes('kda'))
  let recurrentLayers = countTypes((item) => item.includes('recurrent'))
  let ssmLayers = countTypes((item) => /mamba|ssm|state_space/.test(item))

  if (layerTypes.length === 0 && blockTypes.length > 0 && layers !== null) {
    for (let index = 0; index < blockTypes.length; index += 1) {
      const role = blockTypes[index]
      const count = repetitions(index, blockTypes.length)
      if (role === 'linear_attention' || role.includes('linear')) linearLayers += count
      else if (role.includes('kda')) kdaLayers += count
      else if (role.includes('recurrent')) recurrentLayers += count
      else if (/mamba|ssm|state/.test(role)) ssmLayers += count
      else if (/sliding|local/.test(role)) slidingLayers += count
      else fullLayers += count
    }
  }
  if (fullLayers === 0 && explicitFull > 0) fullLayers = explicitFull
  if (kdaLayers === 0 && explicitKda > 0) kdaLayers = explicitKda
  if (layers !== null && explicitFull > 0 && kdaLayers === 0 && linearLayers === 0) {
    linearLayers = Math.max(0, layers - explicitFull)
  }
  if (layers !== null && fullLayers + slidingLayers + linearLayers + kdaLayers
      + recurrentLayers + ssmLayers === 0) {
    const period = positiveInteger(textConfig.attn_layer_period)
    const offset = nonNegativeInteger(textConfig.attn_layer_offset)
    const periodicAttention = countPeriodicLayers(layers, period, offset)
    const hasMambaState = positiveNumber(textConfig.mamba_d_state) !== null
      || positiveNumber(textConfig.state_size) !== null
      || /mamba|jamba/.test(asString(textConfig.model_type)?.toLowerCase() ?? '')
    if (periodicAttention > 0) {
      fullLayers = periodicAttention
      ssmLayers = hasMambaState ? layers - periodicAttention : 0
    } else if (hasMambaState) {
      ssmLayers = layers
    } else if (positiveNumber(textConfig.sliding_window) !== null
      || positiveNumber(textConfig.attention_window_size) !== null) {
      slidingLayers = layers
    } else {
      fullLayers = layers
    }
  }

  const slidingWindow = positiveNumber(textConfig.sliding_window)
    ?? positiveNumber(textConfig.attention_window_size)
  const stateKind = kdaLayers > 0
    ? 'kda' as const
    : ssmLayers > 0
      ? 'mamba' as const
      : recurrentLayers > 0
        ? 'recurrent' as const
        : linearLayers > 0
          ? 'linear' as const
          : null
  return {
    fullLayers,
    slidingLayers,
    linearLayers,
    kdaLayers,
    recurrentLayers,
    ssmLayers,
    slidingWindow,
    stateKind,
  }
}

const CURATED_ACTIVE_PARAMETERS_B: Record<string, number> = {
  'deepseek-ai/deepseek-v3': 37,
  'moonshotai/kimi-k2-thinking': 32,
  'openai/gpt-oss-20b': 3.6,
  'openai/gpt-oss-120b': 5.1,
  'qwen/qwen3-30b-a3b': 3.3,
  'qwen/qwen3-235b-a22b': 22,
}

function deriveMoeFacts(textConfig: UnknownRecord, modelId: string): HuggingFaceMoeFacts | null {
  const totalExperts = positiveNumber(textConfig.num_experts)
    ?? positiveNumber(textConfig.num_local_experts)
  const routedExperts = positiveNumber(textConfig.n_routed_experts)
  const sharedExperts = positiveNumber(textConfig.n_shared_experts)
  const expertsPerToken = positiveNumber(textConfig.num_experts_per_tok)
    ?? positiveNumber(textConfig.num_experts_per_token)
    ?? positiveNumber(textConfig.experts_per_token)
  const denseLayers = positiveNumber(textConfig.first_k_dense_replace)
  if (totalExperts === null && routedExperts === null && sharedExperts === null
    && expertsPerToken === null) return null

  const explicitActive = positiveNumber(textConfig.num_active_parameters)
    ?? positiveNumber(textConfig.active_parameters)
  const activeFromName = modelId.match(/(?:^|[-_.])A(\d+(?:\.\d+)?)B(?:[-_.]|$)/i)
  const activeParametersB = explicitActive !== null
    ? explicitActive > 1_000_000 ? explicitActive / 1_000_000_000 : explicitActive
    : activeFromName ? Number(activeFromName[1])
      : CURATED_ACTIVE_PARAMETERS_B[modelId.toLowerCase()] ?? null
  return {
    totalExperts,
    routedExperts,
    sharedExperts,
    expertsPerToken,
    activeParametersB,
    denseLayers,
  }
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
    resourceEstimate?: HuggingFaceResourceEstimate | null
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
  const layers = positiveInteger(textConfig.num_hidden_layers)
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
  const attentionProfile = deriveAttentionProfile(textConfig, layers)
  const attentionLayers = layers === null ? null : attentionProfile.fullLayers
  const hasContextScaledCache = attentionProfile.fullLayers + attentionProfile.slidingLayers > 0
  const hasArchitectureState = attentionProfile.linearLayers + attentionProfile.kdaLayers
    + attentionProfile.recurrentLayers + attentionProfile.ssmLayers > 0
  const estimateConfidence: EstimateConfidence = !hasContextScaledCache && hasArchitectureState
    ? 'weights-only'
    : attentionProfile.slidingLayers > 0 || hasArchitectureState
      ? 'runtime-specific'
      : 'safe'
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
  const componentKind = classifyComponentKind(metadata, config, modelKind)
  const tensorSizeBytes = safetensorsSizeBytes(metadata)
  const speculative = speculativeFacts(metadata, config, options.addon ?? null)
  const moe = deriveMoeFacts(textConfig, rawId)
  const resourceEstimate = options.resourceEstimate ?? staticResourceEstimate(
    modelKind,
    componentKind,
    tensorSizeBytes,
  )
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

  const isLlmMemoryModel = componentKind !== 'vae'
    && (modelKind === 'language' || modelKind === 'vision-language')
  const canEstimate = options.allowEstimate !== false && isLlmMemoryModel
    && [parameters, layers, maxContext]
    .every((value) => value !== null && Number.isFinite(value) && value > 0)
    && hasContextScaledCache
    && kvCache !== null

  const spec: ModelSpec | null = canEstimate ? {
    id: createModelId(owner, name),
    name,
    family: modelType ?? 'Hugging Face',
    maker: asString(metadata.author) ?? owner,
    parametersB: parameters! / 1_000_000_000,
    layers: layers!,
    attentionLayers: attentionLayers!,
    attentionProfile,
    estimateConfidence,
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
        : modelKind === 'speculative-draft'
          ? 'speculative-draft'
        : modelKind === 'embedding'
          ? 'encoder-model'
          : estimateConfidence === 'weights-only'
            ? 'stateful-runtime'
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
    componentKind,
    tensorSizeBytes,
    repositorySizeBytes,
    parameterCountKind: options.parameterCountKind ?? 'logical',
    moe,
    speculative,
    attentionProfile,
    estimateConfidence,
    variants: options.variants ?? [],
    resourceEstimate,
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
