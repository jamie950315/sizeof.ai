import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import stylesCss from './styles.css?inline'

const testStyles = document.createElement('style')
beforeAll(() => {
  testStyles.textContent = stylesCss
  document.head.append(testStyles)
})

afterAll(() => testStyles.remove())

describe('sizeof.ai app', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'))

  it('opens directly into the model explorer without a marketing hero', () => {
    render(<App />)

    expect(screen.getByRole('region', { name: 'Model search explorer' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /know what fits/i })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'VRAM calculator' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Model catalog' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('qwen3.8-27b')
    expect(screen.getAllByText('Qwen3.8 27B').length).toBeGreaterThan(0)
    expect(screen.getByRole('img', { name: /memory usage/i })).toBeInTheDocument()
    expect(screen.queryByText('Model weights')).not.toBeInTheDocument()
    expect(screen.queryByText('Runtime buffer')).not.toBeInTheDocument()
  })

  it('defaults the homepage calculator to 32 GiB VRAM', () => {
    render(<App />)

    expect(screen.getByRole('combobox', { name: 'Your VRAM' })).toHaveValue('32')
    expect(screen.getByText('COMFORTABLE ON 32 GB')).toBeInTheDocument()
  })

  it('offers the same workstation and multi-GPU VRAM capacities as model pages', () => {
    render(<App />)

    const vram = screen.getByRole('combobox', { name: 'Your VRAM' })
    expect(Array.from(vram.querySelectorAll('option'), (option) => option.value)).toEqual([
      '8', '12', '16', '24', '32', '36', '48', '64', '80', '96', '128', '192', '256', '384', '512',
    ])
  })

  it('shows a current Hugging Face text-output example catalog', () => {
    render(<App />)

    const catalog = screen.getByRole('region', { name: 'Model catalog' })
    for (const name of [
      'Qwen3.8 27B',
      'Ornith 1.5 35B A3B',
      'Muse Glimmer 30B',
      'Ornith 1.5 9B',
      'Qwen3.6 35B A3B',
      'KAT-Coder V2.5 Dev',
      'Qwen3.6 27B',
      'gpt-oss 20B',
      'MiniCPM5 1B',
    ]) {
      expect(within(catalog).getByText(name)).toBeInTheDocument()
    }
    expect(within(catalog).queryByText('Llama 3.1 8B')).not.toBeInTheDocument()
    expect(screen.getByText('09 TEXT-OUTPUT MODELS')).toBeInTheDocument()
    expect(screen.getByText('08 QUANTIZATIONS')).toBeInTheDocument()
    expect(screen.getByText('UPDATED 22 AUG 2026')).toBeInTheDocument()
  })

  it('moves context halfway toward the next preset in either direction', async () => {
    const user = userEvent.setup()
    render(<App />)

    const input = screen.getByRole('spinbutton', { name: 'Context window' }) as HTMLInputElement

    expect(input).toHaveAttribute('min', '1024')
    expect(input).toHaveAttribute('step', '1')

    await user.click(screen.getByRole('button', { name: '4K' }))
    await user.click(screen.getByRole('button', { name: 'Decrease context window' }))
    expect(input).toHaveValue(3072)
    await user.click(screen.getByRole('button', { name: 'Decrease context window' }))
    expect(input).toHaveValue(2048)

    await user.click(screen.getByRole('button', { name: '4K' }))
    await user.click(screen.getByRole('button', { name: 'Increase context window' }))
    expect(input).toHaveValue(6144)
    await user.click(screen.getByRole('button', { name: 'Increase context window' }))
    expect(input).toHaveValue(8192)

    await user.click(screen.getByRole('button', { name: '4K' }))
    await user.click(screen.getByRole('button', { name: 'Decrease context window' }))
    await user.click(screen.getByRole('button', { name: 'Increase context window' }))
    expect(input).toHaveValue(4096)

    await user.click(screen.getByRole('button', { name: '4K' }))
    await user.click(screen.getByRole('button', { name: 'Increase context window' }))
    await user.click(screen.getByRole('button', { name: 'Decrease context window' }))
    expect(input).toHaveValue(4096)
  })

  it('offers common context window quick selections', () => {
    render(<App />)

    const contextBlock = screen.getByRole('spinbutton', { name: 'Context window' }).closest('.context-block')
    expect(contextBlock).not.toBeNull()

    for (const label of ['4K', '8K', '16K', '32K', '64K', '128K', '256K']) {
      expect(contextBlock).toHaveTextContent(label)
    }
  })

  it('shows used memory against the full VRAM capacity', () => {
    render(<App />)

    const calculator = screen.getByRole('region', { name: 'VRAM calculator' })
    const chart = within(calculator).getByRole('img', { name: /memory usage/i })
    const used = chart.querySelector('.memory-bar-used') as HTMLElement
    const remaining = chart.querySelector('.memory-bar-remaining') as HTMLElement

    expect(chart).toHaveAttribute('data-motion', 'memory-usage')
    expect(calculator.querySelector('.total-number')?.nextElementSibling).toBe(chart)
    expect(calculator.querySelector('.breakdown-list')).not.toBeInTheDocument()
    expect(used).toBeInTheDocument()
    expect(remaining).toBeInTheDocument()
    expect(used.style.width).toMatch(/%$/)
    expect(remaining.style.width).toMatch(/%$/)
  })

  it('aligns the complete homepage calculator with the model index on desktop viewports', () => {
    const rules = Array.from(testStyles.sheet?.cssRules ?? [])
      .filter((rule) => 'conditionText' in rule && (rule as CSSMediaRule).conditionText === '(min-width: 951px)')
      .flatMap((rule) => Array.from((rule as CSSMediaRule).cssRules))
    const findRule = (selector: string) => rules.find((rule) =>
      'selectorText' in rule && (rule as CSSStyleRule).selectorText === selector,
    ) as CSSStyleRule | undefined

    const sectionRule = findRule('.home-main > .calculator-section')

    expect(sectionRule?.style.maxHeight).toBe('none')
    expect(sectionRule?.style.overflow).toBe('hidden')
    expect(sectionRule?.style.alignSelf).toBe('stretch')
    expect(findRule('.home-main > .calculator-section .calculator-grid')?.style.overflow).toBe('hidden')
    expect(findRule('.home-main > .calculator-section .controls-panel')?.style.paddingTop).toBe('15px')
    expect(findRule('.home-main > .calculator-section .control-block')?.style.marginBottom).toBe('11px')
    expect(findRule('.home-main > .calculator-section .total-number')?.style.marginTop).toBe('13px')
    expect(findRule('.home-main > .calculator-section .total-number')?.style.marginBottom).toBe('10px')
    expect(findRule('.home-main > .calculator-section .result-model')?.style.marginTop).toBe('18px')
    expect(findRule('.home-main > .calculator-section .estimate-note')?.style.marginTop).toBe('auto')
    expect(findRule('.home-main > .calculator-section .estimate-note')?.style.paddingTop).toBe('14px')
  })

  it('keeps the homepage disclaimer concise', () => {
    render(<App />)

    const calculator = screen.getByRole('region', { name: 'VRAM calculator' })
    expect(within(calculator).getByText('Includes weights, KV cache, and runtime allowance. Actual use varies by engine and GPU offload.')).toBeInTheDocument()
    expect(calculator).not.toHaveTextContent('10% workspace')
    expect(calculator).not.toHaveTextContent('0.5 GiB base runtime allowance')
  })

  it('keeps the homepage memory bar close to the total on narrow viewports', () => {
    const rules = Array.from(testStyles.sheet?.cssRules ?? [])
      .filter((rule) => 'conditionText' in rule && (rule as CSSMediaRule).conditionText === '(max-width: 620px)')
      .flatMap((rule) => Array.from((rule as CSSMediaRule).cssRules))
    const totalRule = rules.find((rule) =>
      'selectorText' in rule
      && (rule as CSSStyleRule).selectorText === '.home-main > .calculator-section .total-number',
    ) as CSSStyleRule | undefined

    expect(totalRule?.style.marginTop).toBe('22px')
    expect(totalRule?.style.marginBottom).toBe('12px')
  })

  it('keeps model weights green before the risk overlay activates', () => {
    const weightsRule = Array.from(testStyles.sheet?.cssRules ?? []).find((rule) =>
      'selectorText' in rule && (rule as CSSStyleRule).selectorText === '.weights',
    ) as CSSStyleRule | undefined

    expect(weightsRule?.style.background).toBe('var(--acid)')
  })

  it('layers the same warning and offload colors on the model weight bar and swatch', () => {
    const rules = Array.from(testStyles.sheet?.cssRules ?? [])
    const findRule = (selector: string) => rules.find((rule) =>
      'selectorText' in rule && (rule as CSSStyleRule).selectorText === selector,
    ) as CSSStyleRule | undefined

    const barOffload = findRule('.memory-bar-used > .weights::after')
    const barWarning = findRule('.memory-bar-risk')
    const swatchOffload = findRule('.breakdown-list i.weights::before')
    const swatchWarning = findRule('.breakdown-list i::after')

    expect(swatchOffload?.style.background).toBe(barOffload?.style.background)
    expect(swatchOffload?.style.opacity).toBe(barOffload?.style.opacity)
    expect(swatchWarning?.style.background).toBe(barWarning?.style.background)
    expect(swatchWarning?.style.opacity).toBe('var(--memory-risk-opacity, 0)')
    expect(Number(swatchOffload?.style.zIndex)).toBeGreaterThan(Number(swatchWarning?.style.zIndex))
  })

  it('uses the breakdown text size for the offload label', () => {
    const offloadRule = Array.from(testStyles.sheet?.cssRules ?? []).find((rule) =>
      'selectorText' in rule && (rule as CSSStyleRule).selectorText === '.memory-bar-offload',
    ) as CSSStyleRule | undefined
    const breakdownRule = Array.from(testStyles.sheet?.cssRules ?? []).find((rule) =>
      'selectorText' in rule && (rule as CSSStyleRule).selectorText === '.breakdown-list > div',
    ) as CSSStyleRule | undefined

    expect(offloadRule?.style.fontSize).toBe(breakdownRule?.style.fontSize)
  })

  it('labels memory that must be offloaded when usage exceeds VRAM', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '256K' }))
    await user.click(screen.getByRole('button', { name: 'Increase context window' }))

    expect(screen.getByRole('img', { name: /memory usage/i })).toHaveTextContent(/OFFLOAD\s+\d+\.\d+ GiB/)
  })

  it('applies the risk and offload tints directly to the compact memory bar', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Your VRAM' }), '16')
    await user.click(screen.getByRole('button', { name: '256K' }))
    const chart = screen.getByRole('img', { name: /memory usage/i })
    const used = chart.querySelector('.memory-bar-used') as HTMLElement
    const risk = chart.querySelector('.memory-bar-risk') as HTMLElement

    expect(risk.style.opacity).toBe('0.9')
    expect(used.style.getPropertyValue('--memory-weights-offload-opacity')).toBe('0.9')
    expect(chart.closest('.result-panel')?.querySelector('.breakdown-list')).not.toBeInTheDocument()
  })

  it('recalculates and writes a shareable URL when the selected model changes', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Model' }), 'minicpm5-1b')

    expect(screen.getAllByText('MiniCPM5 1B').length).toBeGreaterThan(0)
    expect(window.location.search).toContain('model=minicpm5-1b')
  })

  it('updates the calculator when a curated model rectangle is selected', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Select MiniCPM5 1B' }))

    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('minicpm5-1b')
    expect(within(screen.getByRole('region', { name: 'VRAM calculator' }))
      .getByText('MiniCPM5 1B', { selector: '.result-model strong' })).toBeInTheDocument()
  })

  it('opens SIZE IT in a new tab on the selected model page', () => {
    render(<App />)

    expect(screen.getByRole('link', { name: 'Size MiniCPM5 1B (opens in new tab)' }))
      .toHaveAttribute('href', '/openbmb/MiniCPM5-1B')
    expect(screen.getByRole('link', { name: 'Size MiniCPM5 1B (opens in new tab)' }))
      .toHaveAttribute('target', '_blank')
  })

  it('reserves /compare for the comparison workspace and exposes compare entry links', () => {
    window.history.replaceState(null, '', '/compare')
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Compare models' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Model VRAM calculator' })).not.toBeInTheDocument()

    window.history.replaceState(null, '', '/')
    render(<App />)
    expect(screen.getByRole('link', { name: 'Compare MiniCPM5 1B' })).toHaveAttribute('href', expect.stringContaining('/compare?compare=1'))
  })

  it('does not search while the user is still typing', async () => {
    const user = userEvent.setup()
    const fetcher = vi.spyOn(globalThis, 'fetch')
    render(<App />)

    await user.type(screen.getByRole('searchbox', { name: 'Search Hugging Face models' }), 'QWEN')

    expect(fetcher).not.toHaveBeenCalled()
    expect(within(screen.getByRole('region', { name: 'Model catalog' })).getByText('MiniCPM5 1B')).toBeInTheDocument()
    fetcher.mockRestore()
  })

  it('places model search at the top of the explorer and keeps the curated index separate', () => {
    render(<App />)

    const searchRegion = screen.getByRole('region', { name: 'Hugging Face model search' })
    expect(searchRegion).toContainElement(screen.getByRole('searchbox', { name: 'Search Hugging Face models' }))
    expect(searchRegion.closest('[aria-label="Model search explorer"]')).not.toBeNull()
    expect(searchRegion.closest('.hero')).toBeNull()
    expect(within(screen.getByRole('region', { name: 'Model catalog' })).getByText('MiniCPM5 1B')).toBeInTheDocument()
  })

  it('searches on Enter and links each result to its sizeof.ai model page', async () => {
    const user = userEvent.setup()
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      query: 'QWEN',
      nextCursor: null,
      models: [{
        id: 'Qwen/Qwen3.8-27B', owner: 'Qwen', name: 'Qwen3.8-27B',
        downloads: 2_090_699, likes: 12_025, task: 'image-text-to-text',
        trendingScore: 2_236, gated: false,
      }],
    }))
    render(<App />)

    await user.type(screen.getByRole('searchbox', { name: 'Search Hugging Face models' }), 'QWEN{enter}')

    expect(fetcher).toHaveBeenCalledWith('/api/search/models?q=QWEN')
    expect(await screen.findByRole('link', { name: 'Open Qwen/Qwen3.8-27B' })).toHaveAttribute(
      'href',
      '/Qwen/Qwen3.8-27B',
    )
    fetcher.mockRestore()
  })

  it('labels live search rows conservatively without another model request', async () => {
    const user = userEvent.setup()
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      query: 'QWEN', nextCursor: null, models: [
        { id: 'Qwen/Text', owner: 'Qwen', name: 'Text', downloads: 1, likes: 1, task: 'text-generation', trendingScore: 1, gated: false },
        { id: 'Lab/Image', owner: 'Lab', name: 'Image', downloads: 1, likes: 1, task: 'text-to-image', trendingScore: 1, gated: false },
        { id: 'Gated/Model', owner: 'Gated', name: 'Model', downloads: 1, likes: 1, task: null, trendingScore: 1, gated: true },
      ],
    }))
    render(<App />)

    await user.type(screen.getByRole('searchbox', { name: 'Search Hugging Face models' }), 'QWEN{enter}')

    const results = await screen.findByRole('region', { name: 'Hugging Face search results' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    fetcher.mockRestore()
    expect(within(results).getByText('CHECK ON OPEN')).toBeInTheDocument()
    expect(within(results).getByText('RESOURCE PROFILE')).toBeInTheDocument()
    expect(within(results).getAllByText('GATED')).toHaveLength(2)
    expect(within(results).getAllByRole('link', { name: /^Compare / })).toHaveLength(3)
  })

  it('maps all existing language, vision, image, and audio task families without extra fetches', async () => {
    const user = userEvent.setup()
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ query: 'TASK', nextCursor: null, models: [
      { id: 'Org/Text2Text', owner: 'Org', name: 'Text2Text', downloads: 1, likes: 1, task: 'text2text-generation', trendingScore: 1, gated: false },
      { id: 'Org/Chat', owner: 'Org', name: 'Chat', downloads: 1, likes: 1, task: 'conversational', trendingScore: 1, gated: false },
      { id: 'Org/QA', owner: 'Org', name: 'QA', downloads: 1, likes: 1, task: 'question-answering', trendingScore: 1, gated: false },
      { id: 'Org/VQA', owner: 'Org', name: 'VQA', downloads: 1, likes: 1, task: 'visual-question-answering', trendingScore: 1, gated: false },
      { id: 'Org/Image', owner: 'Org', name: 'Image', downloads: 1, likes: 1, task: 'image-to-image', trendingScore: 1, gated: false },
      { id: 'Org/Audio', owner: 'Org', name: 'Audio', downloads: 1, likes: 1, task: 'audio-classification', trendingScore: 1, gated: false },
    ] }))
    render(<App />)
    await user.type(screen.getByRole('searchbox', { name: 'Search Hugging Face models' }), 'TASK{enter}')
    const results = await screen.findByRole('region', { name: 'Hugging Face search results' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    fetcher.mockRestore()
    expect(within(results).getAllByText('CHECK ON OPEN')).toHaveLength(4)
    expect(within(results).getAllByText('RESOURCE PROFILE')).toHaveLength(2)
  })

  it('submits model type and author filters only after Search is pressed', async () => {
    const user = userEvent.setup()
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      query: 'QWEN', nextCursor: null, models: [],
    }))
    render(<App />)

    await user.type(screen.getByRole('searchbox', { name: 'Search Hugging Face models' }), 'QWEN')
    await user.type(screen.getByRole('textbox', { name: 'Filter by author' }), 'Qwen')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by model type' }), 'text-generation')
    expect(fetcher).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Search Hugging Face' }))

    expect(fetcher).toHaveBeenCalledWith('/api/search/models?q=QWEN&author=Qwen&type=text-generation')
    fetcher.mockRestore()
  })

  it('loads another page, appends new models, and removes duplicate ids', async () => {
    const user = userEvent.setup()
    const first = {
      id: 'Qwen/Qwen3.8-27B', owner: 'Qwen', name: 'Qwen3.8-27B',
      downloads: 100, likes: 10, task: 'text-generation', trendingScore: 20, gated: false,
    }
    const second = {
      id: 'Qwen/Qwen3.8-9B', owner: 'Qwen', name: 'Qwen3.8-9B',
      downloads: 90, likes: 9, task: 'text-generation', trendingScore: 19, gated: false,
    }
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ query: 'QWEN', nextCursor: 'next-page==', models: [first] }))
      .mockResolvedValueOnce(Response.json({ query: 'QWEN', nextCursor: null, models: [first, second] }))
    render(<App />)

    await user.type(screen.getByRole('searchbox', { name: 'Search Hugging Face models' }), 'QWEN{enter}')
    await user.click(await screen.findByRole('button', { name: 'Load more models' }))

    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/search/models?q=QWEN&cursor=next-page%3D%3D')
    expect(await screen.findByRole('link', { name: 'Open Qwen/Qwen3.8-9B' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Open Qwen/Qwen3.8-27B' })).toHaveLength(1)
    fetcher.mockRestore()
  })

  it('reorders loaded pages so later exact and official matches move first', async () => {
    const user = userEvent.setup()
    const generic = {
      id: 'Community/QWEN-extra', owner: 'Community', name: 'QWEN-extra',
      downloads: 1000, likes: 100, task: 'text-generation', trendingScore: 100, gated: false,
    }
    const exact = {
      id: 'QWEN/QWEN', owner: 'QWEN', name: 'QWEN',
      downloads: 1, likes: 1, task: 'text-generation', trendingScore: 1, gated: false,
    }
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ query: 'QWEN', nextCursor: 'next-page==', models: [generic] }))
      .mockResolvedValueOnce(Response.json({ query: 'QWEN', nextCursor: null, models: [exact] }))
    render(<App />)

    await user.type(screen.getByRole('searchbox', { name: 'Search Hugging Face models' }), 'QWEN{enter}')
    await user.click(await screen.findByRole('button', { name: 'Load more models' }))

    const resultRegion = screen.getByRole('region', { name: 'Hugging Face search results' })
    const openLinks = within(resultRegion).getAllByRole('link', { name: /^Open / })
    expect(openLinks.map((link) => link.getAttribute('aria-label'))).toEqual([
      'Open QWEN/QWEN',
      'Open Community/QWEN-extra',
    ])
    fetcher.mockRestore()
  })

  it('blocks a new search while another page is loading', async () => {
    const user = userEvent.setup()
    let finishPage: ((response: Response) => void) | undefined
    const pendingPage = new Promise<Response>((resolve) => { finishPage = resolve })
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ query: 'QWEN', nextCursor: 'next-page==', models: [] }))
      .mockReturnValueOnce(pendingPage)
    render(<App />)

    const searchbox = screen.getByRole('searchbox', { name: 'Search Hugging Face models' })
    await user.type(searchbox, 'QWEN{enter}')
    await user.click(await screen.findByRole('button', { name: 'Load more models' }))
    expect(screen.getByRole('button', { name: 'Search Hugging Face' })).toBeDisabled()
    await user.clear(searchbox)
    await user.type(searchbox, 'LLAMA{enter}')
    expect(fetcher).toHaveBeenCalledTimes(2)

    finishPage?.(Response.json({ query: 'QWEN', nextCursor: null, models: [] }))
    fetcher.mockRestore()
  })

  it('searches when the user clicks the search button', async () => {
    const user = userEvent.setup()
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      query: 'QWEN',
      models: [],
    }))
    render(<App />)

    await user.type(screen.getByRole('searchbox', { name: 'Search Hugging Face models' }), 'QWEN')
    await user.click(screen.getByRole('button', { name: 'Search Hugging Face' }))

    expect(fetcher).toHaveBeenCalledWith('/api/search/models?q=QWEN')
    expect(await screen.findByText('No Hugging Face models matched “QWEN”.')).toBeInTheDocument()
    fetcher.mockRestore()
  })

  it('keeps the curated catalog visible when Hugging Face search fails', async () => {
    const user = userEvent.setup()
    const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    render(<App />)

    await user.type(screen.getByRole('searchbox', { name: 'Search Hugging Face models' }), 'QWEN{enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent('curated model index is unchanged')
    expect(within(screen.getByRole('region', { name: 'Model catalog' })).getByText('MiniCPM5 1B')).toBeInTheDocument()
    fetcher.mockRestore()
  })

  it('describes KV sizing for hybrid-attention models', () => {
    render(<App />)

    expect(screen.getByText(/KV-bearing attention layers × KV heads/i)).toBeInTheDocument()
    expect(screen.getByText(/hybrid state buffers vary by engine/i)).toBeInTheDocument()
  })

  it('explains the Hugging Face domain replacement shortcut', () => {
    render(<App />)

    expect(screen.getByText('huggingface.co/Qwen/Qwen3.8-27B')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /try the model detail page/i })).toHaveAttribute(
      'href',
      '/Qwen/Qwen3.8-27B',
    )
  })
})
