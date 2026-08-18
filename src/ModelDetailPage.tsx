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
  adapter: 'ADAPTER / LORA',
  workflow: 'WORKFLOW / ARTIFACT',
  other: 'OTHER',
}

const estimateReasonLabels: Record<NonNullable<HuggingFaceModel['estimateReason']>, string> = {
  'adapter-only': 'This repository contains adapter weights, not a complete standalone model.',
  'modality-specific': 'This model uses modality-specific runtime memory, so the LLM token and KV-cache formula does not apply.',
  'workflow-artifact': 'This repository packages workflow or support files rather than one standalone model.',
  'parameter-mismatch': 'The published parameter count does not match the declared base model, so an estimate would be unsafe.',
  'unverified-base': 'The declared base model could not be verified safely.',
  'missing-parameters': 'The repository does not publish a trustworthy parameter count.',
  'missing-layers': 'The repository does not publish enough layer information for a safe estimate.',
  'missing-context': 'The repository does not publish a native context window.',
  'missing-kv-geometry': 'The repository does not publish enough attention geometry for KV-cache sizing.',
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

  useEffect(() => {
    let active = true
    setModel(null)
    setError(null)
    fetch(`/api/models/${encodeURIComponent(route.owner)}/${encodeURIComponent(route.repo)}?schema=5`)
      .then(async (response) => {
        const body = await response.json() as HuggingFaceModel | { error?: string }
        if (!response.ok) throw new Error('error' in body && body.error ? body.error : 'Unable to load model')
        if (active) setModel(body as HuggingFaceModel)
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

  const estimate = useMemo(
    () => model?.spec ? estimateVram(model.spec, { quantization, context, kvPrecision, mlaCacheMode }) : null,
    [context, kvPrecision, mlaCacheMode, model, quantization],
  )
  const fit = estimate ? classifyFit(estimate.totalGiB, vram) : null

  async function copyUrl() {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
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
    { label: 'Model weights', value: estimate.weightsGiB, className: 'weights' },
    { label: 'KV cache', value: estimate.kvCacheGiB, className: 'kv' },
    { label: 'Runtime buffer', value: estimate.runtimeGiB, className: 'runtime' },
  ] : []
  const modelKind = model.modelKind ?? 'other'
  const unavailableReason = model.estimateReason
    ? estimateReasonLabels[model.estimateReason]
    : 'The repository does not publish enough architecture data for a safe estimate.'

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
          <div><span>PARAMETERS</span><strong>{formatParameters(model.parametersB)}</strong></div>
          <div><span>NATIVE CONTEXT</span><strong>{maxContext ? formatContext(maxContext) : '—'}</strong></div>
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

        {model.spec && estimate && fit ? (
          <section className="detail-calculator" aria-label="Model VRAM calculator">
            <div className="detail-section-title">
              <span>01 / SIZE THIS MODEL</span>
              <h2>Memory profile.</h2>
            </div>
            <div className="calculator-grid detail-calc-grid">
              <div className="controls-panel">
                <div className="control-block">
                  <div className="label-row"><label>Weight quantization</label><span>{model.quantizationFormat ? 'HYPOTHETICAL GGUF' : quantizations.find((item) => item.id === quantization)?.note}</span></div>
                  <div className="quant-grid">
                    {quantizations.map((item) => (
                      <button type="button" className={quantization === item.id ? 'active' : ''} key={item.id} onClick={() => setQuantization(item.id)}>{item.label}</button>
                    ))}
                  </div>
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
        ) : (
          <section className="detail-unavailable"><Info /><h2>VRAM estimate unavailable.</h2><p>{unavailableReason}</p></section>
        )}

        <section className="architecture-section">
          <div className="detail-section-title"><span>02 / ARCHITECTURE</span><h2>Under the hood.</h2></div>
          <div className="architecture-grid">
            <div><span>ARCHITECTURE</span><strong>{model.architecture ?? 'Not published'}</strong></div>
            <div><span>MODEL TYPE</span><strong>{model.modelType ?? 'Not published'}</strong></div>
            <div><span>Full attention layers</span><strong>{fullAttentionLayers !== null && layers ? `${fullAttentionLayers} / ${layers}` : '—'}</strong></div>
            <div><span>{model.spec?.kvCache?.kind === 'mla' ? 'ATTENTION CACHE' : 'KV HEADS / HEAD DIM'}</span><strong>{model.spec?.kvCache?.kind === 'mla' ? 'MLA / ENGINE-DEPENDENT' : model.spec ? `${model.spec.kvHeads} / ${model.spec.headDim}` : '—'}</strong></div>
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
