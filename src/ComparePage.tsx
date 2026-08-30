import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Plus, X } from 'lucide-react'
import { kvPrecisions, quantizations, type KvPrecisionId, type QuantizationId } from './data/quantizations'
import { classifyFit, estimateVram } from './lib/estimator'
import type { HuggingFaceModel } from './lib/huggingface'
import { parseCompareState, serializeCompareState, validateCompareModelId, type CompareItemState } from './lib/compare-state'
import { vramPresets } from './lib/vram-presets'
import ExportMenu from './components/ExportMenu'

const defaults: Omit<CompareItemState, 'modelId'> = {
  quantization: 'q4_k_m', context: 8192, kvPrecision: 'fp16', mlaCacheMode: 'expanded', vramGiB: 32, source: 'estimated', variantId: null,
}

type ModelStatus = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; model: HuggingFaceModel }
type QueuedModel = { key: string; modelId: string; generation: number }

function currentItems() {
  return parseCompareState(window.location.search, defaults).items
}

function initialItems() {
  return currentItems()
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

function validationMessage(reason: 'empty' | 'malformed' | 'reserved' | 'duplicate') {
  if (reason === 'reserved') return 'This is a reserved route, not a public model ID.'
  if (reason === 'duplicate') return 'Each comparison model must be unique.'
  if (reason === 'empty') return 'Enter an owner/repository model ID.'
  return 'Use a public owner/repository model ID.'
}

function cardId(modelId: string) {
  return `compare-card-${encodeURIComponent(modelId.toLowerCase()).replace(/%/g, '_')}`
}

function canonicalModelKey(modelId: string) {
  return modelId.toLowerCase()
}

export default function ComparePage() {
  const [items, setItems] = useState<CompareItemState[]>(initialItems)
  const [submitted, setSubmitted] = useState(() => currentItems().length >= 2)
  const [models, setModels] = useState<Record<string, ModelStatus>>({})
  const modelsRef = useRef<Record<string, ModelStatus>>({})
  const activeRequests = useRef(new Map<string, AbortController>())
  const selectedIds = useRef(new Map<string, string>())
  const requestQueue = useRef<QueuedModel[]>([])
  const requestGeneration = useRef(0)
  const isMounted = useRef(false)
  const [copied, setCopied] = useState(false)
  const [builderDrafts, setBuilderDrafts] = useState(() => [...currentItems().map((item) => item.modelId), '', ''].slice(0, 2))
  const [builderErrors, setBuilderErrors] = useState<Record<number, string>>({})
  const [pendingDrafts, setPendingDrafts] = useState<string[]>([])
  const [pendingErrors, setPendingErrors] = useState<Record<number, string>>({})
  const [focusModelId, setFocusModelId] = useState<string | null>(null)
  const [focusPendingInput, setFocusPendingInput] = useState<number | null>(null)
  const activeItems = items
  const canCompare = submitted && activeItems.length >= 2
  const modelIdsKey = activeItems.map((item) => canonicalModelKey(item.modelId)).sort().join('|')
  const fetchIds = useMemo(() => activeItems.map((item) => item.modelId), [modelIdsKey])
  const sharedVram = activeItems.every((item) => item.vramGiB === activeItems[0]?.vramGiB)
    ? String(activeItems[0]?.vramGiB ?? '')
    : 'mixed'
  const exportInput = useMemo(() => {
    const ready = activeItems.flatMap((item) => {
      const status = models[canonicalModelKey(item.modelId)]
      if (status?.kind !== 'ready') return []
      const model = status.model
      const estimate = model.spec && model.estimateConfidence !== 'weights-only'
        ? estimateVram(model.spec, { quantization: item.quantization, context: item.context, kvPrecision: item.kvPrecision, mlaCacheMode: item.mlaCacheMode })
        : null
      return [{ item, model, estimate }]
    })
    if (ready.length === 0) return null
    return {
      model: { id: ready.map(({ model }) => model.id).join(' | ') },
      configuration: { quantization: 'comparison', contextTokens: ready[0]!.item.context, kvPrecision: 'per-model' },
      hardware: { capacityGiB: Math.max(...ready.map(({ item }) => item.vramGiB)) },
      estimate: { kind: ready.some(({ estimate }) => Boolean(estimate?.isLowerBound)) ? 'lower-bound' as const : 'estimate' as const, totalGiB: ready.reduce((sum, entry) => sum + (entry.estimate?.totalGiB ?? 0), 0) },
      evidence: ready.map(({ model }) => ({ id: `comparison:${model.id}`, label: `Public model: ${model.id}`, kind: 'verified' as const, detail: 'Public model metadata included in this comparison.', sourceUrl: model.sourceUrl })),
      generatedAt: new Date().toISOString(),
    }
  }, [activeItems, models])

  useEffect(() => {
    const restore = () => {
      const restored = currentItems()
      setItems(restored)
      setBuilderDrafts([...restored.map((item) => item.modelId), '', ''].slice(0, 2))
      setPendingDrafts([])
      setSubmitted(restored.length >= 2)
    }
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [])

  useEffect(() => {
    if (!submitted) return
    window.history.replaceState(null, '', `/compare?${serializeCompareState({ items: activeItems })}`)
  }, [activeItems, submitted])

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
      requestGeneration.current++
      requestQueue.current = []
      selectedIds.current.clear()
      for (const controller of activeRequests.current.values()) controller.abort()
      activeRequests.current.clear()
      modelsRef.current = Object.fromEntries(Object.entries(modelsRef.current).filter(([, status]) => status.kind !== 'loading'))
    }
  }, [])

  useEffect(() => {
    const generation = ++requestGeneration.current
    const idsByKey = new Map(fetchIds.map((modelId) => [canonicalModelKey(modelId), modelId]))
    selectedIds.current = idsByKey
    const desiredKeys = new Set(idsByKey.keys())
    for (const [key, controller] of activeRequests.current) {
      if (!canCompare || !desiredKeys.has(key)) {
        controller.abort()
        activeRequests.current.delete(key)
      }
    }
    const retained = Object.fromEntries(Object.entries(modelsRef.current).filter(([key]) => desiredKeys.has(key)))
    modelsRef.current = retained
    setModels(retained)
    if (!canCompare) return
    const nextQueue: QueuedModel[] = []
    for (const modelId of fetchIds) {
      const key = canonicalModelKey(modelId)
      const status = modelsRef.current[key]
      if (activeRequests.current.has(key)) continue
      if (status && status.kind !== 'loading') continue
      modelsRef.current[key] = { kind: 'loading' }
      nextQueue.push({ key, modelId, generation })
    }
    requestQueue.current = nextQueue
    setModels({ ...modelsRef.current })

    const pump = () => {
      if (!isMounted.current) return
      while (activeRequests.current.size < 2) {
        const next = requestQueue.current.shift()
        if (!next) return
        if (next.generation !== requestGeneration.current || selectedIds.current.get(next.key) !== next.modelId || activeRequests.current.has(next.key)) continue
        const controller = new AbortController()
        activeRequests.current.set(next.key, controller)
        void (async () => {
          try {
            const response = await fetch(`/api/models/${encodeURIComponent(next.modelId.split('/')[0])}/${encodeURIComponent(next.modelId.split('/')[1])}?schema=13`, { signal: controller.signal })
            const payload = await response.json() as HuggingFaceModel
            if (!response.ok) throw new Error('unavailable')
            if (!controller.signal.aborted && isMounted.current && selectedIds.current.has(next.key) && activeRequests.current.get(next.key) === controller) {
              const updated: Record<string, ModelStatus> = { ...modelsRef.current, [next.key]: { kind: 'ready', model: payload } }
              modelsRef.current = updated
              setModels(updated)
            }
          } catch {
            if (!controller.signal.aborted && isMounted.current && selectedIds.current.has(next.key) && activeRequests.current.get(next.key) === controller) {
              const updated: Record<string, ModelStatus> = { ...modelsRef.current, [next.key]: { kind: 'error' } }
              modelsRef.current = updated
              setModels(updated)
            }
          } finally {
            if (activeRequests.current.get(next.key) === controller) activeRequests.current.delete(next.key)
            pump()
          }
        })()
      }
    }
    pump()
    return () => {
      requestQueue.current = requestQueue.current.filter((entry) => entry.generation !== generation)
    }
  }, [canCompare, fetchIds, modelIdsKey])

  useEffect(() => {
    if (!focusModelId) return
    const target = document.getElementById(cardId(focusModelId)) ?? document.getElementById('compare-add')
    target?.focus()
    setFocusModelId(null)
  }, [focusModelId, items])

  useEffect(() => {
    if (focusPendingInput === null) return
    document.getElementById(`compare-pending-${focusPendingInput}`)?.focus()
    setFocusPendingInput(null)
  }, [focusPendingInput, pendingDrafts, items.length])

  const updateItem = (index: number, update: Partial<CompareItemState>) => {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...update } : item))
  }

  const applyBuilder = () => {
    const unique = new Set<string>()
    const errors: Record<number, string> = {}
    const valid = builderDrafts.flatMap((draft, index) => {
      const result = validateCompareModelId(draft)
      if (!result.valid) { errors[index] = validationMessage(result.reason); return [] }
      const key = result.canonicalId.toLowerCase()
      if (unique.has(key)) { errors[index] = validationMessage('duplicate'); return [] }
      unique.add(key)
      return [{ modelId: result.canonicalId, ...defaults }]
    })
    setBuilderErrors(errors)
    if (valid.length < 2) return
    setItems(valid)
    setSubmitted(true)
  }

  const updateBuilderDraft = (index: number, value: string) => {
    setBuilderDrafts((current) => current.map((draft, draftIndex) => draftIndex === index ? value : draft))
    const result = validateCompareModelId(value)
    setBuilderErrors((current) => {
      const next = { ...current }
      if (result.valid) delete next[index]
      else next[index] = validationMessage(result.reason)
      return next
    })
  }

  const addPendingModel = (index: number) => {
    const result = validateCompareModelId(pendingDrafts[index] ?? '')
    const used = new Set(items.map((item) => item.modelId.toLowerCase()))
    if (!result.valid || used.has(result.valid ? result.canonicalId.toLowerCase() : '')) {
      setPendingErrors((current) => ({ ...current, [index]: validationMessage(!result.valid ? result.reason : 'duplicate') }))
      return
    }
    setItems((current) => [...current, { modelId: result.canonicalId, ...defaults }])
    setPendingDrafts((current) => current.filter((_, draftIndex) => draftIndex !== index))
    setPendingErrors({})
    setFocusModelId(result.canonicalId)
  }

  const copyLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/compare?${serializeCompareState({ items: activeItems })}`)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  if (!canCompare) {
    return (
      <main className="compare-page compare-builder" aria-labelledby="compare-title">
        <span>MODEL WORKSPACE</span>
        <h1 id="compare-title">Compare models</h1>
        <p>Compare two to four public Hugging Face model profiles with independent memory settings.</p>
        <div className="compare-builder-inputs">
          {builderDrafts.map((draft, index) => (
            <label key={index}>
              <span>MODEL {index + 1} ID</span>
              <input
                id={index === 0 ? 'compare-add' : undefined}
                aria-label={`Model ${index + 1} ID`}
                aria-invalid={Boolean(builderErrors[index])}
                aria-describedby={builderErrors[index] ? `builder-error-${index}` : undefined}
                value={draft}
                placeholder="owner/repository"
                maxLength={193}
                onChange={(event) => updateBuilderDraft(index, event.target.value)}
              />
              {builderErrors[index] && <small id={`builder-error-${index}`} role="alert">{builderErrors[index]}</small>}
            </label>
          ))}
        </div>
        <p className="compare-examples">Examples: <button type="button" onClick={() => {
          const examples = [{ modelId: 'Qwen/Qwen3.8-27B', ...defaults }, { modelId: 'meta-llama/Llama-3.3-70B-Instruct', ...defaults }]
          setBuilderDrafts(examples.map((item) => item.modelId))
          setBuilderErrors({})
          setItems(examples)
          setSubmitted(true)
        }}>Qwen/Qwen3.8-27B + Llama-3.3-70B-Instruct</button></p>
        {Object.keys(builderErrors).length > 0 && <p className="compare-error" role="alert">Choose two unique public model IDs to compare.</p>}
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
            <select aria-label="Shared VRAM capacity" value={sharedVram} onChange={(event) => {
              const value = Number(event.target.value)
              if (value) setItems((current) => current.map((item) => ({ ...item, vramGiB: value })))
            }}><option value="mixed">Mixed</option><option value="">Independent</option>{vramPresets.map((value) => <option value={value} key={value}>{value} GiB for all</option>)}</select>
          </label>
          {exportInput && <ExportMenu input={exportInput} label="Export comparison" fileStem="sizeof-ai-comparison" />}
          <button type="button" onClick={() => void copyLink()} aria-label="Copy comparison link">{copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'COPIED' : 'COPY LINK'}</button>
        </div>
      </header>
      <p className="visually-hidden" role="status" aria-live="polite">{Object.values(models).some((status) => status.kind === 'loading') ? 'Loading comparison models' : ''}</p>
      <nav className="compare-mobile-selector" aria-label="Comparison model selector">
        {activeItems.map((item) => <a key={item.modelId} href={`#${cardId(item.modelId)}`} onClick={() => setFocusModelId(item.modelId)}>{item.modelId}</a>)}
      </nav>
      <section className="compare-cards" aria-label="Model comparisons">
        {activeItems.map((item, index) => (
          <CompareCard
            key={`${item.modelId}-${index}`}
            item={item}
            index={index}
            status={models[canonicalModelKey(item.modelId)] ?? { kind: 'loading' }}
            onChange={(update) => updateItem(index, update)}
            onRemove={() => setItems((current) => {
              const next = current.filter((_, itemIndex) => itemIndex !== index)
              setBuilderDrafts([...next.map((nextItem) => nextItem.modelId), '', ''].slice(0, 2))
              setPendingDrafts([])
              setFocusModelId(next[index]?.modelId ?? next[index - 1]?.modelId ?? null)
              return next
            })}
            canMoveLeft={index > 0}
            canMoveRight={index < activeItems.length - 1}
            onMove={(direction) => setItems((current) => {
              const destination = index + direction
              if (destination < 0 || destination >= current.length) return current
              const next = [...current]
              ;[next[index], next[destination]] = [next[destination], next[index]]
              setFocusModelId(item.modelId)
              return next
            })}
          />
        ))}
      </section>
      {pendingDrafts.length > 0 && (
        <section className="compare-pending" aria-label="Additional comparison models">
          {pendingDrafts.map((draft, index) => (
            <label key={index}>Model {items.length + index + 1} ID
              <input
                id={`compare-pending-${items.length + index + 1}`}
                aria-label={`Model ${items.length + index + 1} ID`}
                aria-invalid={Boolean(pendingErrors[index])}
                aria-describedby={pendingErrors[index] ? `pending-error-${index}` : undefined}
                value={draft}
                placeholder="owner/repository"
                maxLength={193}
                onChange={(event) => setPendingDrafts((current) => current.map((value, draftIndex) => draftIndex === index ? event.target.value : value))}
              />
              {pendingErrors[index] && <small id={`pending-error-${index}`} role="alert">{pendingErrors[index]}</small>}
              <button type="button" onClick={() => addPendingModel(index)}>{draft ? `Add ${draft}` : 'Confirm model'}</button>
            </label>
          ))}
        </section>
      )}
      {items.length + pendingDrafts.length < 4
        ? <button id="compare-add" type="button" className="compare-add" onClick={() => setPendingDrafts((current) => {
          const next = [...current, '']
          setFocusPendingInput(items.length + next.length)
          return next
        })}><Plus size={16} /> Add model</button>
        : <p className="compare-cap">Maximum of four models may be compared.</p>}
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
      <header><div><span>MODEL {index + 1}</span><h2 id={cardId(item.modelId)} tabIndex={-1}>{label}</h2></div><div className="compare-card-actions"><button type="button" onClick={() => onMove(-1)} disabled={!canMoveLeft} aria-label={`Move ${label} left`}>←</button><button type="button" onClick={() => onMove(1)} disabled={!canMoveRight} aria-label={`Move ${label} right`}>→</button><button type="button" onClick={onRemove} aria-label={`Remove ${label}`}><X size={15} /></button></div></header>
      {status.kind === 'loading' && <p>Loading public model…</p>}
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
