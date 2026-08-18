import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'

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
})
