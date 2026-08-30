import { StrictMode } from 'react'
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
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

  it('rejects reserved and duplicate builder IDs accessibly without adding them to comparison state or copied URLs', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/compare')
    render(<ComparePage />)
    const [first, second] = screen.getAllByRole('textbox', { name: /Model [12] ID/ })
    await user.type(first, 'compare/workspace')
    await user.type(second, 'Qwen/One')
    expect(screen.getByText(/reserved route/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Compare models' }))
    expect(screen.getByText(/choose two unique public model IDs/i)).toBeInTheDocument()
    expect(window.location.search).not.toContain('compare%2Fworkspace')
  })

  it('does not refetch or erase results when one card setting changes while offline', async () => {
    const user = userEvent.setup()
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const match = String(input).match(/\/api\/models\/([^/]+)\/([^?]+)/)
      return Promise.resolve(Response.json(safeModel(`${decodeURIComponent(match![1])}/${decodeURIComponent(match![2])}`)))
    })
    vi.stubGlobal('fetch', fetcher)
    render(<ComparePage />)
    const cards = await screen.findAllByRole('region', { name: /Comparison for / })
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

    await user.selectOptions(within(cards[0]).getByRole('combobox', { name: 'Weight precision for Qwen/One' }), 'fp16')

    expect(within(cards[0]).getByText('TOTAL')).toBeInTheDocument()
    expect(within(cards[1]).getByText('TOTAL')).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('adds, removes, reorders, and focuses two additional cards within the four-model cap', async () => {
    const user = userEvent.setup()
    render(<ComparePage />)
    await screen.findAllByRole('region', { name: /Comparison for / })
    await user.click(screen.getByRole('button', { name: 'Add model' }))
    await user.type(screen.getByRole('textbox', { name: 'Model 3 ID' }), 'Org/Three')
    await user.click(screen.getByRole('button', { name: 'Add Org/Three' }))
    expect(document.activeElement).toBe(await screen.findByRole('heading', { name: 'Org/Three' }))
    await user.click(screen.getByRole('button', { name: 'Add model' }))
    await user.type(screen.getByRole('textbox', { name: 'Model 4 ID' }), 'Org/Four')
    await user.click(screen.getByRole('button', { name: 'Add Org/Four' }))
    expect(screen.getAllByRole('region', { name: /Comparison for / })).toHaveLength(4)
    expect(screen.queryByRole('button', { name: 'Add model' })).not.toBeInTheDocument()
    expect(screen.getByText('Maximum of four models may be compared.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Move Org/Four left' }))
    expect(screen.getAllByRole('region', { name: /Comparison for / }).map((card) => card.getAttribute('aria-label'))).toEqual([
      'Comparison for Qwen/One', 'Comparison for Meta/Two', 'Comparison for Org/Four', 'Comparison for Org/Three',
    ])
    await user.click(screen.getByRole('button', { name: 'Remove Org/Four' }))
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Org/Three' }))
  })

  it('keeps artifact selection and every item setting in the copied URL independent', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => Promise.resolve(Response.json({
      ...safeModel(String(input).includes('/Meta/Two?') ? 'Meta/Two' : 'Qwen/One'),
      variants: [{ id: 'artifact-1', label: 'Q4', format: 'gguf', revision: 'a'.repeat(40), path: 'q4.gguf', source: 'file', role: 'model', bitsPerWeight: 4, weightSizeBytes: 4 * 1024 ** 3, totalSizeBytes: 4 * 1024 ** 3, publisher: 'unsloth' }],
    }))))
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    render(<ComparePage />)
    const cards = await screen.findAllByRole('region', { name: /Comparison for / })
    await user.selectOptions(within(cards[0]).getByRole('combobox', { name: 'Artifact source for Qwen/One' }), 'unsloth')
    await user.selectOptions(within(cards[0]).getByRole('combobox', { name: 'Artifact for Qwen/One' }), 'artifact-1')
    await user.selectOptions(within(cards[0]).getByRole('combobox', { name: 'VRAM for Qwen/One' }), '96')
    await user.click(screen.getByRole('button', { name: 'Copy comparison link' }))
    await vi.waitFor(() => expect(copy).toHaveBeenCalled())
    expect(copy.mock.calls[0][0]).toContain('artifact-1')
    expect(copy.mock.calls[0][0]).toContain('~96~unsloth~artifact-1')
    expect(within(cards[1]).getByRole('combobox', { name: 'Artifact source for Meta/Two' })).toHaveValue('estimated')
  })

  it('provides one compact mobile model selector with anchors and no per-card loading live regions', async () => {
    render(<ComparePage />)
    expect(screen.getByRole('navigation', { name: 'Comparison model selector' })).toHaveTextContent('Qwen/One')
    expect(screen.getAllByText('Loading public model…').every((node) => !node.hasAttribute('role'))).toBe(true)
  })

  it('keeps only the remaining model in the builder and URL after comparison drops below two', async () => {
    const user = userEvent.setup()
    const view = render(<ComparePage />)
    await screen.findAllByText('TOTAL')

    await user.click(screen.getByRole('button', { name: 'Remove Meta/Two' }))

    const [first, second] = screen.getAllByRole('textbox', { name: /Model [12] ID/ })
    expect(first).toHaveValue('Qwen/One')
    expect(second).toHaveValue('')
    expect(window.location.search).toContain('Qwen%2FOne')
    expect(window.location.search).not.toContain('Meta%2FTwo')

    view.unmount()
    render(<ComparePage />)
    const [restoredFirst, restoredSecond] = screen.getAllByRole('textbox', { name: /Model [12] ID/ })
    expect(restoredFirst).toHaveValue('Qwen/One')
    expect(restoredSecond).toHaveValue('')
  })

  it('preserves cached cards and fetches only a newly added model across add, reorder, and remove', async () => {
    const user = userEvent.setup()
    let offline = false
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const match = String(input).match(/\/api\/models\/([^/]+)\/([^?]+)/)
      const id = `${decodeURIComponent(match![1])}/${decodeURIComponent(match![2])}`
      requests.push(id)
      return offline
        ? Promise.resolve(Response.json({ error: 'offline' }, { status: 503 }))
        : Promise.resolve(Response.json(safeModel(id)))
    }))
    render(<ComparePage />)
    await screen.findAllByText('TOTAL')
    expect(requests).toEqual(['Qwen/One', 'Meta/Two'])

    offline = true
    await user.click(screen.getByRole('button', { name: 'Add model' }))
    await user.type(screen.getByRole('textbox', { name: 'Model 3 ID' }), 'Org/Three')
    await user.click(screen.getByRole('button', { name: 'Add Org/Three' }))
    expect(await screen.findByRole('region', { name: 'Comparison for Org/Three' })).toHaveTextContent('This public model is unavailable.')
    expect(screen.getByRole('region', { name: 'Comparison for Qwen/One' })).toHaveTextContent('TOTAL')
    expect(screen.getByRole('region', { name: 'Comparison for Meta/Two' })).toHaveTextContent('TOTAL')
    expect(requests).toEqual(['Qwen/One', 'Meta/Two', 'Org/Three'])

    await user.click(screen.getByRole('button', { name: 'Move Org/Three left' }))
    await user.click(screen.getByRole('button', { name: 'Remove Org/Three' }))
    expect(requests).toEqual(['Qwen/One', 'Meta/Two', 'Org/Three'])
  })

  it('focuses the fourth pending model input when its add control reaches the cap', async () => {
    const user = userEvent.setup()
    render(<ComparePage />)
    await screen.findAllByText('TOTAL')
    await user.click(screen.getByRole('button', { name: 'Add model' }))
    await user.type(screen.getByRole('textbox', { name: 'Model 3 ID' }), 'Org/Three')
    await user.click(screen.getByRole('button', { name: 'Add Org/Three' }))

    await user.click(screen.getByRole('button', { name: 'Add model' }))

    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Model 4 ID' }))
  })

  it('creates collision-free selector anchors for distinct valid canonical IDs', async () => {
    window.history.replaceState(null, '', compareUrl('A-B/C', 'A_B/C', 'A.B/C'))
    render(<ComparePage />)
    const links = within(screen.getByRole('navigation', { name: 'Comparison model selector' })).getAllByRole('link')
    const targets = links.map((link) => document.getElementById(link.getAttribute('href')!.slice(1)))

    expect(new Set(links.map((link) => link.getAttribute('href'))).size).toBe(3)
    expect(targets.map((target) => target?.textContent)).toEqual(['A-B/C', 'A_B/C', 'A.B/C'])
  })

  it('completes the initial two-model load after StrictMode replays effects', async () => {
    render(<StrictMode><ComparePage /></StrictMode>)

    expect(await screen.findAllByText('TOTAL')).toHaveLength(2)
  })

  it('keeps no more than two requests active while third and fourth models are added', async () => {
    const user = userEvent.setup()
    const pending = new Map<string, ReturnType<typeof deferred<Response>>>()
    let active = 0
    let maxActive = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const match = String(input).match(/\/api\/models\/([^/]+)\/([^?]+)/)
      const id = `${decodeURIComponent(match![1])}/${decodeURIComponent(match![2])}`
      const request = deferred<Response>()
      pending.set(id, request)
      active++
      maxActive = Math.max(maxActive, active)
      void request.promise.then(() => { active-- })
      return request.promise
    }))
    render(<ComparePage />)
    await vi.waitFor(() => expect(pending.size).toBe(2))

    await user.click(screen.getByRole('button', { name: 'Add model' }))
    await user.type(screen.getByRole('textbox', { name: 'Model 3 ID' }), 'Org/Three')
    await user.click(screen.getByRole('button', { name: 'Add Org/Three' }))
    await user.click(screen.getByRole('button', { name: 'Add model' }))
    await user.type(screen.getByRole('textbox', { name: 'Model 4 ID' }), 'Org/Four')
    await user.click(screen.getByRole('button', { name: 'Add Org/Four' }))

    expect(maxActive).toBe(2)
    expect(pending.has('Org/Three')).toBe(false)
    expect(pending.has('Org/Four')).toBe(false)
  })

  it('never starts a queued model request after that model is removed', async () => {
    const user = userEvent.setup()
    const pending = new Map<string, ReturnType<typeof deferred<Response>>>()
    const requested: string[] = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const match = String(input).match(/\/api\/models\/([^/]+)\/([^?]+)/)
      const id = `${decodeURIComponent(match![1])}/${decodeURIComponent(match![2])}`
      requested.push(id)
      const request = deferred<Response>()
      pending.set(id, request)
      return request.promise
    }))
    render(<ComparePage />)
    await vi.waitFor(() => expect(requested).toEqual(['Qwen/One', 'Meta/Two']))
    await user.click(screen.getByRole('button', { name: 'Add model' }))
    await user.type(screen.getByRole('textbox', { name: 'Model 3 ID' }), 'Org/Three')
    await user.click(screen.getByRole('button', { name: 'Add Org/Three' }))
    await user.click(screen.getByRole('button', { name: 'Remove Org/Three' }))

    pending.get('Qwen/One')!.resolve(Response.json(safeModel('Qwen/One')))
    pending.get('Meta/Two')!.resolve(Response.json(safeModel('Meta/Two')))
    await screen.findAllByText('TOTAL')
    expect(requested).toEqual(['Qwen/One', 'Meta/Two'])
  })

  it('does not start queued work or report late state updates after unmount', async () => {
    const pending = deferred<Response>()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn(() => pending.promise))
    const view = render(<StrictMode><ComparePage /></StrictMode>)
    view.unmount()

    pending.resolve(Response.json(safeModel('Qwen/One')))
    await Promise.resolve()
    await Promise.resolve()
    expect(consoleError).not.toHaveBeenCalled()
  })
})
