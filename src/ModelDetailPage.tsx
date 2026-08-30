import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Info,
  LoaderCircle,
} from 'lucide-react'
import { kvPrecisions, quantizations, type KvPrecisionId, type QuantizationId } from './data/quantizations'
import { classifyFit, estimateVram, type Fit } from './lib/estimator'
import { contextLevels, stepContext } from './lib/context-stepper'
import { getMemoryBarPartPercents, getMemoryBarUsage } from './lib/memory-bar'
import { vramPresets } from './lib/vram-presets'
import type { HuggingFaceModel, HuggingFaceRoute } from './lib/huggingface'
import type { HuggingFaceVariant } from './lib/huggingface-variants'
import { parseDetailState, serializeDetailState } from './lib/detail-state'
import { serializeCompareState } from './lib/compare-state'
import { parseHardwareProfile, serializeHardwareProfile, usableMemoryGiB, type HardwareProfile } from './lib/hardware-profile'
import { buildModelEvidence } from './lib/evidence'
import type { FitAdjustment } from './lib/planner'
import EvidenceDrawer from './components/EvidenceDrawer'
import HardwareProfileControls from './components/HardwareProfileControls'
import FitPlanner from './components/FitPlanner'
import ExportMenu from './components/ExportMenu'
import ServingScenario from './components/ServingScenario'
import { getVerifiedServingArchitecture } from './data/engine-profiles'
import type { SizingExportInput } from './lib/export'

interface Props {
  route: HuggingFaceRoute
}

const contexts = contextLevels
const fitLabels: Record<Fit, string> = {
  comfortable: 'COMFORTABLE',
  tight: 'TIGHT FIT',
  'too-large': 'TOO LARGE',
}

const modelKindLabels: Record<HuggingFaceModel['modelKind'], string> = {
  language: 'LANGUAGE',
  'vision-language': 'VISION + LANGUAGE',
  image: 'IMAGE',
  video: 'VIDEO',
  audio: 'AUDIO / SPEECH',
  embedding: 'EMBEDDING / RETRIEVAL',
  adapter: 'ADAPTER / LORA',
  workflow: 'WORKFLOW / ARTIFACT',
  'speculative-draft': 'SPECULATIVE DRAFT',
  other: 'OTHER',
}

const estimateReasonLabels: Record<NonNullable<HuggingFaceModel['estimateReason']>, string> = {
  'adapter-only': 'This repository contains adapter weights, not a complete standalone model.',
  'modality-specific': 'This model uses modality-specific runtime memory, so the LLM token and KV-cache formula does not apply.',
  'workflow-artifact': 'This repository packages workflow or support files rather than one standalone model.',
  'encoder-model': 'This is a bidirectional encoder or retrieval model, so autoregressive KV-cache sizing does not apply.',
  'parameter-mismatch': 'The published parameter count does not match the declared base model, so an estimate would be unsafe.',
  'unverified-base': 'The declared base model could not be verified safely.',
  'missing-parameters': 'The repository does not publish a trustworthy parameter count.',
  'missing-layers': 'The repository does not publish enough layer information for a safe estimate.',
  'missing-context': 'The repository does not publish a native context window.',
  'missing-kv-geometry': 'The repository does not publish enough attention geometry for KV-cache sizing.',
  'speculative-draft': 'This is a speculative decoding draft model that must be paired with its declared target model.',
  'stateful-runtime': 'This model uses recurrent or state-space memory whose runtime residency cannot be derived safely from the public config alone.',
}

const quantizationBits = [1, 2, 3, 4, 5, 6, 8, 16] as const
const preferredSourcePublishers = ['unsloth', 'lmstudio-community', 'mlx-community', 'bartowski'] as const
const hardwareStorageKey = 'sizeof:hardware-profile:v1'

function loadLocalHardwareProfile(): HardwareProfile | null {
  try {
    return parseHardwareProfile(window.localStorage.getItem(hardwareStorageKey))
  } catch {
    return null
  }
}

function variantBits(variant: HuggingFaceVariant) {
  const searchable = [variant.label, variant.repositoryId, variant.path].filter(Boolean).join(' ')
  if (/\b(?:BF16|FP16)\b/i.test(searchable)) return 16
  const quant = searchable.match(/(?:^|[^A-Z0-9])I?Q([1-8])(?:[^A-Z0-9]|$)/i)
  if (quant) return Number(quant[1])
  const bitLabel = searchable.match(/(?:^|[^0-9])([1-8])[-_. ]?bits?(?:[^a-z]|$)/i)
  if (bitLabel) return Number(bitLabel[1])
  return variant.bitsPerWeight === null ? null : Math.round(variant.bitsPerWeight)
}

function displayVariantName(variant: HuggingFaceVariant) {
  if (variant.format === 'mlx' && variant.repositoryId) {
    const repositoryName = variant.repositoryId.split('/').pop() ?? variant.repositoryId
    const directorySuffix = variant.path && !variant.path.includes('.') ? ` · ${variant.path}` : ''
    const optiQ = repositoryName.match(/optiq[-_. ]*([1-8])[-_. ]?bits?/i)
    if (optiQ) return `MLX OptiQ ${optiQ[1]}-bit${directorySuffix}`
    const bits = repositoryName.match(/(?:^|[^0-9])([1-8])[-_. ]?bits?(?:[^a-z]|$)/i)
    if (bits) return `MLX ${bits[1]}-bit${directorySuffix}`
  }
  if (/\b(?:BF16|FP16)\b/i.test(variant.label)) return variant.label.match(/\b(?:BF16|FP16)\b/i)?.[0].toUpperCase() ?? 'FP16'
  const quant = variant.label.match(/((?:IQ|Q)[1-8](?:_[A-Z0-9]+)+)/i)
  return quant?.[1].toUpperCase() ?? variant.label.replace(/^GGUF\s+/i, '')
}

function quantizationIdForBits(bits: number): QuantizationId {
  if (bits >= 16) return 'fp16'
  if (bits >= 8) return 'q8_0'
  if (bits >= 6) return 'q6_k'
  if (bits >= 5) return 'q5_k_m'
  if (bits >= 4) return 'q4_k_m'
  if (bits >= 3) return 'q3_k_m'
  if (bits >= 2) return 'q2_k'
  return 'q1'
}

function publisherLabel(publisher: string) {
  if (publisher === 'mlx-community') return 'mlx-community'
  if (publisher === 'lmstudio-community') return 'LM Studio Community'
  return publisher.charAt(0).toUpperCase() + publisher.slice(1)
}

function formatCompact(value: number) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function formatContext(value: number) {
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M`
  return value >= 1000 ? `${Math.round(value / 1000)}K` : String(value)
}

function formatContextPreset(value: number) {
  return value >= 1024 ? `${Math.round(value / 1024)}K` : String(value)
}

function formatParameters(valueB: number | null) {
  if (valueB === null) return '—'
  return valueB >= 1000 ? `${(valueB / 1000).toFixed(2)}T` : `${valueB.toFixed(2)}B`
}

function formatBytes(value: number | null | undefined) {
  if (!value) return '—'
  const gib = value / 1024 ** 3
  if (gib >= 0.1) return `${gib.toFixed(2)} GiB`
  return `${(value / 1024 ** 2).toFixed(1)} MiB`
}

function comparePath(modelId: string) {
  return `/compare?${serializeCompareState({
    items: [{
      modelId,
      quantization: 'q4_k_m', context: 8192, kvPrecision: 'fp16', mlaCacheMode: 'expanded', vramGiB: 32,
      source: 'estimated', variantId: null,
    }],
  })}`
}

function Brand() {
  return (
    <a className="brand" href="/" aria-label="sizeof.ai home">
      <span className="brand-bracket">[</span> sizeof<span>.ai</span>{' '}
      <span className="brand-bracket">]</span>
    </a>
  )
}

export default function ModelDetailPage({ route }: Props) {
  const [model, setModel] = useState<HuggingFaceModel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [quantization, setQuantization] = useState<QuantizationId>('q4_k_m')
  const [context, setContext] = useState(8192)
  const [kvPrecision, setKvPrecision] = useState<KvPrecisionId>('fp16')
  const [mlaCacheMode, setMlaCacheMode] = useState<'expanded' | 'latent'>('expanded')
  const [vram, setVram] = useState(32)
  const [copied, setCopied] = useState(false)
  const [selectedSource, setSelectedSource] = useState('estimated')
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null)
  const [selectedResourceOptionId, setSelectedResourceOptionId] = useState<string | null>(null)
  const [savedHardwareProfile, setSavedHardwareProfile] = useState<HardwareProfile | null>(loadLocalHardwareProfile)
  const [isHardwareProfileApplied, setIsHardwareProfileApplied] = useState(false)
  const restoredRouteState = useRef(false)

  useEffect(() => {
    let active = true
    setModel(null)
    setError(null)
    fetch(`/api/models/${encodeURIComponent(route.owner)}/${encodeURIComponent(route.repo)}?schema=13`)
      .then(async (response) => {
        const body = await response.json() as HuggingFaceModel | { error?: string }
        if (!response.ok) throw new Error('error' in body && body.error ? body.error : 'Unable to load model')
        if (active) {
          const nextModel = body as HuggingFaceModel
          setModel(nextModel)
          const variants = nextModel.variants ?? []
          const defaultVariant = nextModel.addon
            ? variants.find((variant) => variant.role === 'addon')
            : null
          const defaultSource = nextModel.addon ? 'repository' : 'estimated'
          const parsed = parseDetailState(window.location.search, {
            quantization: 'q4_k_m', context: 8192, kvPrecision: 'fp16', mlaCacheMode: 'expanded', vramGiB: 32,
            selectedSource: defaultSource, selectedVariantId: defaultVariant?.id ?? null,
          })
          const modelVariants = nextModel.addon
            ? variants.filter((variant) => variant.role === 'addon')
            : variants.filter((variant) => variant.role === 'model')
          const allowedSources = new Set([
            defaultSource,
            ...modelVariants.map((variant) => (variant.publisher ?? nextModel.owner ?? 'repository').toLowerCase()),
          ])
          const requestedSource = allowedSources.has(parsed.selectedSource) ? parsed.selectedSource : defaultSource
          const variantIsValid = requestedSource !== 'estimated' && modelVariants.some((variant) => (
            variant.id === parsed.selectedVariantId
            && (nextModel.addon || (variant.publisher ?? nextModel.owner ?? 'repository').toLowerCase() === requestedSource)
          ))
          const selectedSource = requestedSource !== 'estimated' && !variantIsValid
            ? nextModel.addon ? defaultSource : 'estimated'
            : requestedSource
          const selectedVariantId = variantIsValid
            ? parsed.selectedVariantId
            : nextModel.addon ? defaultVariant?.id ?? null : null
          setQuantization(parsed.quantization)
          setContext(parsed.context)
          setKvPrecision(parsed.kvPrecision)
          setMlaCacheMode(parsed.mlaCacheMode)
          const urlControlsCapacity = /(?:^|[?&])state=1(?:&|$)/.test(window.location.search)
          const savedProfile = loadLocalHardwareProfile()
          const appliesSavedProfile = !urlControlsCapacity && savedProfile !== null
          setSavedHardwareProfile(savedProfile)
          setIsHardwareProfileApplied(appliesSavedProfile)
          setVram(appliesSavedProfile ? usableMemoryGiB(savedProfile) : parsed.vramGiB)
          setSelectedSource(selectedSource)
          setSelectedVariantId(selectedVariantId)
          setSelectedResourceOptionId(nextModel.resourceEstimate?.options[0]?.id ?? null)
          restoredRouteState.current = true
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Unable to load model')
      })
    return () => { active = false }
  }, [route.owner, route.repo])

  useEffect(() => {
    if (!model || !restoredRouteState.current) return
    const query = serializeDetailState({
      quantization, context, kvPrecision, mlaCacheMode, vramGiB: vram, selectedSource, selectedVariantId,
    })
    window.history.replaceState(null, '', `${window.location.pathname}?${query}`)
  }, [context, kvPrecision, mlaCacheMode, model, quantization, selectedSource, selectedVariantId, vram])

  useEffect(() => {
    if (model) document.title = `${model.name} VRAM & specs — sizeof.ai`
    return () => { document.title = 'sizeof.ai — LLM memory, measured' }
  }, [model])

  const modelVariants = model?.variants ?? []
  const selectableVariants = model?.addon
    ? modelVariants.filter((variant) => variant.role === 'addon')
    : modelVariants.filter((variant) => variant.role === 'model')
  const selectedVariant = selectedSource === 'estimated'
    ? null
    : selectableVariants.find((variant) => variant.id === selectedVariantId) ?? null
  const selectedCommunityVariant = selectedVariant?.provenance === 'community'
  const modelArtifactVariants = selectableVariants.filter((variant) => variant.role === 'model')
  const publisherForVariant = (variant: HuggingFaceVariant) => (variant.publisher ?? model?.owner ?? 'repository').toLowerCase()
  const sourcePublishers = [...new Set(modelArtifactVariants.map(publisherForVariant))]
    .sort((a, b) => {
      const aPriority = preferredSourcePublishers.indexOf(a as typeof preferredSourcePublishers[number])
      const bPriority = preferredSourcePublishers.indexOf(b as typeof preferredSourcePublishers[number])
      return (aPriority < 0 ? preferredSourcePublishers.length : aPriority)
        - (bPriority < 0 ? preferredSourcePublishers.length : bPriority)
    })
    .slice(0, 4)
  const sourceArtifactVariants = selectedSource === 'estimated'
    ? []
    : modelArtifactVariants.filter((variant) => publisherForVariant(variant) === selectedSource)
  const quantizationGroups = quantizationBits.map((bits) => ({
    bits,
    variants: sourceArtifactVariants.filter((variant) => variantBits(variant) === bits),
  })).filter((group) => group.variants.length > 0)
  const resourceEstimate = model?.resourceEstimate ?? null
  const selectedResourceOption = resourceEstimate?.options.find((option) => option.id === selectedResourceOptionId)
    ?? resourceEstimate?.options[0]
    ?? null
  const resourceTotalBytes = selectedResourceOption?.components.reduce(
    (total, component) => total + component.sizeBytes,
    0,
  ) ?? 0
  const supportArtifacts = modelVariants.filter((variant) => (
    variant.role !== 'model' && variant.id !== selectedVariant?.id
  ))
  const estimate = useMemo(
    () => model?.spec ? estimateVram(model.spec, {
      quantization,
      context,
      kvPrecision,
      mlaCacheMode,
      weightBytesOverride: selectedVariant?.role === 'model'
        ? selectedVariant.weightSizeBytes
        : undefined,
      additionalWeightBytes: model.addon
        ? selectedVariant?.weightSizeBytes ?? model.addon.sizeBytes ?? undefined
        : undefined,
    }) : null,
    [context, kvPrecision, mlaCacheMode, model, quantization, selectedVariant],
  )
  const fit = estimate ? classifyFit(estimate.totalGiB, vram) : null

  const evidence = useMemo(
    () => model?.spec ? buildModelEvidence(model.spec, selectedVariant, model.lastModified ?? undefined) : [],
    [model, selectedVariant],
  )
  const exportHardwareProfile = savedHardwareProfile
    && isHardwareProfileApplied
    && vram === usableMemoryGiB(savedHardwareProfile) ? {
    kind: savedHardwareProfile.kind,
    label: savedHardwareProfile.label,
    capacityGiB: savedHardwareProfile.capacityGiB,
    reservedGiB: savedHardwareProfile.reservedGiB,
    systemRamGiB: savedHardwareProfile.systemRamGiB,
    usableCapacityGiB: usableMemoryGiB(savedHardwareProfile),
    applied: isHardwareProfileApplied,
  } : null
  const exportInput: SizingExportInput | null = model ? {
    generatedAt: new Date().toISOString(),
    records: [{
      model: { id: model.id, sourceUrl: model.sourceUrl },
      configuration: {
        quantization: estimate ? (quantizations.find((item) => item.id === quantization)?.label ?? quantization) : null,
        contextTokens: estimate ? context : null, kvPrecision: estimate ? kvPrecision : null, mlaCacheMode: estimate ? mlaCacheMode : null,
        source: selectedVariant?.publisher ?? (selectedSource === 'estimated' ? 'estimated' : selectedSource), variantId: selectedVariant?.id ?? null,
        artifactWeightGiB: selectedVariant?.weightSizeBytes ? selectedVariant.weightSizeBytes / 1024 ** 3 : null,
      },
      hardware: { capacityGiB: vram, profile: exportHardwareProfile },
      estimate: estimate ? { kind: estimate.isLowerBound ? 'lower-bound' : 'estimate', totalGiB: estimate.totalGiB, weightsGiB: estimate.weightsGiB, kvCacheGiB: estimate.kvCacheGiB, runtimeGiB: estimate.runtimeGiB } : null,
      resourceProfile: !estimate && selectedResourceOption ? {
        kind: resourceEstimate?.kind ?? model.modelKind,
        title: selectedResourceOption.label,
        totalGiB: resourceTotalBytes / 1024 ** 3,
        components: selectedResourceOption.components.map((component) => {
          const repositoryId = component.repositoryId ?? model.id
          return {
            ...component,
            repositoryId,
            provenance: 'Published static resource component selected on this page.',
            sourceUrl: repositoryId === model.id ? model.sourceUrl : `https://huggingface.co/${repositoryId.split('/').map(encodeURIComponent).join('/')}`,
            repositoryUpdatedAt: repositoryId === model.id ? model.lastModified : undefined,
          }
        }),
      } : null,
      evidence: estimate ? evidence : [{ id: 'resource-profile', label: 'Published resource profile', kind: 'verified', detail: 'Published static resource components selected on this page.', sourceUrl: model.sourceUrl, repositoryUpdatedAt: model.lastModified ?? undefined }],
    }],
  } : null

  async function copyUrl() {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  function applyHardwareProfile(profile: HardwareProfile) {
    try {
      window.localStorage.setItem(hardwareStorageKey, serializeHardwareProfile(profile))
    } catch {
      // Browser storage may be unavailable; retain this explicit session configuration.
    }
    setSavedHardwareProfile(profile)
    setIsHardwareProfileApplied(true)
    setVram(usableMemoryGiB(profile))
  }

  function clearHardwareProfile() {
    try {
      window.localStorage.removeItem(hardwareStorageKey)
    } catch {
      // Clearing the in-memory profile must still restore the normal calculator capacity.
    }
    setSavedHardwareProfile(null)
    setIsHardwareProfileApplied(false)
  }

  function chooseVram(value: number) {
    setIsHardwareProfileApplied(false)
    setVram(value)
  }

  function applyFitAdjustment(adjustment: FitAdjustment) {
    if (adjustment.field === 'context') setContext(adjustment.value as number)
    if (adjustment.field === 'kvPrecision') setKvPrecision(adjustment.value as KvPrecisionId)
    if (adjustment.field === 'quantization') setQuantization(adjustment.value as QuantizationId)
  }

  function chooseQuantization(id: QuantizationId) {
    setQuantization(id)
    if (!model?.addon) setSelectedVariantId(null)
  }

  function chooseVariant(variant: HuggingFaceVariant) {
    const bits = variantBits(variant)
    setSelectedVariantId(variant.id)
    if (bits !== null) setQuantization(quantizationIdForBits(bits))
  }

  function chooseSource(source: string) {
    setSelectedSource(source)
    if (source === 'estimated') {
      setSelectedVariantId(null)
      return
    }
    const variants = modelArtifactVariants.filter((variant) => publisherForVariant(variant) === source)
    const preferred = variants.find((variant) => /^GGUF Q4_K_M$/i.test(variant.label)) ?? variants[0] ?? null
    setSelectedVariantId(preferred?.id ?? null)
    if (preferred) {
      const bits = variantBits(preferred)
      if (bits !== null) setQuantization(quantizationIdForBits(bits))
    }
  }

  if (error) {
    return (
      <div className="detail-shell">
        <header className="site-header detail-header"><Brand /></header>
        <main className="detail-state">
          <span>HUGGING FACE LOOKUP / ERROR</span>
          <h1>Model not found.</h1>
          <p>{error}</p>
          <a href="/"><ArrowLeft size={18} /> Back to sizeof.ai</a>
        </main>
      </div>
    )
  }

  if (!model) {
    return (
      <div className="detail-shell">
        <header className="site-header detail-header"><Brand /></header>
        <main className="detail-state loading-state">
          <LoaderCircle size={30} />
          <span>READING HUGGING FACE MODEL</span>
          <p className="loading-model-name">{route.repo}</p>
        </main>
      </div>
    )
  }

  const fullAttentionLayers = model.attentionLayers ?? model.spec?.attentionLayers ?? null
  const layers = model.layers ?? model.spec?.layers ?? null
  const maxContext = model.maxContext ?? model.spec?.maxContext ?? null
  const contextPresets = model.spec
    ? [...new Set([...contexts, model.spec.maxContext])].filter((value) => value <= model.spec!.maxContext).sort((a, b) => a - b)
    : []
  const memoryParts = estimate ? [
    {
      label: model.addon ? 'Base model weights' : 'Model weights',
      value: estimate.baseWeightsGiB,
      className: 'weights',
    },
    ...(estimate.addonWeightsGiB > 0
      ? [{ label: 'MTP addon', value: estimate.addonWeightsGiB, className: 'addon' }]
      : []),
    { label: 'KV cache', value: estimate.kvCacheGiB, className: 'kv' },
    { label: 'Runtime buffer', value: estimate.runtimeGiB, className: 'runtime' },
  ] : []
  const memoryBarUsage = getMemoryBarUsage(estimate?.totalGiB ?? 0, vram)
  const memoryBarPartPercents = getMemoryBarPartPercents(memoryParts.map((part) => part.value))
  const isLowerBound = estimate?.isLowerBound ?? false
  const weightsOffloadOpacity = isLowerBound ? 0 : memoryBarUsage.weightsOffloadOpacity
  const offloadLabel = !isLowerBound && memoryBarUsage.offloadGiB > 0
    ? `OFFLOAD ${memoryBarUsage.offloadGiB.toFixed(2)} GiB`
    : null
  const modelKind = model.modelKind ?? 'other'
  const unavailableReason = model.estimateReason
    ? estimateReasonLabels[model.estimateReason]
    : 'The repository does not publish enough architecture data for a safe estimate.'
  const needsIdentification = !resourceEstimate && modelKind === 'workflow'

  const architecturePanel = (
    <section className="detail-architecture-list" role="region" aria-label="Architecture assumptions">
      <div className="detail-list-heading">
        <span>ARCHITECTURE</span>
        <small>Published configuration</small>
      </div>
      <dl>
        <div><dt>Architecture</dt><dd>{model.architecture ?? 'Not published'}</dd></div>
        <div><dt>Model type</dt><dd>{model.modelType ?? 'Not published'}</dd></div>
        {model.spec && <div><dt>Native context</dt><dd>{maxContext ? formatContext(maxContext) : '—'}</dd></div>}
        {model.moe && <div><dt>MoE routing</dt><dd>{model.moe.routedExperts
          ? `${model.moe.routedExperts} ROUTED${model.moe.sharedExperts ? ` + ${model.moe.sharedExperts} SHARED` : ''} / ${model.moe.expertsPerToken ?? '—'} ACTIVE`
          : `${model.moe.totalExperts ?? '—'} TOTAL / ${model.moe.expertsPerToken ?? '—'} ACTIVE`}</dd></div>}
        {model.attentionProfile?.stateKind && <div><dt>Stateful layers</dt><dd>{model.attentionProfile.stateKind.toUpperCase()} / {model.attentionProfile.kdaLayers + model.attentionProfile.linearLayers + model.attentionProfile.recurrentLayers + model.attentionProfile.ssmLayers} STATE LAYERS</dd></div>}
        {model.attentionProfile?.slidingLayers > 0 && <div><dt>Sliding attention</dt><dd>{model.attentionProfile.slidingLayers} layers / {model.attentionProfile.slidingWindow ? formatContext(model.attentionProfile.slidingWindow) : 'runtime window'}</dd></div>}
        {model.speculative?.targetModelId && <div><dt>Speculative target</dt><dd>{model.speculative.targetModelId}</dd></div>}
        {model.spec && <>
          <div><dt>Full attention layers</dt><dd>{fullAttentionLayers !== null && layers ? `${fullAttentionLayers} / ${layers}` : '—'}</dd></div>
          <div><dt>{model.spec.kvCache?.kind === 'mla' ? 'Attention cache' : 'KV heads / head dim'}</dt><dd>{model.spec.kvCache?.kind === 'mla' ? 'MLA / engine-dependent' : `${model.spec.kvHeads} / ${model.spec.headDim}`}</dd></div>
        </>}
      </dl>
      <div className="detail-list-source">
        <span>Hugging Face public API + config.json{model.configSourceId ? ` / ARCHITECTURE FROM ${model.configSourceId}` : ''}</span>
        <a href={model.sourceUrl} target="_blank" rel="noreferrer">VIEW ORIGINAL <ArrowUpRight size={14} /></a>
      </div>
    </section>
  )

  const artifactPanel = model.addon && modelVariants.length > 0 ? (
    <section className="detail-inline-artifacts" aria-label="Detected model variants">
      <div className="detail-list-heading">
        <span>{modelVariants.some((variant) => variant.provenance === 'community') ? 'COMMUNITY QUANTIZATION' : 'ARTIFACTS'}</span>
        <small>Published sizes</small>
      </div>
      {selectableVariants.length > 0 && (
        <div className="variant-selector-row">
          <label htmlFor="repository-variant">Repository variant</label>
          <select id="repository-variant" value={selectedVariant?.id ?? ''} onChange={(event) => setSelectedVariantId(event.target.value)}>
            {selectableVariants.map((variant) => <option value={variant.id} key={variant.id}>{variant.label}</option>)}
          </select>
          {selectedVariant && (
            <>
              <div className="variant-facts">
                <div><span>WEIGHT FILES</span><strong>{formatBytes(selectedVariant.weightSizeBytes)}</strong></div>
                <div><span>DOWNLOAD</span><strong>{formatBytes(selectedVariant.totalSizeBytes)}</strong></div>
                <div><span>FORMAT</span><strong>{selectedVariant.format.toUpperCase()}</strong></div>
                <div><span>SOURCE</span><strong>{selectedVariant.provenance === 'community' ? selectedVariant.publisher : selectedVariant.source.toUpperCase()}</strong></div>
              </div>
              {selectedVariant.provenance === 'community' && selectedVariant.sourceUrl && (
                <div className="community-source">
                  <span>{selectedVariant.repositoryId}</span>
                  <a href={selectedVariant.sourceUrl} target="_blank" rel="noreferrer">VIEW COMMUNITY REPOSITORY <ArrowUpRight size={14} /></a>
                </div>
              )}
            </>
          )}
        </div>
      )}
      <div className="variant-base-line">BASE MODEL / {model.addon.baseModelId}</div>
      {supportArtifacts.length > 0 && (
        <div className="support-artifacts">
          <span>SUPPORT ARTIFACTS</span>
          {supportArtifacts.map((variant) => (
            <div key={variant.id}><strong>{variant.label}</strong><small>{variant.role.toUpperCase()} / {formatBytes(variant.weightSizeBytes)}</small></div>
          ))}
        </div>
      )}
    </section>
  ) : null

  return (
    <div className="detail-shell">
      <header className="site-header detail-header">
        <Brand />
        <a className="detail-back" href="/"><ArrowLeft size={16} /> MODEL INDEX</a>
        <a className="source-link" href={model.sourceUrl} target="_blank" rel="noreferrer">
          <span>Hugging Face</span><ExternalLink size={16} />
        </a>
      </header>

      <main className="detail-workspace">
        <section className="detail-hero" aria-label="Model navigation">
          <div className="detail-breadcrumb"><span className="pulse-dot" /> LIVE HUGGING FACE MODEL / {model.owner}</div>
          <h1>{model.name}</h1>
          <div className="detail-hero-bottom">
            <button type="button" onClick={() => void copyUrl()}>
              {copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'COPIED' : 'COPY SIZEOF URL'}
            </button>
            {exportInput && <ExportMenu input={exportInput} fileStem="sizeof-ai-sizing" />}
            <a className="compare-entry" href={comparePath(model.id)} aria-label={`Compare ${model.id}`}>COMPARE</a>
          </div>
          <div className="detail-tags">
            {model.license && <span>LICENSE / {model.license}</span>}
            {model.pipelineTag && <span>{model.pipelineTag}</span>}
            {model.libraryName && <span>{model.libraryName}</span>}
            {model.quantizationFormat && <span>REPO QUANTIZATION / {model.quantizationFormat.toUpperCase()}</span>}
            {model.speculative && <span>SPECULATIVE / {model.speculative.family.toUpperCase()} {model.speculative.relation.toUpperCase()}</span>}
            <span>UPDATED / {model.lastModified ? new Date(model.lastModified).toLocaleDateString('en-CA') : 'UNKNOWN'}</span>
          </div>
          <div className="detail-sidebar-data">
            <section className="detail-sidebar-section" aria-label="Model facts">
              <span>MODEL FACTS</span>
              <dl>
                <div><dt>{model.parameterCountKind === 'tensor-elements' ? 'TENSOR ELEMENTS' : model.moe ? 'TOTAL PARAMETERS' : 'PARAMETERS'}</dt><dd>{formatParameters(model.parametersB)}</dd></div>
                {model.moe?.activeParametersB && <div><dt>ACTIVE PARAMETERS / TOKEN</dt><dd>{formatParameters(model.moe.activeParametersB)}</dd></div>}
                {model.spec && <div><dt>Native context</dt><dd>{maxContext ? formatContext(maxContext) : '—'}</dd></div>}
                <div><dt>Downloads / month</dt><dd>{formatCompact(model.downloads)}</dd></div>
                <div><dt>Likes</dt><dd>{formatCompact(model.likes)}</dd></div>
              </dl>
            </section>
            <section className="detail-sidebar-section" aria-label="Resource profile">
              <span>RESOURCE PROFILE</span>
              <dl>
                <div><dt>Category</dt><dd>{modelKindLabels[modelKind]}</dd></div>
                <div><dt>Published tensors</dt><dd>{formatBytes(model.tensorSizeBytes)}</dd></div>
                <div><dt>Repository storage</dt><dd>{formatBytes(model.repositorySizeBytes)}</dd></div>
              </dl>
            </section>
          </div>
        </section>

        {model.spec && estimate && fit ? (
          <section className="detail-calculator" aria-label="Model VRAM calculator">
            <div className="detail-section-title">
              <span>01 / SIZE THIS MODEL</span>
              <h2>Memory profile.</h2>
            </div>
            <div className="calculator-grid detail-calc-grid">
              <div className="controls-panel" role="region" aria-label="Model configuration">
                <div className="control-block">
                  <div className="label-row"><label>Weight quantization</label><span>{selectedVariant?.role === 'model' ? `${selectedCommunityVariant ? 'COMMUNITY' : 'REPOSITORY'} ARTIFACT / ${selectedVariant.publisher ?? model.owner}` : 'HYPOTHETICAL BIT/WEIGHT ESTIMATE'}</span></div>
                  {sourcePublishers.length > 0 && !model.addon && (
                    <div className="quant-source-tabs" role="tablist" aria-label="Weight source">
                      <button type="button" role="tab" aria-selected={selectedSource === 'estimated'} className={selectedSource === 'estimated' ? 'active' : ''} onClick={() => chooseSource('estimated')}>Estimated</button>
                      {sourcePublishers.map((publisher) => (
                        <button type="button" role="tab" aria-selected={selectedSource === publisher} className={selectedSource === publisher ? 'active' : ''} key={publisher} onClick={() => chooseSource(publisher)}>{publisherLabel(publisher)}</button>
                      ))}
                    </div>
                  )}
                  {sourceArtifactVariants.length > 0 ? (
                    <div
                      className="quant-browser"
                      role="region"
                      aria-label="Available community quantizations"
                      data-motion="quantization-panel"
                      data-motion-source={selectedSource}
                      key={`community-${selectedSource}`}
                    >
                      {quantizationGroups.map((group, groupIndex) => (
                        <div
                          className="quant-tier"
                          key={group.bits}
                          style={{ '--quant-tier-delay': `${35 + groupIndex * 24}ms` } as CSSProperties}
                        >
                          <span>{group.bits}-bit</span>
                          <div>
                            {group.variants.map((variant) => (
                              <button
                                type="button"
                                className={selectedVariant?.id === variant.id ? 'active' : ''}
                                key={variant.id}
                                onClick={() => chooseVariant(variant)}
                              >
                                <span>{displayVariantName(variant)}</span>
                                <small>{formatBytes(variant.weightSizeBytes)}</small>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div
                      className="quant-grid"
                      data-motion="quantization-panel"
                      data-motion-source="estimated"
                      key="estimated"
                    >
                      {quantizations.map((item) => (
                        <button type="button" className={quantization === item.id ? 'active' : ''} key={item.id} onClick={() => chooseQuantization(item.id)}>{item.label}</button>
                      ))}
                    </div>
                  )}
                  {selectedVariant?.role === 'model' ? (
                    <p className="control-help quant-source">Uses the published {formatBytes(selectedVariant.weightSizeBytes)} weight artifact{selectedVariant.sourceUrl && <> from <a href={selectedVariant.sourceUrl} target="_blank" rel="noreferrer">{selectedVariant.repositoryId ?? selectedVariant.publisher} <ArrowUpRight size={12} /></a></>}.</p>
                  ) : (
                    <p className="control-help">{sourcePublishers.length > 0 ? 'Estimated mode uses parameters × effective bits per weight. Choose a publisher tab to use published artifact sizes.' : 'No matching published quantized artifact was found. Weight memory is estimated from parameters × effective bits per weight.'}</p>
                  )}
                </div>
                <div className="control-block context-block">
                  <div className="label-row"><label htmlFor="detail-context">Context window</label><span>TOKENS</span></div>
                  <div className="context-input-row">
                    <input
                      id="detail-context"
                      type="number"
                      min="1024"
                      step="1"
                      value={context}
                      onChange={(event) => setContext(Math.max(1024, Math.round(Number(event.target.value)) || 1024))}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                          event.preventDefault()
                          setContext((current) => stepContext(current, event.key === 'ArrowUp' ? 'up' : 'down'))
                        }
                      }}
                    />
                    <div className="context-stepper" aria-label="Adjust context window">
                      <button type="button" aria-label="Increase context window" onClick={() => setContext((current) => stepContext(current, 'up'))}>
                        <ChevronUp size={18} />
                      </button>
                      <button type="button" aria-label="Decrease context window" onClick={() => setContext((current) => stepContext(current, 'down'))}>
                        <ChevronDown size={18} />
                      </button>
                    </div>
                  </div>
                  <div className="preset-row">
                    {contextPresets.map((value) => (
                      <button type="button" className={context === value ? 'active' : ''} key={value} onClick={() => setContext(value)}>{formatContextPreset(value)}</button>
                    ))}
                  </div>
                  {estimate.exceedsNativeContext && <p className="warning">Above the published native context.</p>}
                </div>
                {model.spec.kvCache?.kind === 'mla' && (
                  <div className="control-block mla-control">
                    <div className="label-row"><label htmlFor="detail-mla-cache">MLA cache layout</label><span>ENGINE-DEPENDENT</span></div>
                    <select id="detail-mla-cache" value={mlaCacheMode} onChange={(event) => setMlaCacheMode(event.target.value as 'expanded' | 'latent')}>
                      <option value="expanded">Reference / expanded K/V</option>
                      <option value="latent">Optimized / compressed latent</option>
                    </select>
                    <p className="control-help">Reference mode follows the repository implementation. Optimized MLA engines may retain only the compressed latent cache.</p>
                  </div>
                )}
                <div className="split-controls">
                  <div className="control-block compact">
                    <label htmlFor="detail-kv">KV cache precision</label>
                    <select id="detail-kv" value={kvPrecision} onChange={(event) => setKvPrecision(event.target.value as KvPrecisionId)}>
                      {kvPrecisions.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
                    </select>
                  </div>
                  <div className="control-block compact">
                    <label htmlFor="detail-vram">Your VRAM</label>
                    <select id="detail-vram" value={vram} onChange={(event) => chooseVram(Number(event.target.value))}>
                      {!vramPresets.some((value) => value === vram) && <option value={vram}>{vram} GiB usable</option>}
                      {vramPresets.map((value) => <option value={value} key={value}>{value} GiB</option>)}
                    </select>
                  </div>
                </div>
                <HardwareProfileControls
                  profile={savedHardwareProfile}
                  isApplied={isHardwareProfileApplied}
                  onApply={applyHardwareProfile}
                  onClear={clearHardwareProfile}
                />
                {artifactPanel}
                {architecturePanel}
              </div>

              <div className="result-panel detail-result" role="region" aria-label="Memory summary">
                <div className="result-topline">
                  <span>{estimate.isLowerBound ? 'ESTIMATED LOWER BOUND' : 'ESTIMATED VRAM'}</span>
                  <span className={`fit-pill ${fit}`}>{fitLabels[fit]} ON {vram} GB</span>
                </div>
                <div className="total-number"><span>{estimate.totalGiB.toFixed(2)}</span><small>GiB</small></div>
                <div
                  className="memory-bar"
                  role="img"
                  data-motion="memory-usage"
                  aria-label={estimate.isLowerBound
                    ? `Modeled lower bound: ${estimate.totalGiB.toFixed(2)} GiB before unmodeled runtime state`
                    : `Memory usage: ${estimate.totalGiB.toFixed(2)} GiB used of ${vram} GiB VRAM${offloadLabel ? `, ${offloadLabel}` : ''}`}
                >
                  <div
                    className="memory-bar-used"
                    style={{
                      width: `${memoryBarUsage.usedPercent}%`,
                      '--memory-weights-offload-opacity': weightsOffloadOpacity,
                    } as CSSProperties}
                  >
                    {memoryParts.map((part, index) => (
                      <span className={part.className} key={part.label} style={{ width: `${memoryBarPartPercents[index]}%` }} />
                    ))}
                    <span className="memory-bar-risk" aria-hidden="true" style={{ opacity: memoryBarUsage.riskOpacity }} />
                  </div>
                  <span className="memory-bar-remaining" aria-hidden="true" style={{ width: `${memoryBarUsage.remainingPercent}%` }} />
                  {offloadLabel && <span className="memory-bar-offload">{offloadLabel}</span>}
                </div>
                <div
                  className="breakdown-list"
                  style={{
                    '--memory-risk-opacity': memoryBarUsage.riskOpacity,
                    '--memory-weights-offload-opacity': weightsOffloadOpacity,
                  } as CSSProperties}
                >
                  {memoryParts.map((part) => <div key={part.label}><span><i className={part.className} />{part.label}</span><strong>{part.value.toFixed(2)} GiB</strong></div>)}
                </div>
                <p className="estimate-note"><Info size={15} /> {estimate.isLowerBound
                  ? 'This lower bound includes published weights and modeled attention cache. Architecture-specific KDA, linear, recurrent, or SSM state remains engine-dependent and is not included in the fit claim.'
                  : model.spec.kvCache?.kind === 'mla'
                    ? `${mlaCacheMode === 'expanded' ? 'Expanded K/V follows the repository reference cache.' : 'Compressed latent assumes an optimized MLA engine.'} Only full-attention layers scale with context.`
                    : 'KV cache follows the published full-attention geometry.'}</p>
                <EvidenceDrawer entries={evidence} />
                <FitPlanner
                  model={model.spec}
                  capacityGiB={vram}
                  context={context}
                  quantization={quantization}
                  kvPrecision={kvPrecision}
                  mlaCacheMode={mlaCacheMode}
                  weightBytesOverride={selectedVariant?.role === 'model' ? selectedVariant.weightSizeBytes : undefined}
                  additionalWeightBytes={model.addon ? selectedVariant?.weightSizeBytes ?? model.addon.sizeBytes ?? undefined : undefined}
                  totalGiB={estimate.totalGiB}
                  onApply={applyFitAdjustment}
                />
                {model.modelKind === 'language' && getVerifiedServingArchitecture(model.spec).applicable && (
                  <ServingScenario
                    model={model.spec}
                    estimateOptions={{
                      quantization,
                      kvPrecision,
                      mlaCacheMode,
                      weightBytesOverride: selectedVariant?.role === 'model' ? selectedVariant.weightSizeBytes : undefined,
                      additionalWeightBytes: model.addon ? selectedVariant?.weightSizeBytes ?? model.addon.sizeBytes ?? undefined : undefined,
                    }}
                    artifactFormat={selectedVariant?.role === 'model' ? selectedVariant.format : null}
                    hardwareKind={isHardwareProfileApplied ? savedHardwareProfile?.kind ?? null : null}
                  />
                )}
                <div className="detail-sticky-result" role="status" aria-label="Current memory result">
                  <strong>{estimate.isLowerBound ? `${estimate.totalGiB.toFixed(2)} GiB lower bound` : `${estimate.totalGiB.toFixed(2)} GiB`}</strong>
                  <span>{fitLabels[fit]} · {vram} GiB capacity</span>
                </div>
              </div>
            </div>
          </section>
        ) : resourceEstimate && selectedResourceOption ? (
          <section className="detail-calculator resource-estimate" aria-label="Model load estimate">
            <div className="detail-section-title">
              <span>01 / STATIC MODEL MEMORY</span>
              <h2>{resourceEstimate.title}.</h2>
            </div>
            <div className="calculator-grid detail-calc-grid">
              <div className="controls-panel resource-controls">
                {resourceEstimate.options.length > 1 && (
                  <div className="control-block">
                    <div className="label-row"><label htmlFor="resource-option">Published weight set</label><span>SELECT ONE</span></div>
                    <select
                      id="resource-option"
                      value={selectedResourceOption.id}
                      onChange={(event) => setSelectedResourceOptionId(event.target.value)}
                    >
                      {resourceEstimate.options.map((option) => (
                        <option value={option.id} key={option.id}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="resource-summary">
                  <span>WHAT THIS COUNTS</span>
                  <p>{resourceEstimate.description}</p>
                </div>
                {resourceEstimate.baseModelId && <div className="resource-base">DECLARED {resourceEstimate.kind === 'speculative-draft' ? 'TARGET' : 'BASE'} / {resourceEstimate.baseModelId}</div>}
                {artifactPanel}
                {architecturePanel}
              </div>
              <div className="result-panel detail-result resource-result">
                <div className="result-topline"><span>{resourceEstimate.kind === 'speculative-draft' ? 'TARGET + DRAFT WEIGHTS' : 'ESTIMATED STATIC VRAM'}</span><span>{resourceEstimate.kind === 'speculative-draft' ? 'CACHE + RUNTIME EXCLUDED' : 'NO KV CACHE'}</span></div>
                <div className="resource-total">{formatBytes(resourceTotalBytes)}</div>
                <div className="breakdown-list">
                  {selectedResourceOption.components.map((component) => (
                    <div key={component.id}>
                      <span>{component.label}{component.path ? ` / ${component.path}` : ''}</span>
                      <strong>{formatBytes(component.sizeBytes)}</strong>
                    </div>
                  ))}
                </div>
                <p className="estimate-note"><Info size={15} /> {resourceEstimate.note}</p>
                <FitPlanner unavailableReason="This resource-only model does not have a safe autoregressive fit plan." />
              </div>
            </div>
          </section>
        ) : needsIdentification ? (
          <section className="detail-unavailable artifact-identification" aria-label="Artifact identification needed">
            <Info />
            <span>INPUT NEEDED</span>
            <h2>What is this artifact?</h2>
            <p>Its public files do not establish whether it is a standalone model, VAE, adapter, or workflow component. To size it safely, identify the component type, the model or workflow that loads it, and whether it is required or optional.</p>
            {architecturePanel}
          </section>
        ) : (
          <section className="detail-unavailable"><Info /><h2>VRAM estimate unavailable.</h2><p>{unavailableReason}</p>{architecturePanel}</section>
        )}
      </main>
    </div>
  )
}
