import { engineProfiles, type EngineProfileId, type ServingHardwareKind } from '../data/engine-profiles'
import { kvPrecisions, quantizations, type KvPrecisionId, type QuantizationId } from '../data/quantizations'
import { buildModelEvidence, type EvidenceEntry } from './evidence'
import { classifyFit, estimateVram, type Fit, type VramEstimate } from './estimator'
import { parseHuggingFaceModelPath, type HuggingFaceModel } from './huggingface'
import type { HuggingFaceVariant } from './huggingface-variants'
import { buildFitAdjustments, findHighestPrecisionFit, findMaximumSafeContext } from './planner'
import { estimateServingScenario, type ServingScenarioEstimate } from './serving-estimator'

export const PUBLIC_ESTIMATE_DISCLAIMER = 'Estimate only. Verify on the target runtime and hardware; engines, drivers, batching, offload, and workload can change actual memory use.'

const MAX_CONTEXT = 16_777_216
const MAX_CAPACITY_GIB = 4096
const MAX_SOURCE_LENGTH = 96
const MAX_ARTIFACT_LENGTH = 120
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const PARAMETER_NAMES = new Set([
  'model', 'quant', 'context', 'kv', 'mla', 'vram', 'profile', 'source', 'artifact',
  'engine', 'prompt', 'generated', 'concurrency',
])

export interface PublicEstimateInput {
  model: string
  quantization: QuantizationId
  context: number
  kvPrecision: KvPrecisionId
  mlaCacheMode: 'expanded' | 'latent'
  capacityGiB: number
  hardwareKind: Exclude<ServingHardwareKind, null>
  source: string
  artifactId: string | null
  engine: EngineProfileId | null
  promptTokens: number
  generatedTokens: number
  concurrency: number
}

export type PublicEstimateParseResult =
  | { ok: true; value: PublicEstimateInput }
  | { ok: false; error: string }

export interface PublicEstimateResponse {
  schema: 'sizeof-estimate/v1'
  model: {
    id: string
    owner: string
    name: string
    kind: HuggingFaceModel['modelKind']
    parametersB: number | null
    layers: number | null
    maxContext: number | null
    estimateConfidence: HuggingFaceModel['estimateConfidence']
    sourceUrl: string
    repositoryUpdatedAt: string | null
  }
  configuration: {
    quantization: QuantizationId
    context: number
    kvPrecision: KvPrecisionId
    mlaCacheMode: 'expanded' | 'latent'
    source: string
    artifactId: string | null
  }
  hardware: {
    profile: Exclude<ServingHardwareKind, null>
    capacityGiB: number
  }
  result: {
    state: 'estimate' | 'lower-bound' | 'unavailable'
    estimate: VramEstimate | null
    fit: Fit | null
    headroomGiB: number | null
    reason: string | null
  }
  planner: {
    maximumSafeContext: ReturnType<typeof findMaximumSafeContext> | null
    highestPrecisionFit: ReturnType<typeof findHighestPrecisionFit> | null
    adjustments: ReturnType<typeof buildFitAdjustments>
  }
  evidence: EvidenceEntry[]
  provenance: {
    modelSource: string
    configSourceId: string | null
    parameterCountKind: HuggingFaceModel['parameterCountKind']
    artifact: {
      id: string
      path: string
      format: HuggingFaceVariant['format']
      revision: string
      weightSizeBytes: number
      sourceUrl: string | null
    } | null
  }
  serving: ServingScenarioEstimate | null
  sourceUrl: string
  detailUrl: string
  apiReproductionUrl: string
  generatedAt: string
  disclaimer: string
}

function positiveInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  if (value === null) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null
}

function positiveFinite(value: string | null, fallback: number, maximum: number) {
  if (value === null) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 && parsed <= maximum ? parsed : null
}

export function parsePublicEstimateQuery(query: string | URLSearchParams): PublicEstimateParseResult {
  const params = typeof query === 'string' ? new URLSearchParams(query) : query
  for (const key of params.keys()) {
    if (!PARAMETER_NAMES.has(key)) return { ok: false, error: `Unknown parameter: ${key}` }
    if (params.getAll(key).length !== 1) return { ok: false, error: `Duplicate parameter: ${key}` }
  }
  const modelValue = params.get('model') ?? ''
  const route = parseHuggingFaceModelPath(`/${modelValue}`)
  if (!route || `${route.owner}/${route.repo}` !== modelValue) {
    return { ok: false, error: 'model must be a canonical owner/repository path' }
  }
  const quantization = params.get('quant') ?? 'q4_k_m'
  if (!quantizations.some((item) => item.id === quantization)) return { ok: false, error: 'quant is not supported' }
  const context = positiveInteger(params.get('context'), 4096, 1024, MAX_CONTEXT)
  if (context === null || context % 1024 !== 0) return { ok: false, error: 'context must be a 1024-token step between 1024 and 16777216' }
  const kvPrecision = params.get('kv') ?? 'fp16'
  if (!kvPrecisions.some((item) => item.id === kvPrecision)) return { ok: false, error: 'kv is not supported' }
  const mlaCacheMode = params.get('mla') ?? 'expanded'
  if (mlaCacheMode !== 'expanded' && mlaCacheMode !== 'latent') return { ok: false, error: 'mla must be expanded or latent' }
  const capacityGiB = positiveFinite(params.get('vram'), 32, MAX_CAPACITY_GIB)
  if (capacityGiB === null) return { ok: false, error: 'vram must be a finite value between 0 and 4096 GiB' }
  const profile = params.get('profile') ?? 'discrete-gpu'
  if (profile !== 'discrete-gpu' && profile !== 'unified-memory') return { ok: false, error: 'profile must be discrete-gpu or unified-memory' }
  const source = params.get('source') ?? 'estimated'
  if (source.length > MAX_SOURCE_LENGTH || !SAFE_ID.test(source)) return { ok: false, error: 'source is invalid' }
  const artifactId = params.get('artifact')
  if (artifactId !== null && (artifactId.length > MAX_ARTIFACT_LENGTH || !SAFE_ID.test(artifactId))) {
    return { ok: false, error: 'artifact is invalid' }
  }
  if ((source === 'estimated') !== (artifactId === null)) {
    return { ok: false, error: 'artifact and a non-estimated source must be provided together' }
  }
  const engineValue = params.get('engine')
  const engine = engineValue === null ? null : engineProfiles.find((item) => item.id === engineValue)?.id ?? null
  if (engineValue !== null && engine === null) return { ok: false, error: 'engine is not supported' }
  const promptTokens = positiveInteger(params.get('prompt'), 2048, 1, MAX_CONTEXT)
  const generatedTokens = positiveInteger(params.get('generated'), 256, 1, MAX_CONTEXT)
  const concurrency = positiveInteger(params.get('concurrency'), 1, 1, 256)
  if (promptTokens === null || generatedTokens === null || concurrency === null) {
    return { ok: false, error: 'prompt, generated, and concurrency must be bounded positive integers' }
  }
  if (engine && promptTokens + generatedTokens > MAX_CONTEXT) {
    return { ok: false, error: 'prompt and generated tokens exceed the supported bound' }
  }
  return {
    ok: true,
    value: {
      model: modelValue,
      quantization: quantization as QuantizationId,
      context,
      kvPrecision: kvPrecision as KvPrecisionId,
      mlaCacheMode,
      capacityGiB,
      hardwareKind: profile,
      source,
      artifactId,
      engine,
      promptTokens,
      generatedTokens,
      concurrency,
    },
  }
}

function selectedVariant(model: HuggingFaceModel, input: PublicEstimateInput) {
  if (input.source === 'estimated') return null
  const normalizedSource = input.source.toLowerCase()
  const variant = model.variants.find((candidate) => candidate.id === input.artifactId
    && candidate.role !== 'projector'
    && (candidate.publisher?.toLowerCase() === normalizedSource
      || candidate.repositoryId?.toLowerCase() === normalizedSource
      || (candidate.provenance !== 'community' && normalizedSource === 'repository')))
  if (!variant) throw new Error('Selected artifact is not available for this public model')
  return variant
}

function detailSource(model: HuggingFaceModel, artifact: HuggingFaceVariant | null) {
  if (!artifact) return 'estimated'
  if (model.addon || artifact.role === 'addon') return 'repository'
  return (artifact.publisher ?? model.owner ?? 'repository').toLowerCase()
}

function detailsQuery(model: HuggingFaceModel, input: PublicEstimateInput, artifact: HuggingFaceVariant | null) {
  const query = new URLSearchParams({
    state: '1', quant: input.quantization, ctx: String(input.context), kv: input.kvPrecision,
    mla: input.mlaCacheMode, vram: String(input.capacityGiB), source: detailSource(model, artifact),
    variant: artifact?.id ?? 'none',
  })
  return query.toString()
}

function apiQuery(input: PublicEstimateInput) {
  const query = new URLSearchParams({
    model: input.model,
    quant: input.quantization,
    context: String(input.context),
    kv: input.kvPrecision,
    mla: input.mlaCacheMode,
    vram: String(input.capacityGiB),
    profile: input.hardwareKind,
    source: input.source,
    prompt: String(input.promptTokens),
    generated: String(input.generatedTokens),
    concurrency: String(input.concurrency),
  })
  if (input.artifactId) query.set('artifact', input.artifactId)
  if (input.engine) query.set('engine', input.engine)
  return query.toString()
}

export function buildPublicEstimate(
  model: HuggingFaceModel,
  input: PublicEstimateInput,
  options: { publicBaseUrl?: string; generatedAt?: string } = {},
): PublicEstimateResponse {
  if (model.id.toLowerCase() !== input.model.toLowerCase()) throw new Error('Loaded model does not match the request')
  const artifact = selectedVariant(model, input)
  const weightBytesOverride = artifact?.role === 'model' ? artifact.weightSizeBytes : undefined
  const additionalWeightBytes = model.addon
    ? artifact?.weightSizeBytes ?? model.addon.sizeBytes ?? undefined
    : undefined
  const estimateOptions = {
    quantization: input.quantization,
    context: input.context,
    kvPrecision: input.kvPrecision,
    mlaCacheMode: input.mlaCacheMode,
    weightBytesOverride,
    additionalWeightBytes,
  }
  const estimate = model.spec ? estimateVram(model.spec, estimateOptions) : null
  const reason = model.estimateReason
  const state = estimate
    ? model.spec?.estimateConfidence === 'runtime-specific' ? 'lower-bound' as const : 'estimate' as const
    : 'unavailable' as const
  const fit = estimate && state === 'estimate' ? classifyFit(estimate.totalGiB, input.capacityGiB) : null
  const plannerOptions = {
    quantization: input.quantization,
    kvPrecision: input.kvPrecision,
    mlaCacheMode: input.mlaCacheMode,
    weightBytesOverride,
    additionalWeightBytes,
  }
  const maximumSafeContext = model.spec
    ? findMaximumSafeContext(model.spec, plannerOptions, input.capacityGiB)
    : null
  const highestPrecisionFit = model.spec
    ? findHighestPrecisionFit(model.spec, { ...plannerOptions, context: input.context }, input.capacityGiB)
    : null
  const adjustments = model.spec
    ? buildFitAdjustments(model.spec, { ...plannerOptions, context: input.context, capacityGiB: input.capacityGiB })
    : []
  let serving: ServingScenarioEstimate | null = null
  if (input.engine && model.spec) {
    try {
      serving = estimateServingScenario(model.spec, {
        ...plannerOptions,
        profileId: input.engine,
        promptTokens: input.promptTokens,
        maxGeneratedTokens: input.generatedTokens,
        concurrency: input.concurrency,
        artifactFormat: artifact?.format ?? null,
        hardwareKind: input.hardwareKind,
      })
    } catch (error) {
      throw new Error(`Serving scenario inputs are invalid: ${error instanceof Error ? error.message : 'unsupported inputs'}`)
    }
  }
  const base = (options.publicBaseUrl ?? 'https://testnet.sizeof.ai').replace(/\/$/, '')
  const detailPath = `/${encodeURIComponent(model.owner)}/${encodeURIComponent(model.name)}`
  const generatedAt = options.generatedAt ?? new Date().toISOString()
  const evidence = model.spec
    ? buildModelEvidence(model.spec, artifact, model.lastModified ?? undefined)
    : [{
        id: 'estimate-unavailable', label: 'Estimate unavailable', kind: 'unknown' as const,
        detail: 'The public repository does not expose enough safe architecture facts for a context-dependent estimate.',
        sourceUrl: model.sourceUrl, repositoryUpdatedAt: model.lastModified ?? undefined,
      }]
  return {
    schema: 'sizeof-estimate/v1',
    model: {
      id: model.id, owner: model.owner, name: model.name, kind: model.modelKind,
      parametersB: model.parametersB, layers: model.layers, maxContext: model.maxContext,
      estimateConfidence: model.estimateConfidence, sourceUrl: model.sourceUrl,
      repositoryUpdatedAt: model.lastModified,
    },
    configuration: {
      quantization: input.quantization, context: input.context, kvPrecision: input.kvPrecision,
      mlaCacheMode: input.mlaCacheMode, source: input.source, artifactId: input.artifactId,
    },
    hardware: { profile: input.hardwareKind, capacityGiB: input.capacityGiB },
    result: {
      state, estimate, fit,
      headroomGiB: estimate ? input.capacityGiB - estimate.totalGiB : null,
      reason: estimate ? null : reason ?? 'unsafe-or-incomplete-model-facts',
    },
    planner: { maximumSafeContext, highestPrecisionFit, adjustments },
    evidence,
    provenance: {
      modelSource: model.sourceUrl,
      configSourceId: model.configSourceId,
      parameterCountKind: model.parameterCountKind,
      artifact: artifact ? {
        id: artifact.id, path: artifact.path, format: artifact.format, revision: artifact.revision,
        weightSizeBytes: artifact.weightSizeBytes, sourceUrl: artifact.sourceUrl ?? null,
      } : null,
    },
    serving,
    sourceUrl: model.sourceUrl,
    detailUrl: `${base}${detailPath}?${detailsQuery(model, input, artifact)}`,
    apiReproductionUrl: `${base}/api/v1/estimate?${apiQuery(input)}`,
    generatedAt,
    disclaimer: PUBLIC_ESTIMATE_DISCLAIMER,
  }
}
