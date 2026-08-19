import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Copy,
  ExternalLink,
  Info,
  LoaderCircle,
} from 'lucide-react'
import { kvPrecisions, quantizations, type KvPrecisionId, type QuantizationId } from './data/quantizations'
import { classifyFit, estimateVram, type Fit } from './lib/estimator'
import type { HuggingFaceModel, HuggingFaceRoute } from './lib/huggingface'
import type { HuggingFaceVariant } from './lib/huggingface-variants'

interface Props {
  route: HuggingFaceRoute
}

const contexts = [8192, 32768, 131072, 262144]
const vramPresets = [16, 24, 32, 48, 64, 80]
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
}

const quantizationBits = [1, 2, 3, 4, 5, 6, 8, 16] as const

function variantBits(variant: HuggingFaceVariant) {
  if (/\b(?:BF16|FP16)\b/i.test(variant.label)) return 16
  const quant = variant.label.match(/(?:^|[^A-Z0-9])I?Q([1-8])(?:[^A-Z0-9]|$)/i)
  if (quant) return Number(quant[1])
  return variant.bitsPerWeight === null ? null : Math.round(variant.bitsPerWeight)
}

function displayVariantName(variant: HuggingFaceVariant) {
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
  return 'q2_k'
}

function formatCompact(value: number) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function formatContext(value: number) {
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M`
  return value >= 1000 ? `${Math.round(value / 1000)}K` : String(value)
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
  const [vram, setVram] = useState(24)
  const [copied, setCopied] = useState(false)
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null)
  const [selectedResourceOptionId, setSelectedResourceOptionId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setModel(null)
    setError(null)
    fetch(`/api/models/${encodeURIComponent(route.owner)}/${encodeURIComponent(route.repo)}?schema=9`)
      .then(async (response) => {
        const body = await response.json() as HuggingFaceModel | { error?: string }
        if (!response.ok) throw new Error('error' in body && body.error ? body.error : 'Unable to load model')
        if (active) {
          const nextModel = body as HuggingFaceModel
          setModel(nextModel)
          const variants = nextModel.variants ?? []
          const defaultVariant = nextModel.addon
            ? variants.find((variant) => variant.role === 'addon')
            : variants.find((variant) => variant.role === 'model'
              && variant.provenance === 'community' && /^GGUF Q4_K_M$/i.test(variant.label))
              ?? variants.find((variant) => variant.role === 'model')
          setSelectedVariantId(defaultVariant?.id ?? null)
          setSelectedResourceOptionId(nextModel.resourceEstimate?.options[0]?.id ?? null)
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Unable to load model')
      })
    return () => { active = false }
  }, [route.owner, route.repo])

  useEffect(() => {
    if (model) document.title = `${model.name} VRAM & specs — sizeof.ai`
    return () => { document.title = 'sizeof.ai — LLM memory, measured' }
  }, [model])

  const modelVariants = model?.variants ?? []
  const selectableVariants = model?.addon
    ? modelVariants.filter((variant) => variant.role === 'addon')
    : modelVariants.filter((variant) => variant.role === 'model')
  const selectedVariant = selectableVariants.find((variant) => variant.id === selectedVariantId) ?? null
  const selectedCommunityVariant = selectedVariant?.provenance === 'community'
  const modelArtifactVariants = selectableVariants.filter((variant) => variant.role === 'model')
  const quantizationGroups = quantizationBits.map((bits) => ({
    bits,
    variants: modelArtifactVariants.filter((variant) => variantBits(variant) === bits),
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

  async function copyUrl() {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
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
  const modelKind = model.modelKind ?? 'other'
  const unavailableReason = model.estimateReason
    ? estimateReasonLabels[model.estimateReason]
    : 'The repository does not publish enough architecture data for a safe estimate.'
  const needsIdentification = !resourceEstimate && modelKind === 'workflow'

  return (
    <div className="detail-shell">
      <header className="site-header detail-header">
        <Brand />
        <a className="detail-back" href="/"><ArrowLeft size={16} /> MODEL INDEX</a>
        <a className="source-link" href={model.sourceUrl} target="_blank" rel="noreferrer">
          <span>Hugging Face</span><ExternalLink size={16} />
        </a>
      </header>

      <main>
        <section className="detail-hero">
          <div className="detail-breadcrumb"><span className="pulse-dot" /> LIVE HUGGING FACE MODEL / {model.owner}</div>
          <h1>{model.name}</h1>
          <div className="detail-hero-bottom">
            <p>Architecture-aware model sizing, fetched directly from the public Hugging Face repository.</p>
            <button type="button" onClick={() => void copyUrl()}>
              {copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'COPIED' : 'COPY SIZEOF URL'}
            </button>
          </div>
          <div className="detail-tags">
            {model.license && <span>LICENSE / {model.license}</span>}
            {model.pipelineTag && <span>{model.pipelineTag}</span>}
            {model.libraryName && <span>{model.libraryName}</span>}
            {model.quantizationFormat && <span>REPO QUANTIZATION / {model.quantizationFormat.toUpperCase()}</span>}
            <span>UPDATED / {model.lastModified ? new Date(model.lastModified).toLocaleDateString('en-CA') : 'UNKNOWN'}</span>
          </div>
        </section>

        <section className="detail-metrics" aria-label="Model facts">
          <div><span>{model.parameterCountKind === 'tensor-elements' ? 'PUBLISHED TENSOR ELEMENTS' : 'PARAMETERS'}</span><strong>{formatParameters(model.parametersB)}</strong></div>
          {model.spec && <div><span>NATIVE CONTEXT</span><strong>{maxContext ? formatContext(maxContext) : '—'}</strong></div>}
          <div><span>DOWNLOADS / MONTH</span><strong>{formatCompact(model.downloads)}</strong></div>
          <div><span>LIKES</span><strong>{formatCompact(model.likes)}</strong></div>
        </section>

        <section className="resource-profile" aria-label="Resource profile">
          <div className="resource-profile-label">
            <span>RESOURCE PROFILE</span>
            <small>Published facts, not runtime guesses.</small>
          </div>
          <div><span>MODEL CATEGORY</span><strong>{modelKindLabels[modelKind]}</strong></div>
          <div><span>PUBLISHED TENSORS</span><strong>{formatBytes(model.tensorSizeBytes)}</strong></div>
          <div><span>REPOSITORY STORAGE</span><strong>{formatBytes(model.repositorySizeBytes)}</strong></div>
        </section>

        {model.addon && modelVariants.length > 0 && (
          <section className="variant-profile" aria-label="Detected model variants">
            <div className="variant-profile-heading">
              <div><span>{modelVariants.some((variant) => variant.provenance === 'community') ? 'COMMUNITY QUANTIZATION' : 'DETECTED REPOSITORY VARIANTS'}</span><h2>Choose the artifact.</h2></div>
              <small>Published artifact sizes take priority over hypothetical bit-per-weight estimates. Context memory still follows the base model architecture.</small>
            </div>
            {selectableVariants.length > 0 && (
              <div className="variant-selector-row">
                <label htmlFor="repository-variant">Repository variant</label>
                <select
                  id="repository-variant"
                  value={selectedVariant?.id ?? ''}
                  onChange={(event) => setSelectedVariantId(event.target.value)}
                >
                  {selectableVariants.map((variant) => (
                    <option value={variant.id} key={variant.id}>{variant.label}</option>
                  ))}
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
            {model.addon && <div className="variant-base-line">BASE MODEL / {model.addon.baseModelId}</div>}
            {supportArtifacts.length > 0 && (
              <div className="support-artifacts">
                <span>SUPPORT ARTIFACTS</span>
                {supportArtifacts.map((variant) => (
                  <div key={variant.id}><strong>{variant.label}</strong><small>{variant.role.toUpperCase()} / {formatBytes(variant.weightSizeBytes)}</small></div>
                ))}
              </div>
            )}
          </section>
        )}

        {model.spec && estimate && fit ? (
          <section className="detail-calculator" aria-label="Model VRAM calculator">
            <div className="detail-section-title">
              <span>01 / SIZE THIS MODEL</span>
              <h2>Memory profile.</h2>
            </div>
            <div className="calculator-grid detail-calc-grid">
              <div className="controls-panel">
                <div className="control-block">
                  <div className="label-row"><label>Weight quantization</label><span>{selectedVariant?.role === 'model' ? `${selectedCommunityVariant ? 'COMMUNITY' : 'REPOSITORY'} ARTIFACT / ${selectedVariant.publisher ?? model.owner}` : 'HYPOTHETICAL BIT/WEIGHT ESTIMATE'}</span></div>
                  {modelArtifactVariants.length > 0 ? (
                    <div className="quant-browser" role="region" aria-label="Available community quantizations">
                      {quantizationGroups.map((group) => (
                        <div className="quant-tier" key={group.bits}>
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
                    <div className="quant-grid">
                      {quantizations.map((item) => (
                        <button type="button" className={quantization === item.id ? 'active' : ''} key={item.id} onClick={() => chooseQuantization(item.id)}>{item.label}</button>
                      ))}
                    </div>
                  )}
                  {selectedVariant?.role === 'model' ? (
                    <p className="control-help quant-source">Uses the published {formatBytes(selectedVariant.weightSizeBytes)} weight artifact{selectedVariant.sourceUrl && <> from <a href={selectedVariant.sourceUrl} target="_blank" rel="noreferrer">{selectedVariant.repositoryId ?? selectedVariant.publisher} <ArrowUpRight size={12} /></a></>}.</p>
                  ) : (
                    <p className="control-help">No matching published quantized artifact was found. Weight memory is estimated from parameters × effective bits per weight.</p>
                  )}
                </div>
                <div className="control-block context-block">
                  <div className="label-row"><label htmlFor="detail-context">Context window</label><span>TOKENS</span></div>
                  <input id="detail-context" type="number" min="1" step="1024" value={context} onChange={(event) => setContext(Math.max(1, Number(event.target.value) || 1))} />
                  <div className="preset-row">
                    {contextPresets.map((value) => (
                      <button type="button" className={context === value ? 'active' : ''} key={value} onClick={() => setContext(value)}>{formatContext(value)}</button>
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
                    <select id="detail-vram" value={vram} onChange={(event) => setVram(Number(event.target.value))}>
                      {vramPresets.map((value) => <option value={value} key={value}>{value} GiB</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="result-panel detail-result">
                <div className="result-topline"><span>ESTIMATED VRAM</span><span className={`fit-pill ${fit}`}>{fitLabels[fit]} ON {vram} GB</span></div>
                <div className="total-number"><span>{estimate.totalGiB.toFixed(2)}</span><small>GiB</small></div>
                <div className="memory-bar">
                  {memoryParts.map((part) => <span className={part.className} key={part.label} style={{ width: `${(part.value / estimate.totalGiB) * 100}%` }} />)}
                </div>
                <div className="breakdown-list">
                  {memoryParts.map((part) => <div key={part.label}><span><i className={part.className} />{part.label}</span><strong>{part.value.toFixed(2)} GiB</strong></div>)}
                </div>
                <p className="estimate-note"><Info size={15} /> {model.spec.kvCache?.kind === 'mla'
                  ? `${mlaCacheMode === 'expanded' ? 'Expanded K/V follows the repository reference cache.' : 'Compressed latent assumes an optimized MLA engine.'} Only full-attention layers scale with context; fixed linear-attention state is covered by the runtime allowance.`
                  : 'Hybrid architectures count only full-attention layers toward context-scaled KV cache. Fixed linear-attention state is covered by the runtime allowance.'}</p>
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
                {resourceEstimate.baseModelId && <div className="resource-base">DECLARED BASE / {resourceEstimate.baseModelId}</div>}
              </div>
              <div className="result-panel detail-result resource-result">
                <div className="result-topline"><span>ESTIMATED STATIC VRAM</span><span>NO KV CACHE</span></div>
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
              </div>
            </div>
          </section>
        ) : needsIdentification ? (
          <section className="detail-unavailable artifact-identification" aria-label="Artifact identification needed">
            <Info />
            <span>INPUT NEEDED</span>
            <h2>What is this artifact?</h2>
            <p>Its public files do not establish whether it is a standalone model, VAE, adapter, or workflow component. To size it safely, identify the component type, the model or workflow that loads it, and whether it is required or optional.</p>
          </section>
        ) : (
          <section className="detail-unavailable"><Info /><h2>VRAM estimate unavailable.</h2><p>{unavailableReason}</p></section>
        )}

        <section className="architecture-section">
          <div className="detail-section-title"><span>02 / ARCHITECTURE</span><h2>Under the hood.</h2></div>
          <div className="architecture-grid">
            <div><span>ARCHITECTURE</span><strong>{model.architecture ?? 'Not published'}</strong></div>
            <div><span>MODEL TYPE</span><strong>{model.modelType ?? 'Not published'}</strong></div>
            {model.spec && <>
              <div><span>Full attention layers</span><strong>{fullAttentionLayers !== null && layers ? `${fullAttentionLayers} / ${layers}` : '—'}</strong></div>
              <div><span>{model.spec.kvCache?.kind === 'mla' ? 'ATTENTION CACHE' : 'KV HEADS / HEAD DIM'}</span><strong>{model.spec.kvCache?.kind === 'mla' ? 'MLA / ENGINE-DEPENDENT' : `${model.spec.kvHeads} / ${model.spec.headDim}`}</strong></div>
            </>}
          </div>
          <div className="hf-source-row">
            <span>DATA SOURCE / HUGGING FACE PUBLIC API + CONFIG.JSON{model.configSourceId ? ` / ARCHITECTURE FROM ${model.configSourceId}` : ''}</span>
            <a href={model.sourceUrl} target="_blank" rel="noreferrer">VIEW ORIGINAL <ArrowUpRight size={16} /></a>
          </div>
        </section>
      </main>
    </div>
  )
}
