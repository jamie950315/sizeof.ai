import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  Columns2,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  Cpu,
  Database,
  Gauge,
  Info,
  MemoryStick,
  Search,
} from 'lucide-react'
import { models } from './data/models'
import ModelDetailPage from './ModelDetailPage'
import ComparePage from './ComparePage'
import {
  kvPrecisions,
  quantizations,
  type KvPrecisionId,
  type QuantizationId,
} from './data/quantizations'
import { estimateVram, rankModelsForVram, type Fit } from './lib/estimator'
import { contextLevels, stepContext } from './lib/context-stepper'
import { getMemoryBarPartPercents, getMemoryBarUsage } from './lib/memory-bar'
import { vramPresets } from './lib/vram-presets'
import { searchSizingStatusForTask } from './lib/model-task'
import {
  defaultCalculatorState,
  parseCalculatorState,
  serializeCalculatorState,
} from './lib/url-state'
import { parseHuggingFaceModelPath } from './lib/huggingface'
import { serializeCompareState } from './lib/compare-state'
import {
  createSearchCacheKey,
  readSearchCache,
  writeSearchCache,
  type HuggingFaceSearchModel,
  type HuggingFaceSearchResponse,
} from './lib/model-search-cache'

const contextPresets = contextLevels

function searchSizingStatus(model: HuggingFaceSearchModel) {
  return searchSizingStatusForTask(model.task, model.gated)
}

const modelTypeOptions = [
  { value: '', label: 'All model types' },
  { value: 'text-generation', label: 'Text generation' },
  { value: 'image-text-to-text', label: 'Vision + language' },
  { value: 'text-to-image', label: 'Text to image' },
  { value: 'text-to-video', label: 'Text to video' },
  { value: 'automatic-speech-recognition', label: 'Speech recognition' },
  { value: 'text-to-audio', label: 'Text to audio' },
  { value: 'feature-extraction', label: 'Embeddings' },
  { value: 'sentence-similarity', label: 'Sentence similarity' },
] as const

function searchModelRank(model: HuggingFaceSearchModel, query: string) {
  const normalizedQuery = query.toLocaleLowerCase('en')
  const owner = model.owner.toLocaleLowerCase('en')
  const name = model.name.toLocaleLowerCase('en')
  const id = model.id.toLocaleLowerCase('en')
  if (id === normalizedQuery) return 0
  if (name === normalizedQuery && owner === normalizedQuery) return 1
  if (name === normalizedQuery) return 2
  if (owner === normalizedQuery) return 3
  if (name.startsWith(normalizedQuery)) return 4
  return 5
}

function sortSearchModels(items: HuggingFaceSearchModel[], query: string) {
  return [...items].sort((left, right) => {
    const rankDifference = searchModelRank(left, query) - searchModelRank(right, query)
    if (rankDifference !== 0) return rankDifference
    if (right.trendingScore !== left.trendingScore) return right.trendingScore - left.trendingScore
    if (right.downloads !== left.downloads) return right.downloads - left.downloads
    return left.id.localeCompare(right.id)
  })
}

function formatGiB(value: number, digits = 2) {
  return `${value.toFixed(digits)} GiB`
}

function formatContext(value: number) {
  return value >= 1024 ? `${Math.round(value / 1024)}K` : String(value)
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function modelDetailPath(sourceUrl: string) {
  return new URL(sourceUrl).pathname
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

const fitLabels: Record<Fit, string> = {
  comfortable: 'COMFORTABLE',
  tight: 'TIGHT FIT',
  'too-large': 'TOO LARGE',
}

export default function App() {
  if (window.location.pathname === '/compare') return <ComparePage />
  const modelRoute = parseHuggingFaceModelPath(window.location.pathname)
  return modelRoute ? <ModelDetailPage route={modelRoute} /> : <HomePage />
}

function HomePage() {
  const initial = parseCalculatorState(window.location.search)
  const initialModel = models.some((model) => model.id === initial.modelId)
    ? initial.modelId
    : defaultCalculatorState.modelId
  const [modelId, setModelId] = useState(initialModel)
  const [quantization, setQuantization] = useState<QuantizationId>(initial.quantization)
  const [context, setContext] = useState(initial.context)
  const [kvPrecision, setKvPrecision] = useState<KvPrecisionId>(initial.kvPrecision)
  const [vramBudget, setVramBudget] = useState(32)
  const [catalogQuery, setCatalogQuery] = useState('')
  const [searchAuthor, setSearchAuthor] = useState('')
  const [searchModelType, setSearchModelType] = useState('')
  const [submittedCatalogQuery, setSubmittedCatalogQuery] = useState('')
  const [submittedSearchAuthor, setSubmittedSearchAuthor] = useState('')
  const [submittedSearchModelType, setSubmittedSearchModelType] = useState('')
  const [searchResults, setSearchResults] = useState<HuggingFaceSearchModel[] | null>(null)
  const [nextSearchCursor, setNextSearchCursor] = useState<string | null>(null)
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'loading-more' | 'error'>('idle')
  const [searchLoadMoreError, setSearchLoadMoreError] = useState(false)
  const searchRequestId = useRef(0)
  const searchTimer = useRef(0)
  const [copied, setCopied] = useState(false)

  const model = models.find((item) => item.id === modelId) ?? models[0]
  const estimate = estimateVram(model, { quantization, context, kvPrecision })
  const currentFit: Fit =
    estimate.totalGiB > vramBudget
      ? 'too-large'
      : estimate.totalGiB > vramBudget * 0.85
        ? 'tight'
        : 'comfortable'

  useEffect(() => {
    const query = serializeCalculatorState({ modelId, quantization, context, kvPrecision })
    window.history.replaceState(null, '', `${window.location.pathname}?${query}`)
  }, [modelId, quantization, context, kvPrecision])

  const recommendations = useMemo(
    () =>
      rankModelsForVram(models, {
        vramGiB: vramBudget,
        context,
        quantization,
        kvPrecision,
      }).filter((item) => item.fit !== 'too-large'),
    [context, kvPrecision, quantization, vramBudget],
  )

  async function copyShareLink() {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  function clearSearchResults() {
    searchRequestId.current += 1
    setSubmittedCatalogQuery('')
    setSubmittedSearchAuthor('')
    setSubmittedSearchModelType('')
    setSearchResults(null)
    setNextSearchCursor(null)
    setSearchLoadMoreError(false)
    setSearchState('idle')
  }

  async function executeSearch(
    query: string,
    author: string,
    modelType: string,
    options: { cursor?: string; refresh?: boolean } = {},
  ) {
    if (query.length < 1 || query.length > 80) return
    const requestId = searchRequestId.current + 1
    searchRequestId.current = requestId
    const cursor = options.cursor ?? ''
    const cacheKey = createSearchCacheKey({ query, author, modelType, cursor })
    setSubmittedCatalogQuery(query)
    setSubmittedSearchAuthor(author)
    setSubmittedSearchModelType(modelType)
    setSearchLoadMoreError(false)

    if (!cursor && !options.refresh) {
      const cached = readSearchCache(cacheKey)
      if (cached) {
        setSearchResults(sortSearchModels(cached.models, query))
        setNextSearchCursor(typeof cached.nextCursor === 'string' ? cached.nextCursor : null)
        setSearchState('idle')
        return
      }
    }

    if (cursor) setSearchState('loading-more')
    else {
      setNextSearchCursor(null)
      setSearchState('loading')
    }

    try {
      const params = new URLSearchParams({ q: query })
      if (author) params.set('author', author)
      if (modelType) params.set('type', modelType)
      if (cursor) params.set('cursor', cursor)
      const response = await fetch(`/api/search/models?${params.toString()}`)
      if (!response.ok) throw new Error('Search request failed')
      const payload = await response.json() as HuggingFaceSearchResponse
      if (searchRequestId.current !== requestId) return
      const incoming = Array.isArray(payload.models) ? payload.models : []
      const nextCursor = typeof payload.nextCursor === 'string' ? payload.nextCursor : null
      writeSearchCache(cacheKey, { query, models: incoming, nextCursor })
      setSearchResults((current) => {
        if (!cursor) return sortSearchModels(incoming, query)
        const modelsById = new Map((current ?? []).map((model) => [model.id, model]))
        for (const model of incoming) modelsById.set(model.id, model)
        return sortSearchModels([...modelsById.values()], query)
      })
      setNextSearchCursor(nextCursor)
      setSearchState('idle')
    } catch {
      if (searchRequestId.current !== requestId) return
      if (cursor) {
        setSearchLoadMoreError(true)
        setSearchState('idle')
        return
      }
      setSearchResults(null)
      setSearchState('error')
    }
  }

  useEffect(() => {
    const query = catalogQuery.trim()
    window.clearTimeout(searchTimer.current)
    if (!query) {
      clearSearchResults()
      return
    }
    searchTimer.current = window.setTimeout(() => {
      void executeSearch(query, searchAuthor.trim(), searchModelType)
    }, 80)
    return () => window.clearTimeout(searchTimer.current)
  }, [catalogQuery, searchAuthor, searchModelType])

  async function searchHuggingFace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    window.clearTimeout(searchTimer.current)
    const query = catalogQuery.trim()
    if (!query) {
      clearSearchResults()
      return
    }
    await executeSearch(query, searchAuthor.trim(), searchModelType, { refresh: true })
  }

  async function loadMoreSearchResults() {
    if (!nextSearchCursor || (searchState !== 'idle' && searchState !== 'error')) return
    await executeSearch(submittedCatalogQuery, submittedSearchAuthor, submittedSearchModelType, {
      cursor: nextSearchCursor,
    })
  }

  const memoryParts = [
    { label: 'Model weights', value: estimate.weightsGiB, className: 'weights' },
    { label: 'KV cache', value: estimate.kvCacheGiB, className: 'kv' },
    { label: 'Runtime buffer', value: estimate.runtimeGiB, className: 'runtime' },
  ]
  const memoryBarUsage = getMemoryBarUsage(estimate.totalGiB, vramBudget)
  const memoryBarPartPercents = getMemoryBarPartPercents(memoryParts.map((part) => part.value))
  const offloadLabel = memoryBarUsage.offloadGiB > 0
    ? `OFFLOAD ${formatGiB(memoryBarUsage.offloadGiB)}`
    : null

  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="sizeof.ai home">
          <span className="brand-bracket">[</span> sizeof<span>.ai</span>{' '}
          <span className="brand-bracket">]</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#calculator">Calculator</a>
          <a href="#recommendations">VRAM fit</a>
          <a href="#catalog">Models</a>
        </nav>
        <a className="source-link" href="#method" aria-label="Calculation method">
          <Code2 size={17} />
          <span>Method</span>
        </a>
      </header>

      <main id="top" className="home-main">
        <section className="home-search-explorer" aria-label="Model search explorer">
          <div className="hero-search home-search-bar" role="region" aria-label="Hugging Face model search">
            <form onSubmit={searchHuggingFace}>
              <div className="hero-search-main">
                <Search size={22} />
                <input
                  type="search"
                  aria-label="Search Hugging Face models"
                  placeholder="Search any Hugging Face model"
                  value={catalogQuery}
                  onChange={(event) => setCatalogQuery(event.target.value)}
                  maxLength={80}
                />
                <button
                  type="submit"
                  aria-label="Search Hugging Face"
                >
                  {searchState === 'loading' ? 'SEARCHING' : 'SEARCH'} <ArrowUpRight size={17} />
                </button>
              </div>
              <div className="hero-search-filters">
                <label>
                  <span>MODEL TYPE</span>
                  <select
                    aria-label="Filter by model type"
                    value={searchModelType}
                    onChange={(event) => setSearchModelType(event.target.value)}
                  >
                    {modelTypeOptions.map((option) => (
                      <option key={option.value || 'all'} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>AUTHOR</span>
                  <input
                    type="text"
                    aria-label="Filter by author"
                    placeholder="ANY AUTHOR"
                    value={searchAuthor}
                    onChange={(event) => setSearchAuthor(event.target.value)}
                    maxLength={96}
                  />
                </label>
                <p>Results update as you type.</p>
              </div>
            </form>
          </div>
        </section>

        {(submittedCatalogQuery || searchState !== 'idle') && (
          <section id="search-results" className="search-results-section" aria-label="Hugging Face search results">
            <div className="search-results-heading">
              <div>
                <span>SEARCH RESULT</span>
                <h2>“{submittedCatalogQuery}”</h2>
              </div>
              <p>{searchResults
                ? `${String(searchResults.length).padStart(2, '0')} MODELS FOUND`
                : 'LIVE HUGGING FACE DATA'}</p>
            </div>
            <div className="catalog-table search-results-table">
              <div className="catalog-header">
                <span>MODEL</span><span>DOWNLOADS</span><span>LIKES</span><span>TASK</span><span>SIZING</span><span />
              </div>
              {searchState === 'loading' && !searchResults && (
                <div className="catalog-state" role="status"><span className="pulse-dot" /> Searching Hugging Face for “{submittedCatalogQuery}”…</div>
              )}
              {searchState === 'error' && (
                <div className="catalog-state catalog-error" role="alert">Hugging Face search is unavailable. Your curated model index is unchanged.</div>
              )}
              {searchState === 'idle' && searchResults?.length === 0 && (
                <div className="catalog-state">No Hugging Face models matched “{submittedCatalogQuery}”.</div>
              )}
              {searchResults?.map((item) => (
                <article key={item.id} className="catalog-row hf-search-row">
                  <div className="catalog-name">
                    <span>{item.owner}</span>
                    <strong>{item.name}</strong>
                    <div>
                      <i>{item.owner}</i>
                      {item.gated && <i>GATED</i>}
                    </div>
                  </div>
                  <div><small>DOWNLOADS</small><strong>{formatCompactNumber(item.downloads)}</strong></div>
                  <div><small>LIKES</small><strong>{formatCompactNumber(item.likes)}</strong></div>
                  <div><small>TASK</small><strong>{item.task?.replaceAll('-', ' ') ?? 'UNSPECIFIED'}</strong></div>
                  <div><small>SIZING</small><strong>{searchSizingStatus(item)}</strong></div>
                  <div className="catalog-actions">
                    <a className="catalog-open-model" href={`/${item.owner}/${item.name}`} aria-label={`Open ${item.id}`}>OPEN</a>
                    <a className="catalog-compare-action" href={comparePath(item.id)} aria-label={`Compare ${item.id}`}><Columns2 size={17} /><span className="catalog-compare-label">COMPARE</span></a>
                    <a href={`https://huggingface.co/${item.id}`} target="_blank" rel="noreferrer" aria-label={`${item.id} on Hugging Face`}><ArrowUpRight size={17} /></a>
                  </div>
                </article>
              ))}
              {searchLoadMoreError && (
                <div className="catalog-state catalog-error" role="alert">Could not load the next page. Try Load More again.</div>
              )}
            </div>
            {nextSearchCursor && searchResults && (
              <button
                className="load-more-button"
                type="button"
                aria-label="Load more models"
                disabled={searchState !== 'idle'}
                onClick={() => void loadMoreSearchResults()}
              >
                {searchState === 'loading-more' ? 'LOADING' : 'LOAD MORE MODELS'} <ArrowDownRight size={18} />
              </button>
            )}
            <span className="visually-hidden" role="status" aria-live="polite">
              {searchState === 'loading' ? `Searching Hugging Face for ${submittedCatalogQuery}` : searchState === 'loading-more' ? 'Loading more Hugging Face models' : ''}
            </span>
          </section>
        )}

        <section id="catalog" className="catalog-section" aria-label="Model catalog">
          <div className="section-heading">
            <div>
              <span className="section-index">03</span>
              <p>MODEL INDEX</p>
            </div>
            <h2>Curated model index</h2>
          </div>
          <div className="catalog-toolbar">
            <span>{String(models.length).padStart(2, '0')} TEXT-OUTPUT MODELS</span>
            <span>{String(quantizations.length).padStart(2, '0')} QUANTIZATIONS</span>
            <span>UPDATED 22 AUG 2026</span>
          </div>
          <div className="catalog-table">
            <div className="catalog-header">
              <span>MODEL</span><span>PARAMETERS</span><span>MAX CONTEXT</span><span>ARCHITECTURE</span><span />
            </div>
            {models.map((item) => (
              <article key={item.id} className={`catalog-row${modelId === item.id ? ' selected' : ''}`}>
                <button
                  type="button"
                  className="catalog-row-select"
                  aria-label={`Select ${item.name}`}
                  aria-pressed={modelId === item.id}
                  onClick={() => setModelId(item.id)}
                />
                <div className="catalog-name">
                  <span>{item.maker}</span>
                  <strong>{item.name}</strong>
                  <div>{item.strengths.map((tag) => <i key={tag}>{tag}</i>)}</div>
                </div>
                <div><small>PARAMETERS</small><strong>{item.parametersB}B</strong></div>
                <div><small>MAX CONTEXT</small><strong>{formatContext(item.maxContext)}</strong></div>
                <div><small>ARCHITECTURE</small><strong>{item.layers}L / {item.kvHeads} KVH</strong></div>
                <div className="catalog-actions">
                  <a className="catalog-open-model" href={modelDetailPath(item.sourceUrl)} target="_blank" rel="noreferrer" aria-label={`Size ${item.name} (opens in new tab)`}>SIZE IT</a>
                  <a className="catalog-compare-action" href={comparePath(new URL(item.sourceUrl).pathname.slice(1))} aria-label={`Compare ${item.name}`}><Columns2 size={17} /><span className="catalog-compare-label">COMPARE</span></a>
                  <a href={item.sourceUrl} target="_blank" rel="noreferrer" aria-label={`${item.name} source`}><ArrowUpRight size={17} /></a>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="calculator" className="calculator-section" aria-label="VRAM calculator">
          <div className="section-heading">
            <div>
              <span className="section-index">01</span>
              <p>SELECTED MODEL</p>
            </div>
            <h2>VRAM calculator</h2>
          </div>

          <div className="calculator-grid">
            <div className="controls-panel">
              <div className="control-block">
                <label htmlFor="model-select">Model</label>
                <div className="select-wrap">
                  <select
                    id="model-select"
                    aria-label="Model"
                    value={modelId}
                    onChange={(event) => setModelId(event.target.value)}
                  >
                    {models.map((item) => (
                      <option value={item.id} key={item.id}>{item.name}</option>
                    ))}
                  </select>
                  <ArrowDownRight size={18} />
                </div>
                <div className="model-meta">
                  <span>{model.maker}</span>
                  <span>{model.parametersB}B PARAMS</span>
                  <span>{formatContext(model.maxContext)} NATIVE</span>
                </div>
              </div>

              <div className="control-block">
                <div className="label-row">
                  <label>Weight quantization</label>
                  <span>{quantizations.find((item) => item.id === quantization)?.note}</span>
                </div>
                <div className="quant-grid">
                  {quantizations.map((item) => (
                    <button
                      className={quantization === item.id ? 'active' : ''}
                      type="button"
                      key={item.id}
                      onClick={() => setQuantization(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="control-block context-block">
                <div className="label-row">
                  <label htmlFor="context-input">Context window</label>
                  <span>TOKENS</span>
                </div>
                <div className="context-input-row">
                  <input
                    id="context-input"
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
                    <button
                      type="button"
                      className={context === value ? 'active' : ''}
                      key={value}
                      onClick={() => setContext(value)}
                    >
                      {formatContext(value)}
                    </button>
                  ))}
                </div>
                {estimate.exceedsNativeContext && (
                  <p className="warning">Above the published native context. Scaling may affect quality.</p>
                )}
              </div>

              <div className="split-controls">
                <div className="control-block compact">
                  <label htmlFor="kv-select">KV cache precision</label>
                  <select
                    id="kv-select"
                    value={kvPrecision}
                    onChange={(event) => setKvPrecision(event.target.value as KvPrecisionId)}
                  >
                    {kvPrecisions.map((item) => (
                      <option value={item.id} key={item.id}>{item.label}</option>
                    ))}
                  </select>
                </div>
                <div className="control-block compact">
                  <label htmlFor="vram-select">Your VRAM</label>
                  <select
                    id="vram-select"
                    value={vramBudget}
                    onChange={(event) => setVramBudget(Number(event.target.value))}
                  >
                    {vramPresets.map((value) => (
                      <option value={value} key={value}>{value} GiB</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="result-panel">
              <div className="result-topline">
                <span>ESTIMATED VRAM</span>
                <span className={`fit-pill ${currentFit}`}>{fitLabels[currentFit]} ON {vramBudget} GB</span>
              </div>
              <div className="total-number">
                <span>{estimate.totalGiB.toFixed(2)}</span>
                <small>GiB</small>
              </div>
              <div
                className="memory-bar"
                role="img"
                data-motion="memory-usage"
                aria-label={`Memory usage: ${estimate.totalGiB.toFixed(2)} GiB used of ${vramBudget} GiB VRAM${offloadLabel ? `, ${offloadLabel}` : ''}`}
              >
                <div
                  className="memory-bar-used"
                  style={{
                    width: `${memoryBarUsage.usedPercent}%`,
                    '--memory-weights-offload-opacity': memoryBarUsage.weightsOffloadOpacity,
                  } as CSSProperties}
                >
                  {memoryParts.map((part, index) => (
                    <span
                      className={part.className}
                      key={part.label}
                      style={{ width: `${memoryBarPartPercents[index]}%` }}
                    />
                  ))}
                  <span
                    className="memory-bar-risk"
                    aria-hidden="true"
                    style={{ opacity: memoryBarUsage.riskOpacity }}
                  />
                </div>
                <span
                  className="memory-bar-remaining"
                  aria-hidden="true"
                  style={{ width: `${memoryBarUsage.remainingPercent}%` }}
                />
                {offloadLabel && <span className="memory-bar-offload">{offloadLabel}</span>}
              </div>
              <div className="result-model">
                <div>
                  <span>CONFIGURATION</span>
                  <strong>{model.name}</strong>
                  <p>{quantizations.find((item) => item.id === quantization)?.label} · {formatContext(context)} context · {kvPrecision.toUpperCase()} KV</p>
                </div>
                <button type="button" className="copy-button" onClick={() => void copyShareLink()}>
                  {copied ? <Check size={17} /> : <Copy size={17} />}
                  {copied ? 'COPIED' : 'COPY LINK'}
                </button>
              </div>
              <p className="estimate-note">
                <Info size={15} /> Includes weights, KV cache, and runtime allowance. Actual use varies by engine and GPU offload.
              </p>
            </div>
          </div>
        </section>

        <section id="recommendations" className="recommendation-section">
          <div className="section-heading light">
            <div>
              <span className="section-index">02</span>
              <p>VRAM FIT</p>
            </div>
            <h2>Models for {vramBudget} GB</h2>
          </div>
          <div className="vram-strip" aria-label="VRAM capacity">
            {vramPresets.map((value) => (
              <button
                type="button"
                key={value}
                className={vramBudget === value ? 'active' : ''}
                onClick={() => setVramBudget(value)}
              >
                <span>{value}</span> GB
              </button>
            ))}
          </div>

          <div className="recommendation-intro">
            <p>TOP PICKS FOR</p>
            <strong>{vramBudget} GB</strong>
            <span>{formatContext(context)} context · {quantizations.find((item) => item.id === quantization)?.label}</span>
          </div>
          <div className="recommendation-grid">
            {recommendations.slice(0, 3).map((item, index) => (
              <article className="recommendation-card" key={item.model.id}>
                <div className="card-rank">0{index + 1}</div>
                <div className="card-maker">{item.model.maker}</div>
                <h3>{item.model.name}</h3>
                <div className="card-tags">
                  {item.model.strengths.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}
                </div>
                <div className="card-memory">
                  <div>
                    <span>EST. VRAM</span>
                    <strong>{item.estimate.totalGiB.toFixed(1)} GB</strong>
                  </div>
                  <div>
                    <span>HEADROOM</span>
                    <strong>{item.headroomGiB.toFixed(1)} GB</strong>
                  </div>
                </div>
                <button type="button" onClick={() => { setModelId(item.model.id); document.querySelector('#calculator')?.scrollIntoView({ behavior: 'smooth' }) }}>
                  CALCULATE <ArrowUpRight size={17} />
                </button>
              </article>
            ))}
            {recommendations.length === 0 && (
              <div className="empty-recommendation">No catalog model fits this setup. Try a smaller quantization or context.</div>
            )}
          </div>
        </section>

        <section className="hf-shortcut home-url-tool" aria-label="Hugging Face URL shortcut">
          <div className="hf-shortcut-copy">
            <span>HUGGING FACE URL SHORTCUT</span>
            <h2>Open a model by URL</h2>
            <p>Keep the owner and model path. Replace only the Hugging Face domain with sizeof.ai.</p>
          </div>
          <div className="hf-url-swap">
            <code>huggingface.co/Qwen/Qwen3.8-27B</code>
            <ArrowDownRight size={24} />
            <code><strong>sizeof.ai</strong>/Qwen/Qwen3.8-27B</code>
            <a href="/Qwen/Qwen3.8-27B" aria-label="Try the model detail page">TRY IT <ArrowUpRight size={17} /></a>
          </div>
        </section>

        <section id="method" className="method-section">
          <div className="method-title">
            <span>HOW IT WORKS</span>
            <h2>Methodology</h2>
            <p>No mystery score. Every estimate is built from the model architecture and a small set of visible assumptions.</p>
          </div>
          <div className="method-grid">
            <div><Database /><span>01</span><h3>Weights</h3><p>Parameter count × effective bits per weight for the selected GGUF quantization.</p></div>
            <div><MemoryStick /><span>02</span><h3>KV cache</h3><p>KV-bearing attention layers × KV heads × head dimension × context × cache precision, for batch size one. Local/sliding-window caches and hybrid state buffers vary by engine and are not separately modeled, so actual use can differ.</p></div>
            <div><Cpu /><span>03</span><h3>Runtime</h3><p>A practical allowance for compute buffers, metadata, and inference-engine workspace.</p></div>
            <div><Gauge /><span>04</span><h3>Fit</h3><p>Under 85% is comfortable; 85–100% is tight; over capacity requires partial CPU offload.</p></div>
          </div>
        </section>
      </main>

      <footer>
        <div className="brand"><span className="brand-bracket">[</span> sizeof<span>.ai</span> <span className="brand-bracket">]</span></div>
        <div><a href="#calculator">Calculator</a><a href="#catalog">Model data</a><a href="#method">Method</a></div>
        <span>ESTIMATES, NOT GUARANTEES · 2026</span>
      </footer>
    </div>
  )
}
