import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useLanguage } from './i18n/LanguageFooter'
import { formatMessage, formatRichMessage, translate } from './i18n/core'
import PlatformNav from './platform/PlatformNav'
import SaveModelButton from './platform/SaveModelButton'
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  Columns2,
  ExternalLink,
  Info,
  Link2,
  LoaderCircle,
  TerminalSquare,
} from 'lucide-react'
import { kvPrecisions, quantizations, type KvPrecisionId, type QuantizationId } from './data/quantizations'
import { classifyFit, estimateVram, type Fit } from './lib/estimator'
import { contextLevels, maximumContext, normalizedContext, stepContext } from './lib/context-stepper'
import { getMemoryBarUsage } from './lib/memory-bar'
import MemoryGauge, { offloadText } from './components/MemoryGauge'
import { vramPresets } from './lib/vram-presets'
import { useCopy } from './lib/use-copy'
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
const fitOnLabels: Record<Fit | 'unverified', string> = {
  comfortable: 'COMFORTABLE ON {0} GiB',
  tight: 'TIGHT FIT ON {0} GiB',
  'too-large': 'TOO LARGE ON {0} GiB',
  unverified: 'FIT NOT VERIFIED ON {0} GiB',
}
const fitCapacityLabels: Record<Fit | 'unverified', string> = {
  comfortable: 'COMFORTABLE · {0} GiB capacity',
  tight: 'TIGHT FIT · {0} GiB capacity',
  'too-large': 'TOO LARGE · {0} GiB capacity',
  unverified: 'FIT NOT VERIFIED · {0} GiB capacity',
}

const modelKindLabels: Record<HuggingFaceModel['modelKind'], string> = {
  language: 'Language',
  'vision-language': 'Vision + language',
  image: 'Image',
  video: 'Video',
  audio: 'Audio / speech',
  embedding: 'Embedding / retrieval',
  adapter: 'Adapter / LoRA',
  workflow: 'Workflow / artifact',
  'speculative-draft': 'Speculative draft',
  other: 'Other',
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

export default function ModelDetailPage({ route }: Props) {
  const { locale } = useLanguage()
  const [model, setModel] = useState<HuggingFaceModel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [staleMetadata, setStaleMetadata] = useState(false)
  const [quantization, setQuantization] = useState<QuantizationId>('q4_k_m')
  const [context, setContext] = useState(8192)
  const [kvPrecision, setKvPrecision] = useState<KvPrecisionId>('fp16')
  const [mlaCacheMode, setMlaCacheMode] = useState<'expanded' | 'latent'>('expanded')
  const [vram, setVram] = useState(32)
  const { copied, copyError, copy } = useCopy()
  const [storageError, setStorageError] = useState<string | null>(null)
  const [selectedSource, setSelectedSource] = useState('estimated')
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null)
  const [selectedResourceOptionId, setSelectedResourceOptionId] = useState<string | null>(null)
  const [savedHardwareProfile, setSavedHardwareProfile] = useState<HardwareProfile | null>(loadLocalHardwareProfile)
  const [isHardwareProfileApplied, setIsHardwareProfileApplied] = useState(false)
  const restoredRouteState = useRef(false)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setModel(null)
    setError(null)
    setNotFound(false)
    setStaleMetadata(false)
    fetch(`/api/models/${encodeURIComponent(route.owner)}/${encodeURIComponent(route.repo)}?schema=13`, { signal: controller.signal })
      .then(async (response) => {
        if (active) setNotFound(response.status === 404)
        const body = await response.json() as HuggingFaceModel | { error?: string }
        if (!response.ok) throw new Error('error' in body && body.error ? body.error : 'Unable to load model')
        if (active) {
          setStaleMetadata(response.headers.get('X-Sizeof-Model-Source') === 'kv-stale')
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
    return () => { active = false; controller.abort() }
  }, [route.owner, route.repo])

  useEffect(() => {
    if (!model || !restoredRouteState.current) return
    const query = serializeDetailState({
      quantization, context, kvPrecision, mlaCacheMode, vramGiB: vram, selectedSource, selectedVariantId,
    })
    window.history.replaceState(null, '', `${window.location.pathname}?${query}`)
  }, [context, kvPrecision, mlaCacheMode, model, quantization, selectedSource, selectedVariantId, vram])

  useEffect(() => {
    if (model) document.title = formatMessage('{0} VRAM & specs — sizeof.ai', [model.name])
    return () => { document.title = `sizeof.ai — ${translate('LLM memory, measured')}` }
  }, [model, locale])

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
    await copy(window.location.href)
  }

  function applyHardwareProfile(profile: HardwareProfile) {
    setStorageError(null)
    try {
      window.localStorage.setItem(hardwareStorageKey, serializeHardwareProfile(profile))
    } catch {
      setStorageError('Profile applied for this page only. Browser storage is unavailable; it was not saved.')
    }
    setSavedHardwareProfile(profile)
    setIsHardwareProfileApplied(true)
    setVram(usableMemoryGiB(profile))
  }

  function clearHardwareProfile() {
    setStorageError(null)
    try {
      window.localStorage.removeItem(hardwareStorageKey)
    } catch {
      setStorageError('Could not remove the saved profile from browser storage. It may return after reloading.')
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
        <PlatformNav />
        <main className="detail-state">
          <p className="kicker">Hugging Face lookup failed</p>
          <h1>{notFound ? 'Model not found.' : 'Unable to load model.'}</h1>
          <p>{translate(error)}</p>
          <a href="/"><ArrowLeft aria-hidden="true" /> Back to sizeof.ai</a>
        </main>
      </div>
    )
  }

  if (!model) {
    return (
      <div className="detail-shell">
        <PlatformNav />
        <main className="detail-state loading-state">
          <p className="kicker"><LoaderCircle aria-hidden="true" /> Reading the Hugging Face model</p>
          <p className="loading-model-name">{route.repo}</p>
          <div className="loading-bar" aria-hidden="true" />
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
  const isLowerBound = estimate?.isLowerBound ?? false
  const weightsOffloadOpacity = isLowerBound ? 0 : memoryBarUsage.weightsOffloadOpacity
  const offloadLabel = !isLowerBound && memoryBarUsage.offloadGiB > 0 ? offloadText(memoryBarUsage.offloadGiB) : null
  const modelKind = model.modelKind ?? 'other'
  const unavailableReason = model.estimateReason
    ? estimateReasonLabels[model.estimateReason]
    : 'The repository does not publish enough architecture data for a safe estimate.'
  const needsIdentification = !resourceEstimate && modelKind === 'workflow'
  const updatedLabel = model.lastModified ? new Date(model.lastModified).toLocaleDateString('en-CA') : translate('unknown')
  const fitClass: Fit | 'unverified' | '' = fit ? (isLowerBound && fit !== 'too-large' ? 'unverified' : fit) : ''

  const architecturePanel = (
    <section className="detail-block detail-architecture-list" role="region" aria-label="Architecture assumptions">
      <div className="detail-list-heading">
        <span>Model architecture</span>
        <small>Published configuration</small>
      </div>
      <dl className="spec">
        <div><dt>Architecture</dt><dd>{model.architecture ?? 'Not published'}</dd></div>
        <div><dt>Model type</dt><dd>{model.modelType ?? 'Not published'}</dd></div>
        {model.spec && <div><dt>Native context</dt><dd>{maxContext ? formatContext(maxContext) : '—'}</dd></div>}
        {model.moe && <div><dt>MoE routing</dt><dd>{model.moe.routedExperts
          ? `${model.moe.routedExperts} ROUTED${model.moe.sharedExperts ? ` + ${model.moe.sharedExperts} SHARED` : ''} / ${model.moe.expertsPerToken ?? '—'} ACTIVE`
          : `${model.moe.totalExperts ?? '—'} TOTAL / ${model.moe.expertsPerToken ?? '—'} ACTIVE`}</dd></div>}
        {model.attentionProfile?.stateKind && <div><dt>Stateful layers</dt><dd>{model.attentionProfile.stateKind.toUpperCase()} / {model.attentionProfile.kdaLayers + model.attentionProfile.linearLayers + model.attentionProfile.recurrentLayers + model.attentionProfile.ssmLayers} STATE LAYERS</dd></div>}
        {model.attentionProfile?.slidingLayers > 0 && <div><dt>Sliding attention</dt><dd>{model.attentionProfile.slidingWindow ? formatMessage('{0} layers / {1}', [model.attentionProfile.slidingLayers, formatContext(model.attentionProfile.slidingWindow)]) : formatMessage('{0} layers / runtime window', [model.attentionProfile.slidingLayers])}</dd></div>}
        {model.speculative?.targetModelId && <div><dt>Speculative target</dt><dd>{model.speculative.targetModelId}</dd></div>}
        {model.spec && <>
          <div><dt>Full attention layers</dt><dd>{fullAttentionLayers !== null && layers ? `${fullAttentionLayers} / ${layers}` : '—'}</dd></div>
          <div><dt>{model.spec.kvCache?.kind === 'mla' ? 'Attention cache' : 'KV heads / head dim'}</dt><dd>{model.spec.kvCache?.kind === 'mla' ? 'MLA / engine-dependent' : `${model.spec.kvHeads} / ${model.spec.headDim}`}</dd></div>
        </>}
      </dl>
      <div className="detail-list-source">
        <span>{model.configSourceId ? `Hugging Face public API + config.json / architecture from ${model.configSourceId}` : 'Hugging Face public API + config.json'}</span>
        <a href={model.sourceUrl} target="_blank" rel="noreferrer">View original <ArrowUpRight aria-hidden="true" /></a>
      </div>
    </section>
  )

  const artifactPanel = model.addon && modelVariants.length > 0 ? (
    <section className="detail-block detail-inline-artifacts" aria-label="Detected model variants">
      <div className="detail-list-heading">
        <span>{modelVariants.some((variant) => variant.provenance === 'community') ? 'Community quantization' : 'Artifacts'}</span>
        <small>Published sizes</small>
      </div>
      {selectableVariants.length > 0 && (
        <div className="variant-selector-row">
          <label className="field" htmlFor="repository-variant"><span>Repository variant</span></label>
          <select id="repository-variant" value={selectedVariant?.id ?? ''} onChange={(event) => setSelectedVariantId(event.target.value)}>
            {selectableVariants.map((variant) => <option value={variant.id} key={variant.id}>{variant.label}</option>)}
          </select>
          {selectedVariant && (
            <>
              <div className="variant-facts">
                <div><span>Weight files</span><strong>{formatBytes(selectedVariant.weightSizeBytes)}</strong></div>
                <div><span>Download</span><strong>{formatBytes(selectedVariant.totalSizeBytes)}</strong></div>
                <div><span>Format</span><strong>{selectedVariant.format.toUpperCase()}</strong></div>
                <div><span>Source</span><strong>{selectedVariant.provenance === 'community' ? selectedVariant.publisher : selectedVariant.source.toUpperCase()}</strong></div>
              </div>
              {selectedVariant.provenance === 'community' && selectedVariant.sourceUrl && (
                <div className="community-source">
                  <span>{selectedVariant.repositoryId}</span>
                  <a href={selectedVariant.sourceUrl} target="_blank" rel="noreferrer">View community repository <ArrowUpRight aria-hidden="true" /></a>
                </div>
              )}
            </>
          )}
        </div>
      )}
      <div className="variant-base-line">Base model / {model.addon.baseModelId}</div>
      {supportArtifacts.length > 0 && (
        <div className="support-artifacts">
          <span>Support artifacts</span>
          {supportArtifacts.map((variant) => (
            <div key={variant.id}><strong>{variant.label}</strong><small>{variant.role.toUpperCase()} / {formatBytes(variant.weightSizeBytes)}</small></div>
          ))}
        </div>
      )}
    </section>
  ) : null

  return (
    <div className="detail-shell">
      <PlatformNav />

      <main className="detail-workspace">
        <section className="detail-hero" aria-label="Model navigation">
          <div className="detail-breadcrumb">
            <a href="/">Models</a><span aria-hidden="true">/</span><span>{model.owner}</span>
            <span className="tag"><span className="pulse-dot" aria-hidden="true" />Live Hugging Face data</span>
          </div>
          <h1>{model.name}</h1>
          {staleMetadata && <p role="alert" className="stale-note">Showing older saved model data because the latest metadata could not be refreshed. Values may be out of date.</p>}
          <div className="detail-hero-bottom">
            <button type="button" className="btn btn-tape" onClick={() => void copyUrl()}>
              {copied ? <Check aria-hidden="true" /> : <Link2 aria-hidden="true" />}{copied ? 'Copied' : 'Copy sizeof link'}
            </button>
            {exportInput && <ExportMenu input={exportInput} fileStem="sizeof-ai-sizing" />}
            <a className="btn compare-entry" href={comparePath(model.id)} aria-label={`Compare ${model.id}`}><Columns2 aria-hidden="true" />Compare</a>
            <a className="btn" href={`/deploy?model=${encodeURIComponent(model.id)}`}><TerminalSquare aria-hidden="true" />Deployment plan</a>
            <SaveModelButton modelId={model.id} />
            <a className="btn btn-quiet" href={model.sourceUrl} target="_blank" rel="noreferrer">Hugging Face <ExternalLink aria-hidden="true" /></a>
          </div>
          {copyError && <p role="alert" className="callout callout-error">{translate(copyError)}</p>}
          <div className="detail-sidebar-data">
            <section className="detail-sidebar-section" aria-label="Model facts">
              <h2 className="visually-hidden">Model facts</h2>
              <dl className="detail-facts">
                <div><dt>{model.parameterCountKind === 'tensor-elements' ? 'Tensor elements' : model.moe ? 'Total parameters' : 'Parameters'}</dt><dd>{formatParameters(model.parametersB)}</dd></div>
                {model.moe?.activeParametersB && <div><dt>Active parameters / token</dt><dd>{formatParameters(model.moe.activeParametersB)}</dd></div>}
                {model.spec && <div><dt>Native context</dt><dd>{maxContext ? formatContext(maxContext) : '—'}</dd></div>}
                <div><dt>Downloads / month</dt><dd>{formatCompact(model.downloads)}</dd></div>
                <div><dt>Likes</dt><dd>{formatCompact(model.likes)}</dd></div>
              </dl>
            </section>
            <section className="detail-sidebar-section" aria-label="Resource profile">
              <h2 className="visually-hidden">Resource profile</h2>
              <dl className="detail-facts">
                <div><dt>Category</dt><dd>{translate(modelKindLabels[modelKind])}</dd></div>
                <div><dt>Published tensors</dt><dd>{formatBytes(model.tensorSizeBytes)}</dd></div>
                <div><dt>Repository storage</dt><dd>{formatBytes(model.repositorySizeBytes)}</dd></div>
              </dl>
            </section>
          </div>
          <div className="detail-tags">
            {model.license && <span className="tag">License / {model.license}</span>}
            {model.pipelineTag && <span className="tag">{model.pipelineTag}</span>}
            {model.libraryName && <span className="tag">{model.libraryName}</span>}
            {model.quantizationFormat && <span className="tag">Repo quantization / {model.quantizationFormat.toUpperCase()}</span>}
            {model.speculative && <span className="tag">Speculative / {model.speculative.family.toUpperCase()} {model.speculative.relation.toUpperCase()}</span>}
            <span className="tag">Updated / {updatedLabel}</span>
          </div>
        </section>

        {model.spec && estimate && fit ? (
          <section className="detail-calculator" aria-label="Model VRAM calculator">
            <div className="detail-section-title">
              <h2>Memory profile</h2>
            </div>
            <div className="detail-calc-grid">
              <div className="detail-config controls-panel" role="region" aria-label="Model configuration">
                <div className="control-block">
                  <div className="label-row"><label>Weight quantization</label><span>{selectedVariant?.role === 'model'
                    ? formatMessage(selectedCommunityVariant ? 'Community artifact / {0}' : 'Repository artifact / {0}', [selectedVariant.publisher ?? model.owner])
                    : translate('Hypothetical bit/weight estimate')}</span></div>
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
                        <button type="button" className={quantization === item.id ? 'active' : ''} aria-pressed={quantization === item.id} key={item.id} onClick={() => chooseQuantization(item.id)}>{translate(item.label)}</button>
                      ))}
                    </div>
                  )}
                  {selectedVariant?.role === 'model' ? (
                    <p className="control-help quant-source">{selectedVariant.sourceUrl
                      ? formatRichMessage('Uses the published {0} weight artifact from {1}.', [formatBytes(selectedVariant.weightSizeBytes), <a key="source" href={selectedVariant.sourceUrl} target="_blank" rel="noreferrer">{selectedVariant.repositoryId ?? selectedVariant.publisher}</a>])
                      : formatMessage('Uses the published {0} weight artifact.', [formatBytes(selectedVariant.weightSizeBytes)])}</p>
                  ) : (
                    <p className="control-help">{sourcePublishers.length > 0 ? 'Estimated mode uses parameters × effective bits per weight. Choose a publisher tab to use published artifact sizes.' : 'No matching published quantized artifact was found. Weight memory is estimated from parameters × effective bits per weight.'}</p>
                  )}
                </div>
                <div className="control-block context-block">
                  <div className="label-row"><label htmlFor="detail-context">Context window</label><span>tokens</span></div>
                  <div className="context-input-row">
                    <input
                      id="detail-context"
                      type="number"
                      min="1024"
                      max={maximumContext}
                      step="1"
                      value={context}
                      onChange={(event) => setContext(normalizedContext(Number(event.target.value)))}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                          event.preventDefault()
                          setContext((current) => stepContext(current, event.key === 'ArrowUp' ? 'up' : 'down'))
                        }
                      }}
                    />
                    <div className="context-stepper" aria-label="Adjust context window">
                      <button type="button" aria-label="Increase context window" onClick={() => setContext((current) => stepContext(current, 'up'))}>
                        <ChevronUp aria-hidden="true" />
                      </button>
                      <button type="button" aria-label="Decrease context window" onClick={() => setContext((current) => stepContext(current, 'down'))}>
                        <ChevronDown aria-hidden="true" />
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
                    <div className="label-row"><label htmlFor="detail-mla-cache">MLA cache layout</label><span>Engine-dependent</span></div>
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
                      {kvPrecisions.map((item) => <option value={item.id} key={item.id}>{translate(item.label)}</option>)}
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
                {storageError && <p role="alert" className="callout callout-warn">{storageError}</p>}
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
                  <span>{estimate.isLowerBound ? 'Estimated lower bound' : 'Estimated VRAM'}</span>
                  <span className={`fit-pill ${fitClass}`}>{fitClass && formatMessage(fitOnLabels[fitClass], [vram])}</span>
                </div>
                <div className="total-number"><span>{estimate.totalGiB.toFixed(2)}</span><small>GiB</small></div>
                <MemoryGauge
                  parts={memoryParts}
                  totalGiB={estimate.totalGiB}
                  capacityGiB={vram}
                  lowerBound={estimate.isLowerBound}
                  ariaLabel={estimate.isLowerBound
                    ? formatMessage('Modeled lower bound: {0} GiB before unmodeled runtime state', [estimate.totalGiB.toFixed(2)])
                    : formatMessage('Memory usage: {0} GiB used of {1} GiB VRAM{2}', [estimate.totalGiB.toFixed(2), vram, offloadLabel ? `, ${offloadLabel}` : ''])}
                />
                <div
                  className="breakdown-list"
                  style={{
                    '--memory-risk-opacity': memoryBarUsage.riskOpacity,
                    '--memory-weights-offload-opacity': weightsOffloadOpacity,
                  } as CSSProperties}
                >
                  {memoryParts.map((part) => <div key={part.label}><span><i className={part.className} />{translate(part.label)}</span><strong>{part.value.toFixed(2)} GiB</strong></div>)}
                </div>
                <p className="estimate-note"><Info aria-hidden="true" /> {estimate.isLowerBound
                  ? 'This lower bound includes published weights and modeled attention cache. Architecture-specific KDA, linear, recurrent, or SSM state remains engine-dependent and is not included in the fit claim.'
                  : model.spec.kvCache?.kind === 'mla'
                    ? `${mlaCacheMode === 'expanded' ? 'Expanded K/V follows the repository reference cache.' : 'Compressed latent assumes an optimized MLA engine.'} Only full-attention layers scale with context.`
                    : 'KV cache follows the published full-attention geometry.'}</p>
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
                <EvidenceDrawer entries={evidence} />
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
              </div>
            </div>
            <div className="detail-sticky-result" role="status" aria-label="Current memory result">
                  <strong>{estimate.isLowerBound ? `${estimate.totalGiB.toFixed(2)} GiB lower bound` : `${estimate.totalGiB.toFixed(2)} GiB`}</strong>
                  <span>{fitClass && formatMessage(fitCapacityLabels[fitClass], [vram])}</span>
                </div>
          </section>
        ) : resourceEstimate && selectedResourceOption ? (
          <section className="detail-calculator resource-estimate" aria-label="Model load estimate">
            <div className="detail-section-title">
              <h2>{translate(resourceEstimate.title)}</h2>
            </div>
            <div className="detail-calc-grid">
              <div className="detail-config controls-panel resource-controls">
                {resourceEstimate.options.length > 1 && (
                  <div className="control-block">
                    <div className="label-row"><label htmlFor="resource-option">Published weight set</label><span>Select one</span></div>
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
                  <span>What this counts</span>
                  <p>{translate(resourceEstimate.description)}</p>
                </div>
                {resourceEstimate.baseModelId && <div className="resource-base">{resourceEstimate.kind === 'speculative-draft'
                  ? formatMessage('Declared target / {0}', [resourceEstimate.baseModelId])
                  : formatMessage('Declared base / {0}', [resourceEstimate.baseModelId])}</div>}
                {artifactPanel}
                {architecturePanel}
              </div>
              <div className="result-panel detail-result resource-result">
                <div className="result-topline"><span>{resourceEstimate.kind === 'speculative-draft' ? 'Target + draft weights' : 'Estimated static VRAM'}</span><span className="tag">{resourceEstimate.kind === 'speculative-draft' ? 'Cache + runtime excluded' : 'No KV cache'}</span></div>
                <div className="resource-total">{formatBytes(resourceTotalBytes)}</div>
                <div className="breakdown-list">
                  {selectedResourceOption.components.map((component) => (
                    <div key={component.id}>
                      <span>{translate(component.label)}{component.path ? ` / ${component.path}` : ''}</span>
                      <strong>{formatBytes(component.sizeBytes)}</strong>
                    </div>
                  ))}
                </div>
                <p className="estimate-note"><Info aria-hidden="true" /> {translate(resourceEstimate.note)}</p>
                <FitPlanner unavailableReason="This resource-only model does not have a safe autoregressive fit plan." />
              </div>
            </div>
          </section>
        ) : needsIdentification ? (
          <section className="detail-unavailable artifact-identification" aria-label="Artifact identification needed">
            <Info aria-hidden="true" />
            <p className="kicker">Input needed</p>
            <h2>What is this artifact?</h2>
            <p>Its public files do not establish whether it is a standalone model, VAE, adapter, or workflow component. To size it safely, identify the component type, the model or workflow that loads it, and whether it is required or optional.</p>
            {architecturePanel}
          </section>
        ) : (
          <section className="detail-unavailable"><Info aria-hidden="true" /><h2>VRAM estimate unavailable.</h2><p>{unavailableReason}</p>{architecturePanel}</section>
        )}
      </main>
    </div>
  )
}
