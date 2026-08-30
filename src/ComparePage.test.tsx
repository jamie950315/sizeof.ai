import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ComparePage from './ComparePage'

let writeText: ReturnType<typeof vi.fn>

const safeModel = (id: string) => {
  const [owner, name] = id.split('/')
  return {
    id, owner, name, author: owner, parametersB: 7, downloads: 1, likes: 1, lastModified: null,
    pipelineTag: 'text-generation', libraryName: 'transformers', license: null, tags: [], architecture: 'Test', modelType: 'test',
    modelKind: 'language', componentKind: 'model', tensorSizeBytes: 8_000_000_000, repositorySizeBytes: 8_000_000_000,
    parameterCountKind: 'logical', moe: null, speculative: null, estimateConfidence: 'safe', variants: [], resourceEstimate: null,
    addon: null, estimateReason: null, layers: 16, attentionLayers: 16, maxContext: 32768, quantizationFormat: null,
    configSourceId: null, sourceUrl: `https://huggingface.co/${id}`,
    attentionProfile: { fullLayers: 16, slidingLayers: 0, linearLayers: 0, kdaLayers: 0, recurrentLayers: 0, ssmLayers: 0, slidingWindow: null, stateKind: null },
    spec: { id: `hf-${name}`, name, family: 'test', maker: owner, parametersB: 7, layers: 16, attentionLayers: 16, kvHeads: 8, headDim: 128, maxContext: 32768, releaseYear: 2026, strengths: [], sourceUrl: `https://huggingface.co/${id}`, estimateConfidence: 'safe' },
  }
}

function compareUrl(...ids: string[]) {
  return `/compare?compare=1&${ids.map((id) => `model=${encodeURIComponent(`${id}~q4_k_m~8192~fp16~expanded~32~estimated~none`)}`).join('&')}`
}

describe('model comparison workspace', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', compareUrl('Qwen/One', 'Meta/Two'))
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const match = String(input).match(/\/api\/models\/([^/]+)\/([^?]+)/)
      return Promise.resolve(Response.json(safeModel(`${decodeURIComponent(match![1])}/${decodeURIComponent(match![2])}`)))
    }))
    writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('shows two successful public models in URL and DOM order', async () => {
    render(<ComparePage />)

    expect(await screen.findByRole('heading', { name: 'Compare models' })).toBeInTheDocument()
    expect(screen.getAllByRole('region', { name: /Comparison for / }).map((card) => card.getAttribute('aria-label'))).toEqual([
      'Comparison for Qwen/One', 'Comparison for Meta/Two',
    ])
    expect(screen.getAllByText('TOTAL').length).toBe(2)
    expect(window.location.search).toContain('compare=1')
  })

  it('keeps a successful card visible beside a normalized public failure', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/Meta/Two?')) return Promise.resolve(Response.json({ error: 'Private model' }, { status: 404 }))
      return Promise.resolve(Response.json(safeModel('Qwen/One')))
    }))
    render(<ComparePage />)

    expect(await screen.findByRole('region', { name: 'Comparison for Qwen/One' })).toHaveTextContent('TOTAL')
    expect(await screen.findByRole('region', { name: 'Comparison for Meta/Two' })).toHaveTextContent('This public model is unavailable.')
  })

  it('keeps a setting change scoped to one model card', async () => {
    const user = userEvent.setup()
    render(<ComparePage />)
    const cards = await screen.findAllByRole('region', { name: /Comparison for / })

    await user.selectOptions(within(cards[0]).getByRole('combobox', { name: 'Weight precision for Qwen/One' }), 'fp16')

    expect(within(cards[0]).getByRole('combobox', { name: 'Weight precision for Qwen/One' })).toHaveValue('fp16')
    expect(within(cards[1]).getByRole('combobox', { name: 'Weight precision for Meta/Two' })).toHaveValue('q4_k_m')
  })

  it('keeps unsafe models factual instead of showing LLM comparison numbers', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => Promise.resolve(Response.json({
      ...safeModel(String(input).includes('/Meta/Two?') ? 'Meta/Two' : 'Qwen/One'),
      modelKind: 'image', estimateConfidence: 'weights-only', estimateReason: 'modality-specific', spec: null,
    }))))
    render(<ComparePage />)

    const cards = await screen.findAllByRole('region', { name: /Comparison for / })
    expect(within(cards[0]).getByText(/^Not comparable —/)).toBeInTheDocument()
    expect(within(cards[0]).queryByText('KV CACHE')).not.toBeInTheDocument()
  })

  it('limits the builder to four models and copies the reproducible URL', async () => {
    const user = userEvent.setup()
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    window.history.replaceState(null, '', '/compare')
    render(<ComparePage />)

    const inputs = screen.getAllByRole('textbox', { name: /Model [12] ID/ })
    await user.type(inputs[0], 'Qwen/One')
    await user.type(inputs[1], 'Meta/Two')
    await user.click(screen.getByRole('button', { name: 'Compare models' }))
    expect(await screen.findAllByRole('region', { name: /Comparison for / })).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Add model' }))
    await user.click(screen.getByRole('button', { name: 'Add model' }))
    expect(screen.queryByRole('button', { name: 'Add model' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copy comparison link' }))
    await vi.waitFor(() => expect(copy).toHaveBeenCalledWith(expect.stringContaining('/compare?compare=1')))
  })

  it('aborts stale requests when browser comparison state changes', async () => {
    const pending: AbortSignal[] = []
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      pending.push(init!.signal as AbortSignal)
      return new Promise(() => undefined)
    }))
    render(<ComparePage />)
    await vi.waitFor(() => expect(pending).toHaveLength(2))

    window.history.replaceState(null, '', compareUrl('New/Three', 'New/Four'))
    window.dispatchEvent(new PopStateEvent('popstate'))

    await vi.waitFor(() => expect(pending).toHaveLength(4))
    expect(pending.slice(0, 2).every((signal) => signal.aborted)).toBe(true)
  })

  it('does not refetch already loaded models after status updates', async () => {
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const match = String(input).match(/\/api\/models\/([^/]+)\/([^?]+)/)
      return Promise.resolve(Response.json(safeModel(`${decodeURIComponent(match![1])}/${decodeURIComponent(match![2])}`)))
    })
    vi.stubGlobal('fetch', fetcher)
    render(<ComparePage />)

    await screen.findAllByRole('region', { name: /Comparison for / })
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  })
})
