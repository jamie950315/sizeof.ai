import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { curatedHuggingFaceResourceProfiles } from './data/huggingface-resource-profiles'

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
  modelKind: 'vision-language',
  tensorSizeBytes: null,
  repositorySizeBytes: null,
  estimateReason: null,
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
    const calculator = screen.getByRole('region', { name: 'Model VRAM calculator' })
    expect(within(calculator).getAllByRole('button').map((button) => button.textContent)).toEqual(expect.arrayContaining([
      '16bit', '8bit', '6bit', '5bit', '4bit', '3bit', '2bit', '1bit',
    ]))
    expect(within(calculator).queryByRole('button', { name: 'FP16' })).not.toBeInTheDocument()
    expect(within(calculator).queryByRole('button', { name: 'Q4_K_M' })).not.toBeInTheDocument()
    expect(within(calculator).getByRole('button', { name: '4K' })).toBeInTheDocument()
    expect(within(calculator).getByRole('button', { name: '16K' })).toBeInTheDocument()
    expect(within(calculator).getByRole('button', { name: '64K' })).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/models/Qwen/Qwen3.8-27B?schema=12')
  })

  it('keeps the detail context spinner aligned and charts usage against selected VRAM', async () => {
    const user = userEvent.setup()
    render(<App />)

    const calculator = await screen.findByRole('region', { name: 'Model VRAM calculator' })
    const input = within(calculator).getByRole('spinbutton', { name: 'Context window' }) as HTMLInputElement

    expect(input).toHaveAttribute('min', '1024')
    expect(input).toHaveAttribute('step', '1')
    await user.click(within(calculator).getByRole('button', { name: '4K' }))
    await user.click(within(calculator).getByRole('button', { name: 'Decrease context window' }))
    expect(input).toHaveValue(3072)
    await user.click(within(calculator).getByRole('button', { name: 'Decrease context window' }))
    expect(input).toHaveValue(2048)
    await user.click(within(calculator).getByRole('button', { name: '4K' }))
    await user.click(within(calculator).getByRole('button', { name: 'Increase context window' }))
    expect(input).toHaveValue(6144)
    await user.click(within(calculator).getByRole('button', { name: 'Increase context window' }))
    expect(input).toHaveValue(8192)

    await user.click(within(calculator).getByRole('button', { name: '4K' }))
    await user.click(within(calculator).getByRole('button', { name: 'Decrease context window' }))
    await user.click(within(calculator).getByRole('button', { name: 'Increase context window' }))
    expect(input).toHaveValue(4096)
    await user.click(within(calculator).getByRole('button', { name: '4K' }))
    await user.click(within(calculator).getByRole('button', { name: 'Increase context window' }))
    await user.click(within(calculator).getByRole('button', { name: 'Decrease context window' }))
    expect(input).toHaveValue(4096)

    const chart = within(calculator).getByRole('img', { name: /memory usage/i })
    const used = chart.querySelector('.memory-bar-used') as HTMLElement
    const remaining = chart.querySelector('.memory-bar-remaining') as HTMLElement
    expect(used).toBeInTheDocument()
    expect(remaining).toBeInTheDocument()
    expect(used.style.width).toMatch(/%$/)
    expect(remaining.style.width).toMatch(/%$/)

    await user.click(within(calculator).getByRole('button', { name: '256K' }))
    await user.click(within(calculator).getByRole('button', { name: 'Increase context window' }))
    expect(within(calculator).getByRole('img', { name: /memory usage/i })).toHaveTextContent(/OFFLOAD\s+\d+\.\d+ GiB/)
    const breakdown = within(calculator).getByRole('img', { name: /memory usage/i }).closest('.result-panel')?.querySelector('.breakdown-list') as HTMLElement
    expect(breakdown.style.getPropertyValue('--memory-risk-opacity')).toBe('0.9')
    expect(used.style.getPropertyValue('--memory-weights-offload-opacity')).toBe('0.9')
    expect(breakdown.style.getPropertyValue('--memory-weights-offload-opacity')).toBe('0.9')
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
    expect(screen.getByText('HYPOTHETICAL BIT/WEIGHT ESTIMATE')).toBeInTheDocument()
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

  it('shows a modality-aware resource profile when an LLM estimate is unsafe', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...apiModel,
      id: 'black-forest-labs/FLUX.1-dev',
      owner: 'black-forest-labs',
      name: 'FLUX.1-dev',
      parametersB: 11.90140832,
      pipelineTag: 'text-to-image',
      libraryName: 'diffusers',
      modelKind: 'image',
      tensorSizeBytes: 23_802_816_640,
      repositorySizeBytes: 69_256_397_749,
      estimateReason: 'modality-specific',
      architecture: 'FluxTransformer2DModel',
      modelType: 'flux',
      spec: null,
      sourceUrl: 'https://huggingface.co/black-forest-labs/FLUX.1-dev',
    })))

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'FLUX.1-dev' })).toBeInTheDocument()
    const profile = screen.getByRole('region', { name: 'Resource profile' })
    expect(within(profile).getByText('IMAGE')).toBeInTheDocument()
    expect(within(profile).getByText('22.17 GiB')).toBeInTheDocument()
    expect(within(profile).getByText('64.50 GiB')).toBeInTheDocument()
    expect(screen.getByText(/modality-specific runtime memory/i)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Model VRAM calculator' })).not.toBeInTheDocument()
  })

  it('shows an encoder load estimate without context or KV-cache controls', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...apiModel,
      id: 'LiquidAI/LFM2.5-Encoder-350M',
      owner: 'LiquidAI',
      name: 'LFM2.5-Encoder-350M',
      pipelineTag: 'fill-mask',
      modelKind: 'embedding',
      tensorSizeBytes: 708_967_936,
      estimateReason: 'encoder-model',
      layers: 16,
      attentionLayers: 6,
      maxContext: 128_000,
      spec: null,
      resourceEstimate: {
        kind: 'encoder',
        title: 'Encoder loaded weights',
        description: 'Static model weights for this bidirectional encoder. It does not use an autoregressive KV cache.',
        note: 'This is published model-weight residency only. Batch size, sequence length, and framework activations add runtime memory.',
        baseModelId: null,
        options: [{
          id: 'published-weights',
          label: 'Encoder weights',
          components: [{ id: 'encoder-weights', label: 'Encoder weights', sizeBytes: 708_967_936 }],
        }],
      },
    })))

    render(<App />)

    const estimate = await screen.findByRole('region', { name: 'Model load estimate' })
    expect(within(estimate).getByRole('heading', { name: 'Encoder loaded weights.' })).toBeInTheDocument()
    expect(within(estimate).getByText('0.66 GiB', { selector: '.resource-total' })).toBeInTheDocument()
    expect(within(estimate).getByText(/does not use an autoregressive KV cache/i)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Model VRAM calculator' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Context window')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('KV cache precision')).not.toBeInTheDocument()
    expect(screen.queryByText('NATIVE CONTEXT')).not.toBeInTheDocument()
    expect(screen.queryByText('Full attention layers')).not.toBeInTheDocument()
    expect(screen.queryByText('KV HEADS / HEAD DIM')).not.toBeInTheDocument()
  })

  it('shows a selectable complete video pipeline without treating Base and Distillation as one load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...apiModel,
      id: 'Wan-AI/Wan2.2-Animate-2-14B',
      owner: 'Wan-AI',
      name: 'Wan2.2-Animate-2-14B',
      pipelineTag: 'text-to-video',
      modelKind: 'video',
      estimateReason: 'modality-specific',
      spec: null,
      resourceEstimate: curatedHuggingFaceResourceProfiles['Wan-AI/Wan2.2-Animate-2-14B']?.resourceEstimate,
    })))
    const user = userEvent.setup()

    render(<App />)

    const estimate = await screen.findByRole('region', { name: 'Model load estimate' })
    const selector = within(estimate).getByLabelText('Published weight set')
    expect(selector).toHaveValue('base-bf16')
    expect(within(estimate).getByText('46.29 GiB', { selector: '.resource-total' })).toBeInTheDocument()
    expect(within(estimate).getByText(/wan_animate_2_bf16\.safetensors/)).toBeInTheDocument()
    expect(within(estimate).getByText('NO KV CACHE')).toBeInTheDocument()

    await user.selectOptions(selector, 'distillation-bf16')

    expect(within(estimate).getByText(/wan_animate_2_bf16_distillation\.safetensors/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Context window')).not.toBeInTheDocument()
  })

  it('asks for an unknown workflow artifact classification instead of inventing a VRAM figure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...apiModel,
      id: 'Example/Unknown-Workflow',
      owner: 'Example',
      name: 'Unknown-Workflow',
      modelKind: 'workflow',
      tensorSizeBytes: null,
      repositorySizeBytes: 42_000_000,
      estimateReason: 'workflow-artifact',
      spec: null,
      resourceEstimate: null,
    })))

    render(<App />)

    const prompt = await screen.findByRole('region', { name: 'Artifact identification needed' })
    expect(within(prompt).getByRole('heading', { name: 'What is this artifact?' })).toBeInTheDocument()
    expect(within(prompt).getByText(/standalone model, VAE, adapter, or workflow component/i)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Model VRAM calculator' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Model load estimate' })).not.toBeInTheDocument()
  })

  it('keeps actual repository quantizations inside the calculator with context controls', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...apiModel,
      parameterCountKind: 'logical',
      addon: null,
      variants: [
        {
          id: 'q4', label: 'GGUF Q4_K_M', format: 'gguf', revision: 'sha1', path: 'q4.gguf',
          source: 'file', role: 'model', bitsPerWeight: 4, weightSizeBytes: 10 * 1024 ** 3,
          totalSizeBytes: 10.1 * 1024 ** 3,
        },
        {
          id: 'q8', label: 'GGUF Q8_0', format: 'gguf', revision: 'sha1', path: 'q8.gguf',
          source: 'file', role: 'model', bitsPerWeight: 8, weightSizeBytes: 20 * 1024 ** 3,
          totalSizeBytes: 20.1 * 1024 ** 3,
        },
      ],
    })))
    const user = userEvent.setup()

    render(<App />)

    const calculator = await screen.findByRole('region', { name: 'Model VRAM calculator' })
    expect(screen.queryByRole('region', { name: 'Detected model variants' })).not.toBeInTheDocument()
    const sources = within(calculator).getByRole('tablist', { name: 'Weight source' })
    expect(within(sources).getByRole('tab', { name: 'Estimated' })).toHaveAttribute('aria-selected', 'true')
    await user.click(within(sources).getByRole('tab', { name: 'Qwen' }))
    expect(within(calculator).getByRole('button', { name: /Q4_K_M.*10\.00 GiB/i })).toHaveClass('active')
    expect(within(calculator).getByText('10.00 GiB', { selector: 'strong' })).toBeInTheDocument()

    await user.click(within(calculator).getByRole('button', { name: '32K' }))
    await user.click(within(calculator).getByRole('button', { name: /Q8_0.*20\.00 GiB/i }))

    expect(within(calculator).getByLabelText('Context window')).toHaveValue(32768)
    expect(within(calculator).getByRole('button', { name: /Q8_0.*20\.00 GiB/i })).toHaveClass('active')
    expect(within(calculator).getByText('20.00 GiB', { selector: 'strong' })).toBeInTheDocument()
  })

  it('defaults to estimated sizing and switches between trusted publisher tabs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...apiModel,
      variants: [
        {
          id: 'community-iq1', label: 'GGUF IQ1_M', format: 'gguf', revision: 'sha1', path: 'iq1.gguf',
          source: 'file', role: 'model', bitsPerWeight: 1, weightSizeBytes: 5 * 1024 ** 3,
          totalSizeBytes: 5.1 * 1024 ** 3, provenance: 'community', publisher: 'unsloth',
          repositoryId: 'unsloth/Qwen3.8-27B-GGUF',
          sourceUrl: 'https://huggingface.co/unsloth/Qwen3.8-27B-GGUF',
        },
        {
          id: 'bartowski-q4', label: 'GGUF Q4_K_M', format: 'gguf', revision: 'sha2', path: 'q4.gguf',
          source: 'file', role: 'model', bitsPerWeight: 4, weightSizeBytes: 11 * 1024 ** 3,
          totalSizeBytes: 11.1 * 1024 ** 3, provenance: 'community', publisher: 'bartowski',
          repositoryId: 'bartowski/Qwen3.8-27B-GGUF',
          sourceUrl: 'https://huggingface.co/bartowski/Qwen3.8-27B-GGUF',
        },
        {
          id: 'lmstudio-q4', label: 'GGUF Q4_K_M', format: 'gguf', revision: 'sha5', path: 'q4.gguf',
          source: 'file', role: 'model', bitsPerWeight: 4, weightSizeBytes: 10.5 * 1024 ** 3,
          totalSizeBytes: 10.6 * 1024 ** 3, provenance: 'community', publisher: 'lmstudio-community',
          repositoryId: 'lmstudio-community/Qwen3.8-27B-GGUF',
          sourceUrl: 'https://huggingface.co/lmstudio-community/Qwen3.8-27B-GGUF',
        },
        {
          id: 'community-q2', label: 'GGUF Q2_K', format: 'gguf', revision: 'sha1', path: 'q2.gguf',
          source: 'file', role: 'model', bitsPerWeight: 2, weightSizeBytes: 6 * 1024 ** 3,
          totalSizeBytes: 6.1 * 1024 ** 3, provenance: 'community', publisher: 'unsloth',
          repositoryId: 'unsloth/Qwen3.8-27B-GGUF',
          sourceUrl: 'https://huggingface.co/unsloth/Qwen3.8-27B-GGUF',
        },
        {
          id: 'community-q4', label: 'GGUF Q4_K_M', format: 'gguf', revision: 'sha1', path: 'q4.gguf',
          source: 'file', role: 'model', bitsPerWeight: 4, weightSizeBytes: 10 * 1024 ** 3,
          totalSizeBytes: 10.1 * 1024 ** 3, provenance: 'community', publisher: 'unsloth',
          repositoryId: 'unsloth/Qwen3.8-27B-GGUF',
          sourceUrl: 'https://huggingface.co/unsloth/Qwen3.8-27B-GGUF',
        },
        {
          id: 'community-q4s', label: 'GGUF Q4_K_S', format: 'gguf', revision: 'sha1', path: 'q4s.gguf',
          source: 'file', role: 'model', bitsPerWeight: 4, weightSizeBytes: 9 * 1024 ** 3,
          totalSizeBytes: 9.1 * 1024 ** 3, provenance: 'community', publisher: 'unsloth',
          repositoryId: 'unsloth/Qwen3.8-27B-GGUF',
          sourceUrl: 'https://huggingface.co/unsloth/Qwen3.8-27B-GGUF',
        },
        {
          id: 'mlx-4bit', label: 'MLX main', format: 'mlx', revision: 'sha3', path: 'model.safetensors',
          source: 'file', role: 'model', bitsPerWeight: null, weightSizeBytes: 8 * 1024 ** 3,
          totalSizeBytes: 8.1 * 1024 ** 3, provenance: 'community', publisher: 'mlx-community',
          repositoryId: 'mlx-community/Qwen3.8-27B-4bit',
          sourceUrl: 'https://huggingface.co/mlx-community/Qwen3.8-27B-4bit',
        },
        {
          id: 'mlx-optiq-4bit', label: 'MLX main', format: 'mlx', revision: 'sha4', path: 'model.safetensors',
          source: 'file', role: 'model', bitsPerWeight: null, weightSizeBytes: 7.5 * 1024 ** 3,
          totalSizeBytes: 7.6 * 1024 ** 3, provenance: 'community', publisher: 'mlx-community',
          repositoryId: 'mlx-community/Qwen3.8-27B-OptiQ-4bit',
          sourceUrl: 'https://huggingface.co/mlx-community/Qwen3.8-27B-OptiQ-4bit',
        },
        {
          id: 'mlx-optiq-directory', label: 'MLX optiq', format: 'mlx', revision: 'sha4', path: 'optiq',
          source: 'directory', role: 'model', bitsPerWeight: null, weightSizeBytes: 1.2 * 1024 ** 3,
          totalSizeBytes: 1.21 * 1024 ** 3, provenance: 'community', publisher: 'mlx-community',
          repositoryId: 'mlx-community/Qwen3.8-27B-OptiQ-4bit',
          sourceUrl: 'https://huggingface.co/mlx-community/Qwen3.8-27B-OptiQ-4bit',
        },
      ],
    })))
    const user = userEvent.setup()

    render(<App />)

    const calculator = await screen.findByRole('region', { name: 'Model VRAM calculator' })
    expect(screen.queryByRole('region', { name: 'Detected model variants' })).not.toBeInTheDocument()
    const sources = within(calculator).getByRole('tablist', { name: 'Weight source' })
    expect(within(sources).getByRole('tab', { name: 'Estimated' })).toHaveAttribute('aria-selected', 'true')
    expect(within(sources).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Estimated', 'Unsloth', 'LM Studio Community', 'mlx-community', 'Bartowski',
    ])
    expect(within(calculator).queryByRole('region', { name: 'Available community quantizations' })).not.toBeInTheDocument()
    expect(within(calculator).getByText('15.69 GiB', { selector: 'strong' })).toBeInTheDocument()

    await user.click(within(sources).getByRole('tab', { name: 'Unsloth' }))

    const quantizations = within(calculator).getByRole('region', { name: 'Available community quantizations' })
    expect(within(quantizations).getByText('1-bit')).toBeInTheDocument()
    expect(within(quantizations).getByText('2-bit')).toBeInTheDocument()
    expect(within(quantizations).getByText('4-bit')).toBeInTheDocument()
    expect(within(quantizations).getByRole('button', { name: /IQ1_M.*5\.00 GiB/i })).toBeInTheDocument()
    expect(within(quantizations).getByRole('button', { name: /Q4_K_S.*9\.00 GiB/i })).toBeInTheDocument()
    expect(within(calculator).getByRole('button', { name: /Q4_K_M.*10\.00 GiB/i })).toHaveClass('active')
    expect(within(calculator).getByText(/COMMUNITY ARTIFACT \/ UNSLOTH/i)).toBeInTheDocument()
    expect(within(calculator).getByRole('link', { name: /unsloth\/Qwen3\.8-27B-GGUF/i })).toHaveAttribute(
      'href',
      'https://huggingface.co/unsloth/Qwen3.8-27B-GGUF',
    )
    expect(within(calculator).getByText(/Uses the published/i)).toBeInTheDocument()

    await user.click(within(calculator).getByRole('button', { name: '32K' }))
    await user.click(within(quantizations).getByRole('button', { name: /Q4_K_S.*9\.00 GiB/i }))

    expect(within(calculator).getByLabelText('Context window')).toHaveValue(32768)
    expect(within(quantizations).getByRole('button', { name: /Q4_K_S.*9\.00 GiB/i })).toHaveClass('active')
    expect(within(calculator).getByText('9.00 GiB', { selector: 'strong' })).toBeInTheDocument()

    await user.click(within(sources).getByRole('tab', { name: 'Bartowski' }))

    expect(within(calculator).getByText(/COMMUNITY ARTIFACT \/ BARTOWSKI/i)).toBeInTheDocument()
    expect(within(calculator).getByText('11.00 GiB', { selector: 'strong' })).toBeInTheDocument()

    await user.click(within(sources).getByRole('tab', { name: 'mlx-community' }))

    const mlxQuantizations = within(calculator).getByRole('region', { name: 'Available community quantizations' })
    expect(within(mlxQuantizations).getByText('4-bit')).toBeInTheDocument()
    expect(within(mlxQuantizations).getByRole('button', { name: /MLX 4-bit.*8\.00 GiB/i })).toBeInTheDocument()
    expect(within(mlxQuantizations).getByRole('button', { name: /MLX OptiQ 4-bit.*7\.50 GiB/i })).toBeInTheDocument()
    expect(within(mlxQuantizations).getByRole('button', { name: /MLX OptiQ 4-bit · optiq.*1\.20 GiB/i })).toBeInTheDocument()
  })

  it('labels bit-per-weight sizing as hypothetical when no artifact exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...apiModel, variants: [] })))

    render(<App />)

    const calculator = await screen.findByRole('region', { name: 'Model VRAM calculator' })
    expect(within(calculator).getByText('HYPOTHETICAL BIT/WEIGHT ESTIMATE')).toBeInTheDocument()
    expect(within(calculator).getByText(/No matching published quantized artifact was found/i)).toBeInTheDocument()
  })

  it('shows an MTP addon separately and adds it to base-model VRAM', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...apiModel,
      parameterCountKind: 'logical',
      variants: [{
        id: 'mtp', label: 'GGUF mtp-head', format: 'gguf', revision: 'sha1', path: 'mtp-head.gguf',
        source: 'file', role: 'addon', bitsPerWeight: null, weightSizeBytes: 512 * 1024 ** 2,
        totalSizeBytes: 512 * 1024 ** 2,
      }],
      addon: {
        kind: 'mtp', baseModelId: 'Qwen/Qwen3.8-27B', parametersB: 0.46,
        sizeBytes: 512 * 1024 ** 2,
      },
    })))

    render(<App />)

    const variants = await screen.findByRole('region', { name: 'Detected model variants' })
    expect(within(variants).getByText('BASE MODEL / Qwen/Qwen3.8-27B')).toBeInTheDocument()
    expect(within(variants).queryByText('SUPPORT ARTIFACTS')).not.toBeInTheDocument()

    const calculator = screen.getByRole('region', { name: 'Model VRAM calculator' })
    const addonLabel = within(calculator).getByText('MTP addon')
    expect(addonLabel.parentElement).toHaveTextContent('0.50 GiB')
  })
})
