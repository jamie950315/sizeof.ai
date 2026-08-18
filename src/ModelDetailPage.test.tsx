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
    expect(fetch).toHaveBeenCalledWith('/api/models/Qwen/Qwen3.8-27B?schema=4')
  })

  it('shows a useful model-not-found state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Model not found' }, { status: 404 })))
    render(<App />)

    expect(await screen.findByRole('heading', { name: /model not found/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to sizeof.ai/i })).toHaveAttribute('href', '/')
  })

  it('shows engine-aware MLA sizing without hiding known model facts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...apiModel,
      id: 'moonshotai/Kimi-K3',
      owner: 'moonshotai',
      name: 'Kimi-K3',
      parametersB: 2779.931837184,
      license: 'kimi-k3',
      architecture: 'KimiK3ForConditionalGeneration',
      modelType: 'kimi_k3',
      layers: 93,
      attentionLayers: 24,
      maxContext: 1_048_576,
      quantizationFormat: 'mxfp4-pack-quantized',
      sourceUrl: 'https://huggingface.co/moonshotai/Kimi-K3',
      spec: {
        ...apiModel.spec,
        id: 'hf-moonshotai-kimi-k3',
        name: 'Kimi-K3',
        parametersB: 2779.931837184,
        layers: 93,
        attentionLayers: 24,
        maxContext: 1_048_576,
        kvHeads: undefined,
        headDim: undefined,
        kvCache: {
          kind: 'mla', heads: 96, keyHeadDim: 192, valueHeadDim: 128,
          latentDim: 512, ropeDim: 64,
        },
      },
    })))

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Kimi-K3' })).toBeInTheDocument()
    expect(screen.getByText('2.78T')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Model facts' })).getByText('1M')).toBeInTheDocument()
    expect(screen.getByText('24 / 93')).toBeInTheDocument()
    expect(screen.getByLabelText('MLA cache layout')).toHaveValue('expanded')
    expect(screen.getByText('REPO QUANTIZATION / MXFP4-PACK-QUANTIZED')).toBeInTheDocument()
    expect(screen.getByText('HYPOTHETICAL GGUF')).toBeInTheDocument()
  })

  it('discloses when architecture comes from a quantized repository base model', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...apiModel,
      id: 'Lab/Qwen-GGUF',
      owner: 'Lab',
      name: 'Qwen-GGUF',
      quantizationFormat: 'gguf',
      configSourceId: 'Qwen/Qwen3.8-27B',
    })))

    render(<App />)

    expect(await screen.findByText(/ARCHITECTURE FROM Qwen\/Qwen3\.8-27B/)).toBeInTheDocument()
  })
})
