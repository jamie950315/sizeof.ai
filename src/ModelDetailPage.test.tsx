import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const apiModel = {
  id: 'Qwen/Qwen3.8-27B',
  owner: 'Qwen',
  name: 'Qwen3.8-27B',
  author: 'Qwen',
  parametersB: 27.781427952,
  downloads: 665513,
  likes: 10977,
  lastModified: '2026-08-14T15:00:01.000Z',
  pipelineTag: 'image-text-to-text',
  libraryName: 'transformers',
  license: 'apache-2.0',
  tags: ['transformers', 'safetensors', 'qwen3_5'],
  architecture: 'Qwen3_5ForConditionalGeneration',
  modelType: 'qwen3_5',
  sourceUrl: 'https://huggingface.co/Qwen/Qwen3.8-27B',
  spec: {
    id: 'hf-qwen-qwen3-8-27b',
    name: 'Qwen3.8-27B',
    family: 'qwen3_5',
    maker: 'Qwen',
    parametersB: 27.781427952,
    layers: 64,
    attentionLayers: 16,
    kvHeads: 4,
    headDim: 256,
    maxContext: 262144,
    releaseYear: 2026,
    strengths: ['image-text-to-text'],
    sourceUrl: 'https://huggingface.co/Qwen/Qwen3.8-27B',
  },
}

describe('Hugging Face-style model detail route', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/Qwen/Qwen3.8-27B')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(apiModel)))
  })

  afterEach(() => vi.unstubAllGlobals())

  it('loads model metadata and an architecture-aware VRAM calculator', async () => {
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Qwen3.8-27B' })).toBeInTheDocument()
    const facts = screen.getByRole('region', { name: 'Model facts' })
    expect(within(facts).getByText('27.78B')).toBeInTheDocument()
    expect(within(facts).getByText('262K')).toBeInTheDocument()
    expect(screen.getByText('16 / 64')).toBeInTheDocument()
    expect(screen.getByText('Full attention layers')).toBeInTheDocument()
    expect(screen.getByText('18.30')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/models/Qwen/Qwen3.8-27B?schema=1')
  })

  it('shows a useful model-not-found state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Model not found' }, { status: 404 })))
    render(<App />)

    expect(await screen.findByRole('heading', { name: /model not found/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to sizeof.ai/i })).toHaveAttribute('href', '/')
  })
})
