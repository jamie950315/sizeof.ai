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
    window.localStorage.clear()
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
    expect(fetch).toHaveBeenCalledWith('/api/models/Qwen/Qwen3.8-27B?schema=13')
  })

  it('organizes the model as a true three-panel tool with compact architecture rows', async () => {
    render(<App />)

    const navigation = await screen.findByRole('region', { name: 'Model navigation' })
    expect(within(navigation).getByRole('region', { name: 'Model facts' })).toBeInTheDocument()
    expect(within(navigation).getByRole('region', { name: 'Resource profile' })).toBeInTheDocument()

    const configuration = screen.getByRole('region', { name: 'Model configuration' })
    const architecture = within(configuration).getByRole('region', { name: 'Architecture assumptions' })
    expect(within(architecture).getByText('Architecture')).toBeInTheDocument()
    expect(within(architecture).getByText('Qwen3_5ForConditionalGeneration')).toBeInTheDocument()
    expect(architecture.querySelector('dl')).toBeInTheDocument()
    expect(architecture.querySelector('.architecture-grid')).not.toBeInTheDocument()

    expect(screen.getByRole('region', { name: 'Memory summary' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Model details' })).not.toBeInTheDocument()
  })

  it('defaults every model calculator to 32 GiB VRAM', async () => {
    render(<App />)

    const calculator = await screen.findByRole('region', { name: 'Model VRAM calculator' })
    expect(within(calculator).getByRole('combobox', { name: 'Your VRAM' })).toHaveValue('32')
    expect(within(calculator).getByText('COMFORTABLE ON 32 GB')).toBeInTheDocument()
  })

  it('offers workstation and multi-GPU VRAM capacities', async () => {
    render(<App />)

    const calculator = await screen.findByRole('region', { name: 'Model VRAM calculator' })
    const vram = within(calculator).getByRole('combobox', { name: 'Your VRAM' })
    expect(Array.from(vram.querySelectorAll('option'), (option) => option.value)).toEqual([
      '8', '12', '16', '24', '32', '36', '48', '64', '80', '96', '128', '192', '256', '384', '512',
    ])
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

    await user.selectOptions(within(calculator).getByRole('combobox', { name: 'Your VRAM' }), '16')
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

  it('shows MoE active routing facts without replacing resident total parameters', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...apiModel,
      id: 'Qwen/Qwen3.6-35B-A3B',
      name: 'Qwen3.6-35B-A3B',
      parametersB: 35.951822704,
      moe: {
        totalExperts: 256, routedExperts: null, sharedExperts: null,
        expertsPerToken: 8, activeParametersB: 3, denseLayers: null,
      },
      spec: { ...apiModel.spec, parametersB: 35.951822704 },
    })))

    render(<App />)

    const facts = await screen.findByRole('region', { name: 'Model facts' })
    expect(within(facts).getByText('TOTAL PARAMETERS')).toBeInTheDocument()
    expect(within(facts).getByText('35.95B')).toBeInTheDocument()
    expect(within(facts).getByText('ACTIVE PARAMETERS / TOKEN')).toBeInTheDocument()
    expect(within(facts).getByText('3.00B')).toBeInTheDocument()
    expect(screen.getByText('256 TOTAL / 8 ACTIVE')).toBeInTheDocument()
  })

  it('shows a verified DFlash target plus draft profile without calling it an encoder', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...apiModel,
      id: 'z-lab/Qwen3.6-35B-A3B-DFlash', owner: 'z-lab', name: 'Qwen3.6-35B-A3B-DFlash',
      parametersB: 0.385906176, modelKind: 'speculative-draft', componentKind: 'draft',
      estimateReason: 'speculative-draft', spec: null,
      speculative: {
        family: 'dflash', relation: 'separate-model',
        targetModelId: 'Qwen/Qwen3.6-35B-A3B', blockSize: 16,
      },
      resourceEstimate: {
        kind: 'speculative-draft', title: 'Target + speculative draft weights',
        description: 'Published target-model and draft-model weights required by this speculative decoding pair.',
        note: 'Target KV cache and draft runtime memory are excluded.',
        baseModelId: 'Qwen/Qwen3.6-35B-A3B',
        options: [{
          id: 'target-plus-draft', label: 'Target + draft weights', components: [
            { id: 'target-weights', label: 'Target model weights', sizeBytes: 71_903_645_408 },
            { id: 'draft-weights', label: 'Draft model weights', sizeBytes: 771_812_352 },
          ],
        }],
      },
    })))

    render(<App />)

    expect(await screen.findByText('SPECULATIVE DRAFT')).toBeInTheDocument()
    const estimate = screen.getByRole('region', { name: 'Model load estimate' })
    expect(within(estimate).getByText('TARGET + DRAFT WEIGHTS')).toBeInTheDocument()
    expect(within(estimate).getByText('CACHE + RUNTIME EXCLUDED')).toBeInTheDocument()
    expect(within(estimate).getByText('67.68 GiB', { selector: '.resource-total' })).toBeInTheDocument()
    expect(screen.getByText('DECLARED TARGET / Qwen/Qwen3.6-35B-A3B')).toBeInTheDocument()
    expect(screen.queryByText(/bidirectional encoder/i)).not.toBeInTheDocument()
  })

  it('labels KDA and other stateful hybrid estimates as runtime-specific lower bounds', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...apiModel,
      estimateConfidence: 'runtime-specific',
      attentionProfile: {
        fullLayers: 16, slidingLayers: 0, linearLayers: 0, kdaLayers: 48,
        recurrentLayers: 0, ssmLayers: 0, slidingWindow: null, stateKind: 'kda',
      },
      spec: {
        ...apiModel.spec,
        parametersB: 100,
        estimateConfidence: 'runtime-specific',
        attentionProfile: {
          fullLayers: 16, slidingLayers: 0, linearLayers: 0, kdaLayers: 48,
          recurrentLayers: 0, ssmLayers: 0, slidingWindow: null, stateKind: 'kda',
        },
      },
    })))

    render(<App />)

    const calculator = await screen.findByRole('region', { name: 'Model VRAM calculator' })
    expect(within(calculator).getByText('ESTIMATED LOWER BOUND')).toBeInTheDocument()
    expect(within(calculator).getByText('TOO LARGE ON 32 GB')).toHaveClass('too-large')
    expect(within(calculator).queryByText('RUNTIME-SPECIFIC')).not.toBeInTheDocument()
    expect(within(calculator).getByRole('img', { name: /modeled lower bound/i })).not.toHaveTextContent('OFFLOAD')
    expect(within(calculator).queryByText(/OFFLOAD/)).not.toBeInTheDocument()
    expect(screen.getByText('KDA / 48 STATE LAYERS')).toBeInTheDocument()
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
    const estimatedPanel = calculator.querySelector('[data-motion="quantization-panel"]')
    expect(estimatedPanel).toHaveAttribute('data-motion-source', 'estimated')
    expect(within(calculator).getByRole('img', { name: /memory usage/i })).toHaveAttribute('data-motion', 'memory-usage')

    await user.click(within(sources).getByRole('tab', { name: 'Unsloth' }))

    const quantizations = within(calculator).getByRole('region', { name: 'Available community quantizations' })
    expect(quantizations).toHaveAttribute('data-motion', 'quantization-panel')
    expect(quantizations).toHaveAttribute('data-motion-source', 'unsloth')
    expect(quantizations).not.toBe(estimatedPanel)
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

  it('restores safe calculator settings from the permanent detail URL after metadata loads', async () => {
    window.history.replaceState(null, '', '/Qwen/Qwen3.8-27B?state=1&quant=q8_0&ctx=16384&kv=q8_0&mla=latent&vram=64&source=untrusted&variant=unknown')

    render(<App />)

    const calculator = await screen.findByRole('region', { name: 'Model VRAM calculator' })
    expect(within(calculator).getByRole('button', { name: '8bit' })).toHaveClass('active')
    expect(within(calculator).getByLabelText('Context window')).toHaveValue(16384)
    expect(within(calculator).getByLabelText('KV cache precision')).toHaveValue('q8_0')
    expect(within(calculator).getByLabelText('Your VRAM')).toHaveValue('64')
    expect(within(calculator).queryByRole('tab', { name: 'untrusted' })).not.toBeInTheDocument()
  })

  it('loads a valid browser-only profile and applies its usable capacity', async () => {
    window.localStorage.setItem('sizeof:hardware-profile:v1', JSON.stringify({
      version: 1,
      profile: { kind: 'unified-memory', label: 'Local workstation', capacityGiB: 48, reservedGiB: 8 },
    }))

    render(<App />)

    const calculator = await screen.findByRole('region', { name: 'Model VRAM calculator' })
    expect(within(calculator).getByText('Local workstation: 48 GiB total, 8 GiB reserved.')).toBeInTheDocument()
    expect(within(calculator).getByLabelText('Your VRAM')).toHaveValue('40')
  })

  it('ignores malformed saved profiles and clears a saved profile on request', async () => {
    window.localStorage.setItem('sizeof:hardware-profile:v1', '{bad json')
    const user = userEvent.setup()
    render(<App />)

    const calculator = await screen.findByRole('region', { name: 'Model VRAM calculator' })
    expect(within(calculator).getByLabelText('Your VRAM')).toHaveValue('32')
    await user.clear(within(calculator).getByLabelText('Label'))
    await user.type(within(calculator).getByLabelText('Label'), 'Laptop')
    await user.clear(within(calculator).getByLabelText('Total memory (GiB)'))
    await user.type(within(calculator).getByLabelText('Total memory (GiB)'), '24')
    await user.clear(within(calculator).getByLabelText('Reserved memory (GiB)'))
    await user.type(within(calculator).getByLabelText('Reserved memory (GiB)'), '4')
    await user.click(within(calculator).getByRole('button', { name: 'Apply local profile' }))
    expect(window.localStorage.getItem('sizeof:hardware-profile:v1')).toContain('Laptop')
    await user.click(within(calculator).getByRole('button', { name: 'Clear profile' }))
    expect(window.localStorage.getItem('sizeof:hardware-profile:v1')).toBeNull()
  })

  it('discloses evidence and applies a deterministic fit suggestion', async () => {
    const user = userEvent.setup()
    render(<App />)

    const calculator = await screen.findByRole('region', { name: 'Model VRAM calculator' })
    const evidence = within(calculator).getByText(/Evidence: 1 verified, 2 derived, 0 unknown/i)
    await user.click(evidence)
    const evidenceList = within(calculator).getByRole('list', { name: 'Estimate evidence' })
    expect(within(evidenceList).getByText(/VERIFIED \/ Published model specification/)).toBeInTheDocument()
    expect(within(evidenceList).getAllByRole('link', { name: 'View source' })[0]).toHaveAttribute('rel', 'noreferrer')

    await user.selectOptions(within(calculator).getByLabelText('Your VRAM'), '16')
    const planner = within(calculator).getByRole('region', { name: 'Fit planner' })
    const suggestion = await within(planner).findByRole('button', { name: /Apply: Use q3_k_m weight precision/ })
    await user.click(suggestion)
    expect(within(calculator).getByRole('button', { name: '3bit' })).toHaveClass('active')
  })

  it('refuses precise fit guidance for lower-bound runtime-specific models', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...apiModel,
      estimateConfidence: 'runtime-specific',
      spec: { ...apiModel.spec, estimateConfidence: 'runtime-specific' },
    })))
    render(<App />)

    const planner = await screen.findByRole('region', { name: 'Fit planner' })
    expect(within(planner).getByText('This runtime-specific model cannot guarantee a precise fit.')).toBeInTheDocument()
  })

  it('replaces the permanent URL when each visible calculator setting changes', async () => {
    const user = userEvent.setup()
    render(<App />)

    const calculator = await screen.findByRole('region', { name: 'Model VRAM calculator' })
    await user.click(within(calculator).getByRole('button', { name: '8bit' }))
    await user.click(within(calculator).getByRole('button', { name: '4K' }))
    await user.selectOptions(within(calculator).getByLabelText('KV cache precision'), 'q8_0')
    await user.selectOptions(within(calculator).getByLabelText('Your VRAM'), '64')

    expect(window.location.search).toContain('quant=q8_0')
    expect(window.location.search).toContain('ctx=4096')
    expect(window.location.search).toContain('kv=q8_0')
    expect(window.location.search).toContain('vram=64')
    expect(window.location.search).toContain('source=estimated')
    expect(window.location.search).toContain('variant=none')
  })

  it('copies only a custom usable capacity URL that wins over but retains local profile metadata in a fresh browser', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    window.localStorage.setItem('sizeof:hardware-profile:v1', JSON.stringify({
      version: 1,
      profile: { kind: 'unified-memory', label: 'Shared memory', capacityGiB: 48, reservedGiB: 8 },
    }))
    const first = render(<App />)
    const calculator = await screen.findByRole('region', { name: 'Model VRAM calculator' })
    expect(within(calculator).getByLabelText('Your VRAM')).toHaveValue('40')
    await user.click(screen.getByRole('button', { name: /copy sizeof url/i }))
    const copiedUrl = window.location.href
    expect(writeText).toHaveBeenCalledWith(copiedUrl)

    first.unmount()
    window.localStorage.setItem('sizeof:hardware-profile:v1', JSON.stringify({
      version: 1,
      profile: { kind: 'discrete-gpu', label: 'Different local GPU', capacityGiB: 64, reservedGiB: 0 },
    }))
    window.history.replaceState(null, '', new URL(copiedUrl).pathname + new URL(copiedUrl).search)
    render(<App />)

    const freshCalculator = await screen.findByRole('region', { name: 'Model VRAM calculator' })
    expect(within(freshCalculator).getByLabelText('Your VRAM')).toHaveValue('40')
    expect(within(freshCalculator).getByText(/Different local GPU: 64 GiB total, 0 GiB reserved/)).toBeInTheDocument()
    expect(within(freshCalculator).getByText(/Saved, not applied/)).toBeInTheDocument()
    expect(within(freshCalculator).getByRole('button', { name: 'Clear profile' })).toBeInTheDocument()
    expect(new URL(copiedUrl).search).not.toMatch(/Shared%20memory|reservedGiB|hardware=/)
  })

  it('detaches a local hardware profile when choosing a VRAM preset and copies that preset exactly', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const first = render(<App />)
    const calculator = await screen.findByRole('region', { name: 'Model VRAM calculator' })
    await user.clear(within(calculator).getByLabelText('Label'))
    await user.type(within(calculator).getByLabelText('Label'), 'Private profile')
    await user.clear(within(calculator).getByLabelText('Total memory (GiB)'))
    await user.type(within(calculator).getByLabelText('Total memory (GiB)'), '48')
    await user.clear(within(calculator).getByLabelText('Reserved memory (GiB)'))
    await user.type(within(calculator).getByLabelText('Reserved memory (GiB)'), '8')
    await user.click(within(calculator).getByRole('button', { name: 'Apply local profile' }))
    expect(within(calculator).getByLabelText('Your VRAM')).toHaveValue('40')
    await user.selectOptions(within(calculator).getByLabelText('Your VRAM'), '64')
    expect(within(calculator).getByText(/Private profile: 48 GiB total, 8 GiB reserved/)).toBeInTheDocument()
    expect(within(calculator).getByText(/Saved, not applied/)).toBeInTheDocument()
    expect(within(calculator).getByRole('button', { name: 'Clear profile' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /copy sizeof url/i }))
    const copiedUrl = window.location.href
    expect(new URL(copiedUrl).search).toContain('vram=64')
    expect(new URL(copiedUrl).search).not.toMatch(/Private|reservedGiB|hardware=/)

    first.unmount()
    window.history.replaceState(null, '', new URL(copiedUrl).pathname + new URL(copiedUrl).search)
    render(<App />)
    const freshCalculator = await screen.findByRole('region', { name: 'Model VRAM calculator' })
    expect(within(freshCalculator).getByLabelText('Your VRAM')).toHaveValue('64')
    expect(within(freshCalculator).getByText(/Private profile: 48 GiB total, 8 GiB reserved/)).toBeInTheDocument()
    await user.click(within(freshCalculator).getByRole('button', { name: 'Clear profile' }))
    expect(within(freshCalculator).getByLabelText('Your VRAM')).toHaveValue('64')
    expect(within(freshCalculator).queryByText(/Private profile/)).not.toBeInTheDocument()
  })

  it('refreshes a bare URL with a saved profile applied, while an explicit URL keeps its capacity until Apply', async () => {
    window.localStorage.setItem('sizeof:hardware-profile:v1', JSON.stringify({
      version: 1,
      profile: { kind: 'discrete-gpu', label: 'Saved GPU', capacityGiB: 48, reservedGiB: 8 },
    }))
    const first = render(<App />)
    const calculator = await screen.findByRole('region', { name: 'Model VRAM calculator' })
    expect(within(calculator).getByLabelText('Your VRAM')).toHaveValue('40')
    expect(within(calculator).getByText(/Applied/)).toBeInTheDocument()

    first.unmount()
    window.history.replaceState(null, '', '/Qwen/Qwen3.8-27B?state=1&quant=q4_k_m&ctx=8192&kv=fp16&mla=expanded&vram=64&source=estimated&variant=none')
    render(<App />)
    const explicitCalculator = await screen.findByRole('region', { name: 'Model VRAM calculator' })
    expect(within(explicitCalculator).getByLabelText('Your VRAM')).toHaveValue('64')
    expect(within(explicitCalculator).getByText(/Saved GPU: 48 GiB total, 8 GiB reserved/)).toBeInTheDocument()
    expect(within(explicitCalculator).getByText(/Saved, not applied/)).toBeInTheDocument()
    await userEvent.setup().click(within(explicitCalculator).getByRole('button', { name: 'Apply local profile' }))
    expect(within(explicitCalculator).getByLabelText('Your VRAM')).toHaveValue('40')
    expect(within(explicitCalculator).getByText(/Applied/)).toBeInTheDocument()
  })

  it('atomically falls back to estimated sizing when a valid publisher has an invalid variant', async () => {
    window.history.replaceState(null, '', '/Qwen/Qwen3.8-27B?state=1&source=unsloth&variant=missing')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...apiModel,
      variants: [{
        id: 'unsloth-q4', label: 'GGUF Q4_K_M', format: 'gguf', revision: 'sha1', path: 'q4.gguf',
        source: 'file', role: 'model', bitsPerWeight: 4, weightSizeBytes: 10 * 1024 ** 3,
        totalSizeBytes: 10 * 1024 ** 3, provenance: 'community', publisher: 'unsloth',
        repositoryId: 'unsloth/Qwen3.8-27B-GGUF', sourceUrl: 'https://huggingface.co/unsloth/Qwen3.8-27B-GGUF',
      }],
    })))
    render(<App />)

    const calculator = await screen.findByRole('region', { name: 'Model VRAM calculator' })
    expect(within(calculator).getByRole('tab', { name: 'Estimated' })).toHaveAttribute('aria-selected', 'true')
    expect(within(calculator).getByText('HYPOTHETICAL BIT/WEIGHT ESTIMATE')).toBeInTheDocument()
    expect(window.location.search).toContain('source=estimated')
    expect(window.location.search).toContain('variant=none')
  })

  it('restores the default addon variant when an addon URL variant is invalid', async () => {
    window.history.replaceState(null, '', '/Qwen/Qwen3.8-27B?state=1&source=repository&variant=missing')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...apiModel,
      variants: [{
        id: 'mtp', label: 'GGUF mtp-head', format: 'gguf', revision: 'sha1', path: 'mtp-head.gguf', source: 'file', role: 'addon',
        bitsPerWeight: null, weightSizeBytes: 512 * 1024 ** 2, totalSizeBytes: 512 * 1024 ** 2,
      }],
      addon: { kind: 'mtp', baseModelId: 'Qwen/Qwen3.8-27B', parametersB: 0.46, sizeBytes: 512 * 1024 ** 2 },
    })))
    render(<App />)
    const variants = await screen.findByRole('region', { name: 'Detected model variants' })
    expect(within(variants).getByLabelText('Repository variant')).toHaveValue('mtp')
    expect(window.location.search).toContain('source=repository')
    expect(window.location.search).toContain('variant=mtp')
  })

  it('guards browser storage failures and rejects invalid hardware form values before applying', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
    const user = userEvent.setup()
    render(<App />)
    const calculator = await screen.findByRole('region', { name: 'Model VRAM calculator' })
    expect(within(calculator).getByLabelText('Your VRAM')).toHaveValue('32')
    getItem.mockRestore()
    await user.clear(within(calculator).getByLabelText('Label'))
    await user.type(within(calculator).getByLabelText('Label'), 'Too large')
    await user.clear(within(calculator).getByLabelText('Total memory (GiB)'))
    await user.type(within(calculator).getByLabelText('Total memory (GiB)'), '5000')
    await user.click(within(calculator).getByRole('button', { name: 'Apply local profile' }))
    expect(within(calculator).getByRole('alert')).toHaveTextContent(/valid hardware profile/i)
    expect(within(calculator).getByLabelText('Your VRAM')).toHaveValue('32')
  })

  it('shows time-aware evidence kinds and a numeric lower-bound sticky summary', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...apiModel,
      estimateConfidence: 'runtime-specific',
      spec: { ...apiModel.spec, estimateConfidence: 'runtime-specific' },
    })))
    const user = userEvent.setup()
    render(<App />)

    const calculator = await screen.findByRole('region', { name: 'Model VRAM calculator' })
    await user.click(within(calculator).getByText(/Evidence:/))
    expect(within(calculator).getByText(/Repository updated 2026-08-14T15:00:01.000Z/)).toBeInTheDocument()
    expect(within(calculator).queryByText(/Observed 2026-08-14T15:00:01.000Z/)).not.toBeInTheDocument()
    expect(within(calculator).getByText(/UNKNOWN \/ Runtime-specific memory factors/).closest('li')).toHaveClass('evidence-unknown')
    const sticky = within(calculator).getByRole('status', { name: 'Current memory result' })
    expect(sticky).toHaveTextContent(/\d+\.\d+ GiB lower bound/i)
    expect(sticky).toHaveTextContent(/32 GiB capacity/)
  })

  it('keeps a stable fit-planner refusal on resource-only pages without LLM controls', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...apiModel,
      id: 'Example/Encoder', owner: 'Example', name: 'Encoder', modelKind: 'embedding', spec: null,
      estimateReason: 'encoder-model',
      resourceEstimate: {
        kind: 'encoder', title: 'Encoder loaded weights', description: 'Static weights only.', note: 'Runtime varies.', baseModelId: null,
        options: [{ id: 'weights', label: 'Weights', components: [{ id: 'weights', label: 'Weights', sizeBytes: 1024 ** 3 }] }],
      },
    })))
    render(<App />)

    const load = await screen.findByRole('region', { name: 'Model load estimate' })
    expect(within(load).getByRole('region', { name: 'Fit planner' })).toHaveTextContent(/resource-only model/i)
    expect(screen.queryByLabelText('Context window')).not.toBeInTheDocument()
    expect(screen.queryByText('ESTIMATED VRAM')).not.toBeInTheDocument()
  })

  it('keeps storage errors session-local and preserves the selected capacity when cleared', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
    const user = userEvent.setup()
    render(<App />)
    const calculator = await screen.findByRole('region', { name: 'Model VRAM calculator' })
    await user.clear(within(calculator).getByLabelText('Label'))
    await user.type(within(calculator).getByLabelText('Label'), 'Session GPU')
    await user.clear(within(calculator).getByLabelText('Total memory (GiB)'))
    await user.type(within(calculator).getByLabelText('Total memory (GiB)'), '24')
    await user.click(within(calculator).getByRole('button', { name: 'Apply local profile' }))
    expect(within(calculator).getByLabelText('Your VRAM')).toHaveValue('24')
    await user.click(within(calculator).getByRole('button', { name: 'Clear profile' }))
    expect(within(calculator).getByLabelText('Your VRAM')).toHaveValue('24')
    setItem.mockRestore()
    removeItem.mockRestore()
  })

  it('serializes MLA mode and validated source/variant changes while retaining one semantic sticky result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...apiModel,
      spec: {
        ...apiModel.spec,
        kvHeads: undefined, headDim: undefined,
        kvCache: { kind: 'mla', heads: 8, keyHeadDim: 64, valueHeadDim: 64, latentDim: 128, ropeDim: 32 },
      },
      variants: [{
        id: 'unsloth-q4', label: 'GGUF Q4_K_M', format: 'gguf', revision: 'sha1', path: 'q4.gguf', source: 'file', role: 'model',
        bitsPerWeight: 4, weightSizeBytes: 10 * 1024 ** 3, totalSizeBytes: 10 * 1024 ** 3, provenance: 'community', publisher: 'unsloth',
        repositoryId: 'unsloth/Qwen3.8-27B-GGUF', sourceUrl: 'https://huggingface.co/unsloth/Qwen3.8-27B-GGUF',
      }],
    })))
    const user = userEvent.setup()
    render(<App />)
    const calculator = await screen.findByRole('region', { name: 'Model VRAM calculator' })
    await user.selectOptions(within(calculator).getByLabelText('MLA cache layout'), 'latent')
    await user.click(within(calculator).getByRole('tab', { name: 'Unsloth' }))
    expect(window.location.search).toContain('mla=latent')
    expect(window.location.search).toContain('source=unsloth')
    expect(window.location.search).toContain('variant=unsloth-q4')
    expect(within(calculator).getAllByRole('status', { name: 'Current memory result' })).toHaveLength(1)
  })

  it('keeps the one normal-order sticky summary guarded for narrow, short, and reduced-motion viewports', async () => {
    render(<App />)
    const calculator = await screen.findByRole('region', { name: 'Model VRAM calculator' })
    const result = within(calculator).getByRole('region', { name: 'Memory summary' })
    const sticky = within(calculator).getByRole('status', { name: 'Current memory result' })
    expect(result.compareDocumentPosition(sticky) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
