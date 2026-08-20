import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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

  it('opens with a useful default estimate and transparent breakdown', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: /know what fits/i })).toBeInTheDocument()
    expect(screen.getAllByText('Llama 3.1 8B').length).toBeGreaterThan(0)
    expect(screen.getByText('Model weights')).toBeInTheDocument()
    expect(screen.getAllByText('KV cache').length).toBeGreaterThan(0)
    expect(screen.getByText('Runtime buffer')).toBeInTheDocument()
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

    const chart = screen.getByRole('img', { name: /memory usage/i })
    const used = chart.querySelector('.memory-bar-used') as HTMLElement
    const remaining = chart.querySelector('.memory-bar-remaining') as HTMLElement

    expect(used).toBeInTheDocument()
    expect(remaining).toBeInTheDocument()
    expect(used.style.width).toMatch(/%$/)
    expect(remaining.style.width).toMatch(/%$/)
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

  it('applies the bar risk tint to the matching breakdown color swatches', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '256K' }))
    const chart = screen.getByRole('img', { name: /memory usage/i })
    const used = chart.querySelector('.memory-bar-used') as HTMLElement
    const breakdown = chart.closest('.result-panel')?.querySelector('.breakdown-list') as HTMLElement

    expect(breakdown.style.getPropertyValue('--memory-risk-opacity')).toBe('0.9')
    expect(used.style.getPropertyValue('--memory-weights-offload-opacity')).toBe('0.9')
    expect(breakdown.style.getPropertyValue('--memory-weights-offload-opacity')).toBe('0.9')
    expect(breakdown.querySelectorAll('i')).toHaveLength(3)
  })

  it('recalculates and writes a shareable URL when the selected model changes', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Model' }), 'qwen3-14b')

    expect(screen.getAllByText('Qwen3 14B').length).toBeGreaterThan(0)
    expect(window.location.search).toContain('model=qwen3-14b')
  })

  it('filters the catalog by maker, family, or strength', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByRole('searchbox', { name: 'Search model catalog' }), 'microsoft')
    const catalog = screen.getByRole('region', { name: 'Model catalog' })

    expect(within(catalog).getByText('Phi-4 14B')).toBeInTheDocument()
    expect(within(catalog).queryByText('Qwen3 8B')).not.toBeInTheDocument()
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
