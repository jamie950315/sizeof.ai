import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Plus, X } from 'lucide-react'
import { kvPrecisions, quantizations, type KvPrecisionId, type QuantizationId } from './data/quantizations'
import { classifyFit, estimateVram } from './lib/estimator'
import type { HuggingFaceModel } from './lib/huggingface'
import { parseCompareState, serializeCompareState, type CompareItemState } from './lib/compare-state'
import { vramPresets } from './lib/vram-presets'

const defaults: Omit<CompareItemState, 'modelId'> = {
  quantization: 'q4_k_m', context: 8192, kvPrecision: 'fp16', mlaCacheMode: 'expanded', vramGiB: 32, source: 'estimated', variantId: null,
}

type ModelStatus = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; model: HuggingFaceModel }

function currentItems() {
  return parseCompareState(window.location.search, defaults).items
}

function initialItems() {
  const restored = currentItems()
  return [...restored, ...Array.from({ length: Math.max(0, 2 - restored.length) }, () => ({ modelId: '', ...defaults }))]
}

function displayModelId(item: CompareItemState, index: number) {
  return item.modelId || `Model ${index + 1}`
}

function formatGiB(value: number | null) {
  return value === null || !Number.isFinite(value) ? 'Not comparable' : `${value.toFixed(2)} GiB`
}

function formatBytes(bytes: number | null) {
  return bytes === null || !Number.isFinite(bytes) || bytes <= 0 ? 'Not comparable' : `${(bytes / 1024 ** 3).toFixed(2)} GiB`
}

function validId(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(value)
}

export default function ComparePage() {
  const [items, setItems] = useState<CompareItemState[]>(initialItems)
  const [submitted, setSubmitted] = useState(() => currentItems().length >= 2)
  const [models, setModels] = useState<Record<string, ModelStatus>>({})
  const [copied, setCopied] = useState(false)
  const activeEntries = useMemo(() => {
    const seen = new Set<string>()
    return items.flatMap((item, index) => {
      const normalized = item.modelId.toLowerCase()
      if (!validId(item.modelId) || seen.has(normalized)) return []
      seen.add(normalized)
      return [{ item, index }]
    }).slice(0, 4)
  }, [items])
  const activeItems = useMemo(() => activeEntries.map((entry) => entry.item), [activeEntries])
  const canCompare = submitted && activeItems.length >= 2

  useEffect(() => {
    const restore = () => {
      const restored = currentItems()
      setItems([...restored, ...Array.from({ length: Math.max(0, 2 - restored.length) }, () => ({ modelId: '', ...defaults }))])
      setSubmitted(restored.length >= 2)
    }
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [])

  useEffect(() => {
    if (!canCompare) return
    window.history.replaceState(null, '', `/compare?${serializeCompareState({ items: activeItems })}`)
  }, [activeItems, canCompare])

  useEffect(() => {
    if (!canCompare) {
      setModels({})
      return
    }
    const controller = new AbortController()
    const nextStatuses: Record<string, ModelStatus> = Object.fromEntries(activeItems.map((item) => [item.modelId, { kind: 'loading' }]))
    setModels(nextStatuses)
    let cursor = 0
    const request = async () => {
      while (cursor < activeItems.length && !controller.signal.aborted) {
        const item = activeItems[cursor++]
        try {
          const response = await fetch(`/api/models/${encodeURIComponent(item.modelId.split('/')[0])}/${encodeURIComponent(item.modelId.split('/')[1])}?schema=13`, { signal: controller.signal })
          const payload = await response.json() as HuggingFaceModel
          if (!response.ok) throw new Error('unavailable')
          if (!controller.signal.aborted) setModels((current) => ({ ...current, [item.modelId]: { kind: 'ready', model: payload } }))
        } catch {
          if (!controller.signal.aborted) setModels((current) => ({ ...current, [item.modelId]: { kind: 'error' } }))
        }
      }
    }
    void Promise.all(Array.from({ length: Math.min(2, activeItems.length) }, request))
    return () => controller.abort()
  }, [canCompare, activeItems])

  const updateItem = (index: number, update: Partial<CompareItemState>) => {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...update } : item))
  }

  const applyBuilder = () => {
    const unique = new Set<string>()
    const valid = items.filter((item) => {
      const key = item.modelId.toLowerCase()
      if (!validId(item.modelId) || unique.has(key)) return false
      unique.add(key)
      return true
    }).slice(0, 4)
    setItems(valid)
    setSubmitted(valid.length >= 2)
  }

  const copyLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/compare?${serializeCompareState({ items: activeItems })}`)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  if (!canCompare) {
    const builderItems = [...items]
    while (builderItems.length < 2) builderItems.push({ modelId: '', ...defaults })
    return (
      <main className="compare-page compare-builder" aria-labelledby="compare-title">
        <span>MODEL WORKSPACE</span>
        <h1 id="compare-title">Compare models</h1>
        <p>Compare two to four public Hugging Face model profiles with independent memory settings.</p>
        <div className="compare-builder-inputs">
          {builderItems.map((item, index) => (
            <label key={index}>
              <span>MODEL {index + 1} ID</span>
              <input
                aria-label={`Model ${index + 1} ID`}
                value={item.modelId}
                placeholder="owner/repository"
                maxLength={193}
                onChange={(event) => updateItem(index, { modelId: event.target.value.trim() })}
              />
            </label>
          ))}
        </div>
        <p className="compare-examples">Examples: <button type="button" onClick={() => setItems([{ modelId: 'Qwen/Qwen3.8-27B', ...defaults }, { modelId: 'meta-llama/Llama-3.3-70B-Instruct', ...defaults }])}>Qwen/Qwen3.8-27B + Llama-3.3-70B-Instruct</button></p>
        <button type="button" className="compare-primary" onClick={applyBuilder}>Compare models</button>
      </main>
    )
  }

  return (
    <main className="compare-page" aria-labelledby="compare-title">
      <header className="compare-header">
        <div><span>MODEL WORKSPACE</span><h1 id="compare-title">Compare models</h1></div>
        <div className="compare-header-actions">
          <label>Shared capacity
            <select aria-label="Shared VRAM capacity" defaultValue="" onChange={(event) => {
              const value = Number(event.target.value)
              if (value) setItems((current) => current.map((item) => ({ ...item, vramGiB: value })))
            }}><option value="">Independent</option>{vramPresets.map((value) => <option value={value} key={value}>{value} GiB for all</option>)}</select>
          </label>
          <button type="button" onClick={() => void copyLink()} aria-label="Copy comparison link">{copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'COPIED' : 'COPY LINK'}</button>
        </div>
      </header>
      <p className="visually-hidden" role="status" aria-live="polite">{Object.values(models).some((status) => status.kind === 'loading') ? 'Loading comparison models' : ''}</p>
      <section className="compare-cards" aria-label="Model comparisons">
        {activeEntries.map(({ item, index }, visibleIndex) => (
          <CompareCard
            key={`${item.modelId}-${index}`}
            item={item}
            index={visibleIndex}
            status={models[item.modelId] ?? { kind: 'loading' }}
            onChange={(update) => updateItem(index, update)}
            onRemove={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}
            canMoveLeft={visibleIndex > 0}
            canMoveRight={visibleIndex < activeEntries.length - 1}
            onMove={(direction) => setItems((current) => {
              const destination = activeEntries[visibleIndex + direction]?.index
              if (destination === undefined) return current
              const next = [...current]
              ;[next[index], next[destination]] = [next[destination], next[index]]
              return next
            })}
          />
        ))}
      </section>
      {items.some((_, index) => !activeEntries.some((entry) => entry.index === index)) && (
        <section className="compare-pending" aria-label="Additional comparison models">
          {items.map((item, index) => !activeEntries.some((entry) => entry.index === index) && (
            <label key={index}>Model {index + 1} ID
              <input
                aria-label={`Model ${index + 1} ID`}
                value={item.modelId}
                placeholder="owner/repository"
                maxLength={193}
                onChange={(event) => updateItem(index, { modelId: event.target.value.trim() })}
              />
            </label>
          ))}
        </section>
      )}
      {items.length < 4 && <button type="button" className="compare-add" onClick={() => setItems((current) => [...current, { modelId: '', ...defaults }])}><Plus size={16} /> Add model</button>}
    </main>
  )
}

interface CompareCardProps {
  item: CompareItemState
  index: number
  status: ModelStatus
  onChange: (update: Partial<CompareItemState>) => void
  onRemove: () => void
  canMoveLeft: boolean
  canMoveRight: boolean
  onMove: (direction: -1 | 1) => void
}

function CompareCard({ item, index, status, onChange, onRemove, canMoveLeft, canMoveRight, onMove }: CompareCardProps) {
  const label = displayModelId(item, index)
  const model = status.kind === 'ready' ? status.model : null
  const variants = useMemo(() => model?.variants.filter((variant) => variant.role === 'model') ?? [], [model])
  const sources = useMemo(() => ['estimated', ...new Set(variants.map((variant) => (variant.publisher ?? model?.owner ?? 'repository').toLowerCase()))], [model?.owner, variants])
  const sourceVariants = variants.filter((variant) => (variant.publisher ?? model?.owner ?? 'repository').toLowerCase() === item.source)
  const selectedVariant = sourceVariants.find((variant) => variant.id === item.variantId)
  const comparable = model?.spec !== null && model?.spec !== undefined && model.estimateConfidence !== 'weights-only'
  const estimate = comparable && model?.spec
    ? estimateVram(model.spec, {
      quantization: item.quantization, context: item.context, kvPrecision: item.kvPrecision, mlaCacheMode: item.mlaCacheMode,
      weightBytesOverride: selectedVariant?.weightSizeBytes,
    })
    : null
  const fit = estimate ? classifyFit(estimate.totalGiB, item.vramGiB) : null

  return (
    <article className="compare-card" role="region" aria-label={`Comparison for ${label}`}>
      <header><div><span>MODEL {index + 1}</span><h2>{label}</h2></div><div className="compare-card-actions"><button type="button" onClick={() => onMove(-1)} disabled={!canMoveLeft} aria-label={`Move ${label} left`}>←</button><button type="button" onClick={() => onMove(1)} disabled={!canMoveRight} aria-label={`Move ${label} right`}>→</button><button type="button" onClick={onRemove} aria-label={`Remove ${label}`}><X size={15} /></button></div></header>
      {status.kind === 'loading' && <p role="status">Loading public model…</p>}
      {status.kind === 'error' && <p className="compare-error" role="alert">This public model is unavailable.</p>}
      {model && (
        <>
          {comparable ? <div className="compare-controls">
            <label>Weight precision for {label}<select aria-label={`Weight precision for ${label}`} value={item.quantization} onChange={(event) => onChange({ quantization: event.target.value as QuantizationId })}>{quantizations.map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}</select></label>
            <label>Context for {label}<input aria-label={`Context for ${label}`} type="number" min="1024" step="1024" value={item.context} onChange={(event) => onChange({ context: Math.max(1024, Math.round(Number(event.target.value) / 1024) * 1024 || 1024) })} /></label>
            <label>KV precision for {label}<select aria-label={`KV precision for ${label}`} value={item.kvPrecision} onChange={(event) => onChange({ kvPrecision: event.target.value as KvPrecisionId })}>{kvPrecisions.map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}</select></label>
            {model.spec?.kvCache?.kind === 'mla' && <label>MLA mode for {label}<select aria-label={`MLA mode for ${label}`} value={item.mlaCacheMode} onChange={(event) => onChange({ mlaCacheMode: event.target.value as 'expanded' | 'latent' })}><option value="expanded">Expanded</option><option value="latent">Latent</option></select></label>}
            <label>VRAM for {label}<select aria-label={`VRAM for ${label}`} value={item.vramGiB} onChange={(event) => onChange({ vramGiB: Number(event.target.value) })}>{vramPresets.map((value) => <option key={value} value={value}>{value} GiB</option>)}</select></label>
            {sources.length > 1 && <label>Artifact source for {label}<select aria-label={`Artifact source for ${label}`} value={item.source} onChange={(event) => onChange({ source: event.target.value, variantId: null })}>{sources.map((source) => <option key={source} value={source}>{source}</option>)}</select></label>}
            {item.source !== 'estimated' && sourceVariants.length > 0 && <label>Artifact for {label}<select aria-label={`Artifact for ${label}`} value={item.variantId ?? ''} onChange={(event) => onChange({ variantId: event.target.value || null })}><option value="">Choose artifact</option>{sourceVariants.map((variant) => <option key={variant.id} value={variant.id}>{variant.label}</option>)}</select></label>}
          </div> : <p className="compare-not-comparable">Not comparable — this public model has resource evidence but no safe autoregressive memory estimate.</p>}
          <dl className="compare-rows">
            <div><dt>TOTAL</dt><dd>{formatGiB(estimate?.totalGiB ?? null)}{estimate?.isLowerBound ? ' lower bound' : ''}</dd></div>
            <div><dt>WEIGHTS</dt><dd>{formatGiB(estimate?.weightsGiB ?? (model.tensorSizeBytes ? model.tensorSizeBytes / 1024 ** 3 : null))}</dd></div>
            {comparable && <div><dt>KV CACHE</dt><dd>{formatGiB(estimate?.kvCacheGiB ?? null)}</dd></div>}
            {comparable && <div><dt>RUNTIME</dt><dd>{formatGiB(estimate?.runtimeGiB ?? null)}</dd></div>}
            <div><dt>HEADROOM / FIT</dt><dd>{estimate && fit ? `${(item.vramGiB - estimate.totalGiB).toFixed(2)} GiB · ${fit.replace('-', ' ')}` : 'Not comparable'}</dd></div>
            <div><dt>PUBLISHED ARTIFACT</dt><dd>{formatBytes(selectedVariant?.weightSizeBytes ?? model.tensorSizeBytes)}</dd></div>
            <div><dt>CONFIDENCE / EVIDENCE</dt><dd>{model.estimateConfidence} · {model.lastModified ? 'published metadata' : 'public metadata'}</dd></div>
            <div><dt>NATIVE CONTEXT</dt><dd>{comparable && model.maxContext ? `${model.maxContext.toLocaleString()} tokens` : 'Not comparable'}</dd></div>
            <div><dt>MODEL KIND</dt><dd>{model.modelKind}</dd></div>
          </dl>
        </>
      )}
    </article>
  )
}
