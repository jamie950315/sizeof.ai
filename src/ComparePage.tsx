import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useCopy } from './lib/use-copy'
import { ArrowLeft, Check, Copy, Plus, X } from 'lucide-react'
import { models as curatedModels } from './data/models'
import { kvPrecisions, quantizations, type KvPrecisionId } from './data/quantizations'
import { classifyFit, estimateVram } from './lib/estimator'
import type { HuggingFaceModel } from './lib/huggingface'
import { normalizeCompareModelInput, parseCompareState, serializeCompareState, validateCompareModelId, type CompareItemState } from './lib/compare-state'
import { vramPresets } from './lib/vram-presets'
import { maximumContext, normalizedContext } from './lib/context-stepper'
import { buildModelEvidence } from './lib/evidence'
import ExportMenu from './components/ExportMenu'
import type { SizingExportInput } from './lib/export'
import { getMemoryBarPartPercents, getMemoryBarUsage } from './lib/memory-bar'

const defaults: Omit<CompareItemState, 'modelId'> = {
  quantization: 'q4_k_m', context: 8192, kvPrecision: 'fp16', mlaCacheMode: 'expanded', vramGiB: 32, source: 'estimated', variantId: null,
}

type ModelStatus = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; model: HuggingFaceModel; stale: boolean }
type QueuedModel = { key: string; modelId: string; generation: number }

function estimateOptions(model: HuggingFaceModel, item: CompareItemState, selectedVariant: HuggingFaceModel['variants'][number] | null) {
  return {
    quantization: item.quantization,
    context: item.context,
    kvPrecision: item.kvPrecision,
    mlaCacheMode: item.mlaCacheMode,
    weightBytesOverride: selectedVariant?.role === 'model' ? selectedVariant.weightSizeBytes : undefined,
    additionalWeightBytes: model.addon
      ? selectedVariant?.role === 'addon' ? selectedVariant.weightSizeBytes : model.addon.sizeBytes ?? undefined
      : undefined,
  }
}

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

function curatedModelId(sourceUrl: string) {
  return new URL(sourceUrl).pathname.slice(1)
}

function CompareSiteHeader() {
  return (
    <header className="compare-site-nav">
      <a className="brand" href="/" aria-label="sizeof.ai home">sizeof<span>.ai</span></a>
      <a href="/#catalog" aria-label="Model index"><ArrowLeft size={16} /> MODEL INDEX</a>
      <span>COMPARE WORKSPACE</span>
    </header>
  )
}

function SuggestedModelSelect({ index, onChoose }: { index: number; onChoose: (value: string) => void }) {
  return (
    <select aria-label={`Suggested model ${index + 1}`} value="" onChange={(event) => onChoose(event.target.value)}>
      <option value="">TOP MODELS</option>
      {curatedModels.map((model) => {
        const id = curatedModelId(model.sourceUrl)
        return <option value={id} key={id}>{model.name} — {id}</option>
      })}
    </select>
  )
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
  const { copied, copyError, copy } = useCopy()
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
  const exportInput = useMemo<SizingExportInput | null>(() => {
    const ready = activeItems.flatMap((item) => {
      const status = models[canonicalModelKey(item.modelId)]
      if (status?.kind !== 'ready') return []
      const model = status.model
      const variants = model.variants.filter((variant) => variant.role === (model.addon ? 'addon' : 'model'))
      const selectedVariant = variants.find((variant) => (variant.publisher ?? model.owner ?? 'repository').toLowerCase() === item.source && variant.id === item.variantId) ?? null
      const estimate = model.spec && model.estimateConfidence !== 'weights-only' && (item.source === 'estimated' || selectedVariant !== null)
        ? estimateVram(model.spec, estimateOptions(model, item, selectedVariant))
        : null
      return [{ item, model, estimate, selectedVariant }]
    })
    if (ready.length !== activeItems.length) return null
    return {
      generatedAt: new Date().toISOString(),
      records: ready.map(({ item, model, estimate, selectedVariant }) => ({
        model: { id: model.id, sourceUrl: model.sourceUrl },
        configuration: { quantization: item.quantization, contextTokens: item.context, kvPrecision: item.kvPrecision, mlaCacheMode: item.mlaCacheMode, source: item.source, variantId: selectedVariant?.id ?? null, artifactWeightGiB: selectedVariant?.weightSizeBytes ? selectedVariant.weightSizeBytes / 1024 ** 3 : null },
        hardware: { capacityGiB: item.vramGiB },
        estimate: estimate ? { kind: estimate.isLowerBound ? 'lower-bound' : 'estimate', totalGiB: estimate.totalGiB, weightsGiB: estimate.weightsGiB, kvCacheGiB: estimate.kvCacheGiB, runtimeGiB: estimate.runtimeGiB } : null,
        resourceProfile: !estimate && model.resourceEstimate ? { kind: model.resourceEstimate.kind, title: model.resourceEstimate.title, totalGiB: model.resourceEstimate.options[0]?.components.reduce((sum, component) => sum + component.sizeBytes, 0) / 1024 ** 3 } : null,
        evidence: model.spec
          ? buildModelEvidence(model.spec, selectedVariant, model.lastModified ?? undefined)
          : [{ id: `comparison:${model.id}`, label: `Public model: ${model.id}`, kind: 'verified', detail: 'Public model metadata included in this comparison.', sourceUrl: model.sourceUrl, repositoryUpdatedAt: model.lastModified ?? undefined }],
      })),
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
              const updated: Record<string, ModelStatus> = { ...modelsRef.current, [next.key]: { kind: 'ready', model: payload, stale: response.headers.get('X-Sizeof-Model-Source') === 'kv-stale' } }
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
      const normalized = normalizeCompareModelInput(draft)
      const result = validateCompareModelId(normalized ?? draft)
      if (!result.valid) { errors[index] = validationMessage(result.reason); return [] }
      const key = result.canonicalId.toLowerCase()
      if (unique.has(key)) { errors[index] = validationMessage('duplicate'); return [] }
      unique.add(key)
      return [{ modelId: result.canonicalId, ...defaults }]
    })
    setBuilderErrors(errors)
    if (valid.length < 2) return
    setBuilderDrafts(valid.map((item) => item.modelId))
    setItems(valid)
    setSubmitted(true)
  }

  const updateBuilderDraft = (index: number, value: string) => {
    setBuilderDrafts((current) => current.map((draft, draftIndex) => draftIndex === index ? value : draft))
    const normalized = normalizeCompareModelInput(value)
    const result = validateCompareModelId(normalized ?? value)
    setBuilderErrors((current) => {
      const next = { ...current }
      if (result.valid) delete next[index]
      else next[index] = validationMessage(result.reason)
      return next
    })
  }

  const addPendingModel = (index: number) => {
    const rawValue = pendingDrafts[index] ?? ''
    const normalized = normalizeCompareModelInput(rawValue)
    const result = validateCompareModelId(normalized ?? rawValue)
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
    await copy(`${window.location.origin}/compare?${serializeCompareState({ items: activeItems })}`)
  }

  if (!canCompare) {
    return (
      <><CompareSiteHeader /><main className="compare-page compare-builder" aria-labelledby="compare-title">
          <span>MODEL WORKSPACE</span>
          <h1 id="compare-title">Compare models</h1>
          <p>Choose a top model or paste an owner/repository, Hugging Face URL, or sizeof.ai URL.</p>
          <div className="compare-builder-inputs">
            {builderDrafts.map((draft, index) => (
              <label key={index}>
                <span>MODEL {index + 1}</span>
                <SuggestedModelSelect index={index} onChoose={(value) => value && updateBuilderDraft(index, value)} />
                <input
                  id={index === 0 ? 'compare-add' : undefined}
                  aria-label={`Model ${index + 1} ID or URL`}
                  aria-invalid={Boolean(builderErrors[index])}
                  aria-describedby={builderErrors[index] ? `builder-error-${index}` : undefined}
                  value={draft}
                  placeholder="owner/repository or model URL"
                  maxLength={512}
                  onChange={(event) => updateBuilderDraft(index, event.target.value)}
                />
                {builderErrors[index] && <small id={`builder-error-${index}`} role="alert">{builderErrors[index]}</small>}
              </label>
            ))}
          </div>
          <p className="compare-examples">Recommended: <button type="button" aria-label="Compare Qwen3.8 27B with Ornith 1.5 35B A3B" onClick={() => {
            const examples = [{ modelId: 'Qwen/Qwen3.8-27B', ...defaults }, { modelId: 'ornith-ai/Ornith-1.5-35B-A3B', ...defaults }]
            setBuilderDrafts(examples.map((item) => item.modelId))
            setBuilderErrors({})
            setItems(examples)
            setSubmitted(true)
          }}>Qwen3.8 27B + Ornith 1.5 35B A3B</button></p>
          {Object.keys(builderErrors).length > 0 && <p className="compare-error" role="alert">Choose two unique public model IDs to compare.</p>}
          <button type="button" className="compare-primary" onClick={applyBuilder}>Compare models</button>
        </main></>
    )
  }

  return (
    <><CompareSiteHeader /><main className="compare-page" aria-labelledby="compare-title">
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
      {copyError && <p role="alert">{copyError}</p>}
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
          />
        ))}
      </section>
      {pendingDrafts.length > 0 && (
        <section className="compare-pending" aria-label="Additional comparison models">
          {pendingDrafts.map((draft, index) => (
            <label key={index}>Model {items.length + index + 1}
              <SuggestedModelSelect index={items.length + index} onChoose={(value) => value && setPendingDrafts((current) => current.map((draft, draftIndex) => draftIndex === index ? value : draft))} />
              <input
                id={`compare-pending-${items.length + index + 1}`}
                aria-label={`Model ${items.length + index + 1} ID or URL`}
                aria-invalid={Boolean(pendingErrors[index])}
                aria-describedby={pendingErrors[index] ? `pending-error-${index}` : undefined}
                value={draft}
                placeholder="owner/repository"
                maxLength={512}
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
    </main></>
  )
}

interface CompareCardProps {
  item: CompareItemState
  index: number
  status: ModelStatus
  onChange: (update: Partial<CompareItemState>) => void
  onRemove: () => void
}

function CompareCard({ item, index, status, onChange, onRemove }: CompareCardProps) {
  const label = displayModelId(item, index)
  const model = status.kind === 'ready' ? status.model : null
  const variants = useMemo(() => model?.variants.filter((variant) => variant.role === (model.addon ? 'addon' : 'model')) ?? [], [model])
  const sources = useMemo(() => ['estimated', ...new Set(variants.map((variant) => (variant.publisher ?? model?.owner ?? 'repository').toLowerCase()))], [model?.owner, variants])
  const sourceVariants = variants.filter((variant) => (variant.publisher ?? model?.owner ?? 'repository').toLowerCase() === item.source)
  const selectedVariant = sourceVariants.find((variant) => variant.id === item.variantId)
  const missingArtifact = item.source !== 'estimated' && !selectedVariant
  const comparable = model?.spec !== null && model?.spec !== undefined && model.estimateConfidence !== 'weights-only'
  const estimate = comparable && model?.spec && !missingArtifact
    ? estimateVram(model.spec, estimateOptions(model, item, selectedVariant ?? null))
    : null
  const fit = estimate ? classifyFit(estimate.totalGiB, item.vramGiB) : null
  const memoryUsage = estimate ? getMemoryBarUsage(estimate.totalGiB, item.vramGiB) : null
  const memoryParts = estimate ? getMemoryBarPartPercents([estimate.weightsGiB, estimate.kvCacheGiB, estimate.runtimeGiB]) : []
  const contextPresets = [4096, 8192, 16384, 32768].filter((value) => value <= (model?.maxContext ?? 32768))
  const memoryStyle = memoryUsage ? {
    width: `${memoryUsage.usedPercent}%`,
    '--memory-risk-opacity': memoryUsage.riskOpacity,
    '--memory-weights-offload-opacity': memoryUsage.weightsOffloadOpacity,
  } as CSSProperties : undefined

  return (
    <article className="compare-card" role="region" aria-label={`Comparison for ${label}`}>
      <header><div><span>MODEL {index + 1}</span><h2 id={cardId(item.modelId)} tabIndex={-1}>{label}</h2></div><div className="compare-card-actions"><button type="button" onClick={onRemove} aria-label={`Remove ${label}`}><X size={15} /></button></div></header>
      {status.kind === 'loading' && <p>Loading public model…</p>}
      {status.kind === 'error' && <p className="compare-error" role="alert">This public model is unavailable.</p>}
      {status.kind === 'ready' && status.stale && <p role="alert">Showing older saved model data because the latest metadata could not be refreshed. Values may be out of date.</p>}
      {model && missingArtifact && <p role="alert">The selected artifact is unavailable. Choose an available artifact or switch to estimated weights.</p>}
      {model && (
        <>
          {comparable ? <div className="compare-controls">
            <fieldset className="compare-quant-control"><legend>Weight precision for {label}</legend><div className="compare-quant-grid">{quantizations.map((value) => <button type="button" key={value.id} aria-label={`${value.label} for ${label}`} aria-pressed={item.quantization === value.id} className={item.quantization === value.id ? 'active' : ''} onClick={() => onChange({ quantization: value.id })}>{value.label}</button>)}</div></fieldset>
            <label className="compare-context-control">Context for {label}<input aria-label={`Context for ${label}`} type="number" min="1024" max={maximumContext} step="1024" value={item.context} onChange={(event) => onChange({ context: normalizedContext(Math.round(Number(event.target.value) / 1024) * 1024) })} /><span className="compare-context-presets">{contextPresets.map((value) => <button type="button" key={value} aria-label={`${value / 1024}K context for ${label}`} className={item.context === value ? 'active' : ''} onClick={() => onChange({ context: value })}>{value / 1024}K</button>)}</span></label>
            <label>KV precision for {label}<select aria-label={`KV precision for ${label}`} value={item.kvPrecision} onChange={(event) => onChange({ kvPrecision: event.target.value as KvPrecisionId })}>{kvPrecisions.map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}</select></label>
            {model.spec?.kvCache?.kind === 'mla' && <label>MLA mode for {label}<select aria-label={`MLA mode for ${label}`} value={item.mlaCacheMode} onChange={(event) => onChange({ mlaCacheMode: event.target.value as 'expanded' | 'latent' })}><option value="expanded">Expanded</option><option value="latent">Latent</option></select></label>}
            <label>VRAM for {label}<select aria-label={`VRAM for ${label}`} value={item.vramGiB} onChange={(event) => onChange({ vramGiB: Number(event.target.value) })}>{vramPresets.map((value) => <option key={value} value={value}>{value} GiB</option>)}</select></label>
            {(sources.length > 1 || missingArtifact) && <label>Artifact source for {label}<select aria-label={`Artifact source for ${label}`} value={item.source} onChange={(event) => onChange({ source: event.target.value, variantId: variants.find((variant) => (variant.publisher ?? model.owner).toLowerCase() === event.target.value)?.id ?? null })}>{!sources.includes(item.source) && <option value={item.source}>{item.source} (unavailable)</option>}{sources.map((source) => <option key={source} value={source}>{source}</option>)}</select></label>}
            {item.source !== 'estimated' && sourceVariants.length > 0 && <label>Artifact for {label}<select aria-label={`Artifact for ${label}`} value={item.variantId ?? ''} onChange={(event) => onChange({ variantId: event.target.value || null })}><option value="">Choose artifact</option>{sourceVariants.map((variant) => <option key={variant.id} value={variant.id}>{variant.label}</option>)}</select></label>}
          </div> : <p className="compare-not-comparable">Not comparable — this public model has resource evidence but no safe autoregressive memory estimate.</p>}
          {estimate && memoryUsage && <div className="compare-memory-bar"><div className="compare-memory-summary"><span>VRAM USAGE</span><strong>{estimate.totalGiB.toFixed(2)} / {item.vramGiB} GiB</strong></div><div className={`memory-bar${memoryUsage.offloadGiB > 0 ? ' has-offload' : ''}`} role="img" aria-label={`Memory usage: ${estimate.totalGiB.toFixed(2)} GiB used of ${item.vramGiB} GiB VRAM`}><div className="memory-bar-used" style={memoryStyle}><span className="weights" style={{ width: `${memoryParts[0]}%` }} /><span className="kv" style={{ width: `${memoryParts[1]}%` }} /><span className="runtime" style={{ width: `${memoryParts[2]}%` }} /><span className="memory-bar-risk" aria-hidden="true" style={{ opacity: memoryUsage.riskOpacity }} /></div><span className="memory-bar-remaining" aria-hidden="true" style={{ width: `${memoryUsage.remainingPercent}%` }} />{memoryUsage.offloadGiB > 0 && <span className="memory-bar-offload">OFFLOAD {memoryUsage.offloadGiB.toFixed(2)} GiB</span>}</div></div>}
          <dl className="compare-rows">
            <div><dt>TOTAL</dt><dd>{formatGiB(estimate?.totalGiB ?? null)}{estimate?.isLowerBound ? ' lower bound' : ''}</dd></div>
            <div><dt>WEIGHTS</dt><dd>{formatGiB(estimate?.weightsGiB ?? (model.tensorSizeBytes ? model.tensorSizeBytes / 1024 ** 3 : null))}</dd></div>
            {comparable && <div><dt>KV CACHE</dt><dd>{formatGiB(estimate?.kvCacheGiB ?? null)}</dd></div>}
            {comparable && <div><dt>RUNTIME</dt><dd>{formatGiB(estimate?.runtimeGiB ?? null)}</dd></div>}
            <div><dt>HEADROOM / FIT</dt><dd>{estimate?.isLowerBound ? 'Fit not verified — runtime memory is incomplete' : estimate && fit ? `${(item.vramGiB - estimate.totalGiB).toFixed(2)} GiB · ${fit.replace('-', ' ')}` : 'Not comparable'}</dd></div>
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
