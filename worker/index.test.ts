import { describe, expect, it, vi } from 'vitest'
import { applyAssetCachePolicy, createModelCacheKey, handleModelApi } from './index'

describe('Hugging Face model API', () => {
  it('requires HTML shells to revalidate while leaving hashed assets cacheable', () => {
    const html = applyAssetCachePolicy(new Response('<!doctype html>', {
      headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=3600' },
    }))
    const script = new Response('export {}', {
      headers: { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=31536000' },
    })

    expect(html.headers.get('Cache-Control')).toBe('no-cache')
    expect(applyAssetCachePolicy(script)).toBe(script)
  })

  it('uses an internal versioned cache key independent of the public schema query', () => {
    const key = createModelCacheKey(
      new Request('https://sizeof.ai/api/models/moonshotai/Kimi-K3?schema=2&random=uncached'),
    )

    expect(new URL(key.url).searchParams.get('__sizeof_cache')).toBe('hf-model-v13')
    expect([...new URL(key.url).searchParams.keys()]).toEqual(['__sizeof_cache'])
  })

  it('fetches metadata and config from fixed Hugging Face endpoints', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/models/')) {
        return Response.json({
          id: 'Qwen/Qwen3.8-27B',
          author: 'Qwen',
          sha: 'abc123',
          safetensors: { total: 27_781_427_952 },
        })
      }
      return Response.json({
        architectures: ['Qwen3_5ForConditionalGeneration'],
        text_config: {
          head_dim: 256,
          num_hidden_layers: 64,
          num_key_value_heads: 4,
          max_position_embeddings: 262144,
          layer_types: ['linear_attention', 'full_attention'],
        },
      })
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Qwen/Qwen3.8-27B'),
      fetcher,
    )
    const body = await response.json() as { id: string; spec: { attentionLayers: number } }

    expect(response.status).toBe(200)
    expect(body.id).toBe('Qwen/Qwen3.8-27B')
    expect(body.spec.attentionLayers).toBe(1)
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('https://huggingface.co/api/models/Qwen/Qwen3.8-27B?'),
      expect.any(Object),
    )
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('expand=safetensors')
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('expand=gguf')
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('expand=downloads')
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('expand=likes')
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('expand=usedStorage')
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'https://huggingface.co/Qwen/Qwen3.8-27B/resolve/abc123/config.json',
      expect.any(Object),
    )
  })

  it('keeps model lookup available when optional tree data is malformed', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/tree/abc123')) return new Response('{malformed', { status: 200 })
      if (url.includes('/api/models/Qwen/Qwen3.8-27B')) {
        return Response.json({
          id: 'Qwen/Qwen3.8-27B',
          sha: 'abc123',
          safetensors: { total: 27_781_427_952 },
        })
      }
      if (url.includes('/resolve/abc123/config.json')) {
        return Response.json({
          num_hidden_layers: 64,
          num_key_value_heads: 4,
          head_dim: 256,
          max_position_embeddings: 262_144,
        })
      }
      throw new Error(`Unexpected malformed-tree fetch: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Qwen/Qwen3.8-27B'),
      fetcher,
    )
    const body = await response.json() as { spec: unknown; variants: unknown[] }

    expect(response.status).toBe(200)
    expect(body.spec).not.toBeNull()
    expect(body.variants).toEqual([])
  })

  it('inherits a revision-locked base config for a full GGUF model repository', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/models/unsloth/Qwen3.8-27B-GGUF')) {
        return Response.json({
          id: 'unsloth/Qwen3.8-27B-GGUF',
          author: 'unsloth',
          sha: 'derived123',
          tags: ['gguf', 'base_model:Qwen/Qwen3.8-27B', 'base_model:quantized:Qwen/Qwen3.8-27B'],
          gguf: { total: 27_320_697_856, context_length: 262144 },
        })
      }
      if (url.includes('/unsloth/Qwen3.8-27B-GGUF/resolve/derived123/config.json')) {
        return Response.json({})
      }
      if (url.includes('/api/models/Qwen/Qwen3.8-27B')) {
        return Response.json({
          id: 'Qwen/Qwen3.8-27B',
          sha: 'base456',
          safetensors: { total: 27_781_427_952 },
        })
      }
      if (url.includes('/Qwen/Qwen3.8-27B/resolve/base456/config.json')) {
        return Response.json({
          architectures: ['Qwen3_5ForConditionalGeneration'],
          num_hidden_layers: 64,
          num_key_value_heads: 4,
          num_attention_heads: 24,
          head_dim: 256,
          max_position_embeddings: 262144,
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/unsloth/Qwen3.8-27B-GGUF'),
      fetcher,
    )
    const body = await response.json() as {
      parametersB: number
      quantizationFormat: string
      configSourceId: string | null
      spec: { layers: number }
    }

    expect(response.status).toBe(200)
    expect(body.parametersB).toBe(27.320697856)
    expect(body.quantizationFormat).toBe('gguf')
    expect(body.configSourceId).toBe('Qwen/Qwen3.8-27B')
    expect(body.spec.layers).toBe(64)
  })

  it('combines an MTP sidecar with its revision-locked base model', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/Lab/Qwen-MTP-GGUF/tree/derived123')) {
        return Response.json([
          { type: 'file', path: 'mtp-head.gguf', size: 503_316_480 },
        ])
      }
      if (url.includes('/api/models/Lab/Qwen-MTP-GGUF')) {
        return Response.json({
          id: 'Lab/Qwen-MTP-GGUF',
          author: 'Lab',
          sha: 'derived123',
          tags: [
            'gguf', 'mtp',
            'base_model:unsloth/Qwen3.8-27B-NVFP4',
            'base_model:quantized:unsloth/Qwen3.8-27B-NVFP4',
          ],
          gguf: { total: 460_730_096, architecture: 'qwen35', context_length: 262144 },
        })
      }
      if (url.includes('/Lab/Qwen-MTP-GGUF/resolve/derived123/config.json')) {
        return Response.json({
          architectures: ['Qwen3_5ForConditionalGeneration'],
          num_hidden_layers: 64,
          num_key_value_heads: 4,
          num_attention_heads: 24,
          head_dim: 256,
          max_position_embeddings: 262144,
        })
      }
      if (url.includes('/api/models/unsloth/Qwen3.8-27B-NVFP4')) {
        return Response.json({
          id: 'unsloth/Qwen3.8-27B-NVFP4',
          sha: 'base456',
          tags: ['base_model:Qwen/Qwen3.8-27B', 'base_model:quantized:Qwen/Qwen3.8-27B'],
          safetensors: { total: 19_869_895_952 },
        })
      }
      if (url.includes('/unsloth/Qwen3.8-27B-NVFP4/resolve/base456/config.json')) {
        return Response.json({
          architectures: ['Qwen3_5ForConditionalGeneration'],
          num_hidden_layers: 64,
          num_key_value_heads: 4,
          num_attention_heads: 24,
          head_dim: 256,
          max_position_embeddings: 262144,
        })
      }
      if (url.includes('/api/models/Qwen/Qwen3.8-27B')) {
        return Response.json({
          id: 'Qwen/Qwen3.8-27B',
          sha: 'base789',
          safetensors: { total: 27_781_427_952, parameters: { BF16: 27_781_427_952 } },
        })
      }
      if (url.includes('/Qwen/Qwen3.8-27B/resolve/base789/config.json')) {
        return Response.json({
          architectures: ['Qwen3_5ForConditionalGeneration'],
          num_hidden_layers: 64,
          num_key_value_heads: 4,
          num_attention_heads: 24,
          head_dim: 256,
          max_position_embeddings: 262144,
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Lab/Qwen-MTP-GGUF'),
      fetcher,
    )
    const body = await response.json() as {
      parametersB: number
      configSourceId: string | null
      spec: { parametersB: number }
      addon: { kind: string; baseModelId: string; parametersB: number; sizeBytes: number }
    }

    expect(response.status).toBe(200)
    expect(body.parametersB).toBe(27.781427952)
    expect(body.spec.parametersB).toBe(27.781427952)
    expect(body.configSourceId).toBeNull()
    expect(body.addon).toEqual({
      kind: 'mtp',
      baseModelId: 'Qwen/Qwen3.8-27B',
      parametersB: 0.460730096,
      sizeBytes: 503_316_480,
    })
  })

  it('uses full-model GGUF metadata when a projector overrides repository-level facts', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/Lab/Composite-GGUF/tree/composite123')) {
        return Response.json([
          { type: 'file', path: 'Model-Q4_K_M.gguf', size: 16_810_714_432 },
          { type: 'file', path: 'mmproj-F32.gguf', size: 1_842_940_128 },
        ])
      }
      if (url.includes('/api/models/Lab/Composite-GGUF')) {
        return Response.json({
          id: 'Lab/Composite-GGUF',
          sha: 'composite123',
          tags: ['gguf', 'image-text-to-text'],
          gguf: { total: 460_730_096, architecture: 'clip', context_length: 262_144 },
        })
      }
      if (url.includes('/Lab/Composite-GGUF/resolve/composite123/config.json')) {
        return Response.json({})
      }
      throw new Error(`Unexpected composite fetch: ${url}`)
    })
    const ggufReader = vi.fn(async () => ({
      parameterCount: 27_320_697_856,
      metadata: {
        'general.architecture': 'qwen35',
        'general.type': 'model',
        'qwen35.block_count': 65,
        'qwen35.context_length': 262_144,
        'qwen35.attention.head_count': 24,
        'qwen35.attention.head_count_kv': 4,
        'qwen35.attention.key_length': 256,
        'qwen35.nextn_predict_layers': 1,
        'qwen35.full_attention_interval': 4,
      },
      tensorInfos: [],
    }))

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Lab/Composite-GGUF'),
      fetcher,
      ggufReader,
    )
    const body = await response.json() as {
      parametersB: number
      configSourceId: string | null
      spec: { layers: number; attentionLayers: number }
      variants: Array<{ role: string }>
    }

    expect(response.status).toBe(200)
    expect(body.parametersB).toBe(27.320697856)
    expect(body.configSourceId).toBe('GGUF / Model-Q4_K_M.gguf')
    expect(body.spec).toMatchObject({ layers: 64, attentionLayers: 16 })
    expect(body.variants.map((variant) => variant.role)).toEqual(['model', 'projector'])
  })

  it('does not trust metadata returned for a different base model id', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/models/Lab/Model-GGUF')) {
        return Response.json({
          id: 'Lab/Model-GGUF',
          sha: 'derived123',
          tags: ['gguf', 'base_model:Qwen/Qwen3.8-27B', 'base_model:quantized:Qwen/Qwen3.8-27B'],
          gguf: { total: 27_320_697_856, architecture: 'qwen35', context_length: 262144 },
        })
      }
      if (url.includes('/Lab/Model-GGUF/resolve/derived123/config.json')) {
        return Response.json({})
      }
      if (url.includes('/api/models/Qwen/Qwen3.8-27B')) {
        return Response.json({
          id: 'Wrong/Model',
          sha: 'wrong456',
          safetensors: { total: 27_781_427_952 },
        })
      }
      throw new Error(`Unexpected fetch for mismatched base: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Lab/Model-GGUF'),
      fetcher,
    )
    const body = await response.json() as { spec: unknown; configSourceId: string | null }

    expect(response.status).toBe(200)
    expect(body.spec).toBeNull()
    expect(body.configSourceId).toBeNull()
  })

  it('does not treat a GGUF LoRA adapter as a full base model', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/models/Lab/Adapter-GGUF')) {
        return Response.json({
          id: 'Lab/Adapter-GGUF',
          sha: 'adapter123',
          tags: ['gguf', 'base_model:Qwen/Qwen3.8-27B', 'base_model:quantized:Qwen/Qwen3.8-27B'],
          gguf: { total: 25_000_000, architecture: 'lora', context_length: 262144 },
        })
      }
      if (url.includes('/Lab/Adapter-GGUF/resolve/adapter123/config.json')) {
        return Response.json({
          architectures: ['Qwen3_5ForConditionalGeneration'],
          num_hidden_layers: 64,
          num_key_value_heads: 4,
          num_attention_heads: 24,
          head_dim: 256,
          max_position_embeddings: 262144,
        })
      }
      throw new Error(`Unexpected base-model fetch for adapter: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Lab/Adapter-GGUF'),
      fetcher,
    )
    const body = await response.json() as { spec: unknown; configSourceId: string | null }

    expect(response.status).toBe(200)
    expect(body.spec).toBeNull()
    expect(body.configSourceId).toBeNull()
  })

  it('uses logical base parameters for a complete packed quantized model', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/models/RadixArk/Qwen3.8-27B-NVFP4')) {
        return Response.json({
          id: 'RadixArk/Qwen3.8-27B-NVFP4',
          sha: 'packed123',
          tags: [
            'safetensors', 'quantized', 'fp4',
            'base_model:Qwen/Qwen3.8-27B',
            'base_model:quantized:Qwen/Qwen3.8-27B',
          ],
          safetensors: {
            total: 18_164_649_200,
            parameters: { BF16: 2_183_066_352, F8_E4M3: 7_214_202_880, U8: 9_192_079_360 },
          },
        })
      }
      if (url.includes('/RadixArk/Qwen3.8-27B-NVFP4/resolve/packed123/config.json')) {
        return Response.json({
          architectures: ['Qwen3_5ForConditionalGeneration'],
          model_type: 'qwen3_5',
          num_hidden_layers: 64,
          num_key_value_heads: 4,
          num_attention_heads: 24,
          head_dim: 256,
          max_position_embeddings: 262144,
          quantization_config: { quant_method: 'modelopt', bits: 4 },
        })
      }
      if (url.includes('/api/models/Qwen/Qwen3.8-27B')) {
        return Response.json({
          id: 'Qwen/Qwen3.8-27B',
          sha: 'base456',
          safetensors: { total: 27_781_427_952, parameters: { BF16: 27_781_427_952 } },
        })
      }
      throw new Error(`Unexpected packed-model fetch: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/RadixArk/Qwen3.8-27B-NVFP4'),
      fetcher,
    )
    const body = await response.json() as {
      parametersB: number
      quantizationFormat: string
      spec: { parametersB: number }
    }

    expect(response.status).toBe(200)
    expect(body.parametersB).toBe(27.781427952)
    expect(body.spec.parametersB).toBe(27.781427952)
    expect(body.quantizationFormat).toBe('modelopt-4bit')
  })

  it('uses logical base parameters for U32-packed MLX weights', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/models/Youssofal/Qwen3.8-27B-MTPLX-Optimized-Quality')) {
        return Response.json({
          id: 'Youssofal/Qwen3.8-27B-MTPLX-Optimized-Quality',
          sha: 'mlx123',
          library_name: 'mlx',
          tags: [
            'mlx', 'safetensors', '8-bit',
            'base_model:Qwen/Qwen3.8-27B',
            'base_model:quantized:Qwen/Qwen3.8-27B',
          ],
          safetensors: {
            total: 8_027_131_120,
            parameters: { BF16: 1_303_792_880, U32: 6_723_338_240 },
          },
        })
      }
      if (url.includes('/Youssofal/Qwen3.8-27B-MTPLX-Optimized-Quality/resolve/mlx123/config.json')) {
        return Response.json({
          architectures: ['Qwen3_5ForConditionalGeneration'],
          model_type: 'qwen3_5',
          num_hidden_layers: 64,
          num_key_value_heads: 4,
          num_attention_heads: 24,
          head_dim: 256,
          max_position_embeddings: 262144,
          quantization_config: { bits: 8, mode: 'affine' },
        })
      }
      if (url.includes('/api/models/Qwen/Qwen3.8-27B')) {
        return Response.json({
          id: 'Qwen/Qwen3.8-27B',
          sha: 'base456',
          safetensors: { total: 27_781_427_952, parameters: { BF16: 27_781_427_952 } },
        })
      }
      throw new Error(`Unexpected MLX-model fetch: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Youssofal/Qwen3.8-27B-MTPLX-Optimized-Quality'),
      fetcher,
    )
    const body = await response.json() as {
      parametersB: number
      estimateReason: string | null
      quantizationFormat: string
      spec: { parametersB: number }
    }

    expect(response.status).toBe(200)
    expect(body.parametersB).toBe(27.781427952)
    expect(body.spec.parametersB).toBe(27.781427952)
    expect(body.estimateReason).toBeNull()
    expect(body.quantizationFormat).toBe('mlx-8-bit')
  })

  it('discovers path-based MLX variants and uses their exact payload sizes', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/PocketAiHub/Qwen3.8-9B-Abliterated-MLX/tree/pocket123')) {
        if (url.includes('cursor=page2')) {
          return Response.json([
            { type: 'file', path: '4bit/model-2.safetensors', size: 950_000_000 },
            { type: 'file', path: '4bit/artifact-manifest.json', size: 2_816 },
            { type: 'file', path: '8bit/model.safetensors', size: 10_400_000_000 },
            { type: 'file', path: 'release-manifest.json', size: 2_000 },
          ])
        }
        return Response.json([
          { type: 'file', path: '4bit/config.json', size: 3_697 },
          { type: 'file', path: '4bit/model-1.safetensors', size: 5_000_000_000 },
        ], {
          headers: {
            Link: '<https://huggingface.co/api/models/PocketAiHub/Qwen3.8-9B-Abliterated-MLX/tree/pocket123?recursive=true&expand=true&limit=100&cursor=page2>; rel="next"',
          },
        })
      }
      if (url.includes('/resolve/pocket123/release-manifest.json')) {
        return Response.json({ variants: [
          { path: '4bit', precision: '4-bit', total_size_bytes: 5_977_078_438 },
          { path: '8bit', precision: '8-bit', total_size_bytes: 10_453_449_005 },
        ] })
      }
      if (url.includes('/resolve/pocket123/4bit/artifact-manifest.json')) {
        return Response.json({ metadata: {
          sourceRepository: 'empero-ai/Qwen3.8-9B',
          sourceRevision: '0934f3d2327ff2df2197495278c4c46ae5a56bd9',
          baseModel: 'Qwen/Qwen3.5-9B',
        } })
      }
      if (url.includes('/api/models/PocketAiHub/Qwen3.8-9B-Abliterated-MLX')) {
        return Response.json({
          id: 'PocketAiHub/Qwen3.8-9B-Abliterated-MLX',
          sha: 'pocket123',
          library_name: 'mlx',
          tags: ['mlx', '4-bit', '8-bit'],
          siblings: [{ rfilename: 'release-manifest.json' }],
        })
      }
      if (url.includes('/PocketAiHub/Qwen3.8-9B-Abliterated-MLX/resolve/pocket123/config.json')) {
        return new Response('missing', { status: 404 })
      }
      if (url.includes('/api/models/Qwen/Qwen3.5-9B')) {
        return Response.json({
          id: 'Qwen/Qwen3.5-9B', sha: 'base456',
          safetensors: { total: 9_653_104_368, parameters: { BF16: 9_653_104_368 } },
        })
      }
      if (url.includes('/Qwen/Qwen3.5-9B/resolve/base456/config.json')) {
        return Response.json({
          model_type: 'qwen3_5', num_hidden_layers: 32, num_key_value_heads: 4,
          num_attention_heads: 16, head_dim: 256, max_position_embeddings: 262144,
        })
      }
      throw new Error(`Unexpected MLX variant fetch: ${url}`)
    })

    const response = await handleModelApi(new Request(
      'https://sizeof.ai/api/models/PocketAiHub/Qwen3.8-9B-Abliterated-MLX',
    ), fetcher)
    const body = await response.json() as {
      parametersB: number
      spec: { parametersB: number }
      variants: Array<{ label: string; weightSizeBytes: number; totalSizeBytes: number }>
    }

    expect(response.status).toBe(200)
    expect(body.parametersB).toBe(9.653104368)
    expect(body.spec.parametersB).toBe(9.653104368)
    expect(body.variants).toEqual([
      expect.objectContaining({
        label: 'MLX 4-bit', weightSizeBytes: 5_950_000_000, totalSizeBytes: 5_977_078_438,
      }),
      expect.objectContaining({
        label: 'MLX 8-bit', weightSizeBytes: 10_400_000_000, totalSizeBytes: 10_453_449_005,
      }),
    ])
  })

  it('discovers EXL variants from revision-locked branches', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/turboderp/Qwen3.8-27B-exl3/tree/main123')) {
        return Response.json([{ type: 'file', path: 'README.md', size: 1_214 }])
      }
      if (url.includes('/api/models/turboderp/Qwen3.8-27B-exl3/refs')) {
        return Response.json({ branches: [
          { name: 'main', targetCommit: 'main123' },
          { name: '2.00bpw', targetCommit: '2000000000000000000000000000000000000000' },
          { name: '4.00bpw', targetCommit: '4000000000000000000000000000000000000000' },
        ] })
      }
      if (url.includes('/tree/2000000000000000000000000000000000000000')) {
        return Response.json([
          { type: 'file', path: 'config.json', size: 4_000 },
          { type: 'file', path: 'output-1.safetensors', size: 8_500_000_000 },
          { type: 'file', path: 'output-2.safetensors', size: 2_278_000_000 },
        ])
      }
      if (url.includes('/tree/4000000000000000000000000000000000000000')) {
        return Response.json([
          { type: 'file', path: 'config.json', size: 4_000 },
          { type: 'file', path: 'output.safetensors', size: 16_884_000_000 },
        ])
      }
      if (url.includes('/api/models/turboderp/Qwen3.8-27B-exl3')) {
        return Response.json({
          id: 'turboderp/Qwen3.8-27B-exl3', sha: 'main123',
          tags: [
            'exl3', 'base_model:Qwen/Qwen3.8-27B',
            'base_model:quantized:Qwen/Qwen3.8-27B',
          ],
        })
      }
      if (url.includes('/turboderp/Qwen3.8-27B-exl3/resolve/main123/config.json')) {
        return new Response('missing', { status: 404 })
      }
      if (url.includes('/api/models/Qwen/Qwen3.8-27B')) {
        return Response.json({
          id: 'Qwen/Qwen3.8-27B', sha: 'base456',
          safetensors: { total: 27_781_427_952, parameters: { BF16: 27_781_427_952 } },
        })
      }
      if (url.includes('/Qwen/Qwen3.8-27B/resolve/base456/config.json')) {
        return Response.json({
          num_hidden_layers: 64, num_key_value_heads: 4, num_attention_heads: 24,
          head_dim: 256, max_position_embeddings: 262144,
        })
      }
      throw new Error(`Unexpected EXL variant fetch: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/turboderp/Qwen3.8-27B-exl3'),
      fetcher,
    )
    const body = await response.json() as {
      spec: { parametersB: number }
      variants: Array<{ label: string; revision: string; weightSizeBytes: number }>
    }

    expect(response.status).toBe(200)
    expect(body.spec.parametersB).toBe(27.781427952)
    expect(body.variants).toEqual([
      expect.objectContaining({
        label: 'EXL3 2.00 bpw', revision: '2000000000000000000000000000000000000000',
        weightSizeBytes: 10_778_000_000,
      }),
      expect.objectContaining({
        label: 'EXL3 4.00 bpw', revision: '4000000000000000000000000000000000000000',
        weightSizeBytes: 16_884_000_000,
      }),
    ])
  })

  it('uses an NInfer manifest to resolve its exact artifact and pinned base model', async () => {
    const baseSha = '1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0'
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/neroued/Qwen3.8-27B-NInfer/tree/ninfer123')) {
        return Response.json([
          { type: 'file', path: 'artifact-manifest.json', size: 1_720 },
          { type: 'file', path: 'qwen3_8_27b.ninfer', size: 18_210_531_328 },
        ])
      }
      if (url.includes('/resolve/ninfer123/artifact-manifest.json')) {
        return Response.json({
          artifact: { path: 'qwen3_8_27b.ninfer', bytes: 18_210_531_328 },
          base: { repo_id: 'Qwen/Qwen3.8-27B', revision: baseSha },
          weights_id: 'groupwise-int',
        })
      }
      if (url.includes('/api/models/neroued/Qwen3.8-27B-NInfer')) {
        return Response.json({
          id: 'neroued/Qwen3.8-27B-NInfer', sha: 'ninfer123',
          library_name: 'ninfer', tags: ['ninfer', 'quantized'],
          siblings: [{ rfilename: 'artifact-manifest.json' }, { rfilename: 'qwen3_8_27b.ninfer' }],
        })
      }
      if (url.includes('/neroued/Qwen3.8-27B-NInfer/resolve/ninfer123/config.json')) {
        return new Response('missing', { status: 404 })
      }
      if (url.includes('/api/models/Qwen/Qwen3.8-27B')) {
        expect(url).toContain(`revision=${baseSha}`)
        return Response.json({
          id: 'Qwen/Qwen3.8-27B', sha: baseSha,
          safetensors: { total: 27_781_427_952, parameters: { BF16: 27_781_427_952 } },
        })
      }
      if (url.includes(`/Qwen/Qwen3.8-27B/resolve/${baseSha}/config.json`)) {
        return Response.json({
          num_hidden_layers: 64, num_key_value_heads: 4, num_attention_heads: 24,
          head_dim: 256, max_position_embeddings: 262144,
        })
      }
      throw new Error(`Unexpected NInfer fetch: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/neroued/Qwen3.8-27B-NInfer'),
      fetcher,
    )
    const body = await response.json() as {
      parametersB: number
      spec: { parametersB: number }
      variants: Array<{ format: string; weightSizeBytes: number }>
    }

    expect(response.status).toBe(200)
    expect(body.parametersB).toBe(27.781427952)
    expect(body.spec.parametersB).toBe(27.781427952)
    expect(body.variants).toEqual([
      expect.objectContaining({ format: 'ninfer', weightSizeBytes: 18_210_531_328 }),
    ])
  })

  it('treats packed quantized weights without a declared base as their own model', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/models/Lab/Qwen3.8-27B-AutoRound')) {
        return Response.json({
          id: 'Lab/Qwen3.8-27B-AutoRound',
          sha: 'packed123',
          tags: ['safetensors', 'quantized', 'auto-round', '4-bit'],
          safetensors: {
            total: 11_575_659_760,
            parameters: { I32: 2_470_195_200, BF16: 8_618_701_552, F16: 598_835_200 },
          },
        })
      }
      return Response.json({
        architectures: ['Qwen3_5ForConditionalGeneration'],
        model_type: 'qwen3_5',
        num_hidden_layers: 64,
        num_key_value_heads: 4,
        num_attention_heads: 24,
        head_dim: 256,
        max_position_embeddings: 262144,
        quantization_config: { quant_method: 'auto-round', bits: 4 },
      })
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Lab/Qwen3.8-27B-AutoRound'),
      fetcher,
    )
    const body = await response.json() as {
      estimateReason: string | null
      parameterCountKind: string
      quantizationFormat: string
      spec: { parametersB: number }
    }

    expect(response.status).toBe(200)
    expect(body.quantizationFormat).toBe('auto-round-4bit')
    expect(body.parameterCountKind).toBe('tensor-elements')
    expect(body.estimateReason).toBeNull()
    expect(body.spec.parametersB).toBe(11.57565976)
  })

  it('follows a bounded revision-locked quantized base chain for missing GGUF config', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/models/Lab/Layer-Two-GGUF')) {
        return Response.json({
          id: 'Lab/Layer-Two-GGUF',
          sha: 'derived123',
          tags: ['gguf', 'base_model:Lab/Layer-One-GGUF', 'base_model:quantized:Lab/Layer-One-GGUF'],
          gguf: { total: 34_660_610_688, architecture: 'qwen35moe', context_length: 262144 },
        })
      }
      if (url.includes('/Lab/Layer-Two-GGUF/resolve/derived123/config.json')) {
        return new Response('missing', { status: 404 })
      }
      if (url.includes('/api/models/Lab/Layer-One-GGUF')) {
        return Response.json({
          id: 'Lab/Layer-One-GGUF',
          sha: 'middle456',
          tags: ['gguf', 'base_model:Qwen/Qwen3.6-35B-A3B', 'base_model:quantized:Qwen/Qwen3.6-35B-A3B'],
          gguf: { total: 34_660_610_688 },
        })
      }
      if (url.includes('/Lab/Layer-One-GGUF/resolve/middle456/config.json')) {
        return new Response('missing', { status: 404 })
      }
      if (url.includes('/api/models/Qwen/Qwen3.6-35B-A3B')) {
        return Response.json({
          id: 'Qwen/Qwen3.6-35B-A3B',
          sha: 'base789',
          safetensors: { total: 35_951_822_704, parameters: { BF16: 35_951_822_704 } },
        })
      }
      if (url.includes('/Qwen/Qwen3.6-35B-A3B/resolve/base789/config.json')) {
        return Response.json({
          architectures: ['Qwen3_5MoeForConditionalGeneration'],
          model_type: 'qwen3_5_moe',
          num_hidden_layers: 40,
          num_key_value_heads: 4,
          num_attention_heads: 32,
          head_dim: 128,
          max_position_embeddings: 262144,
          layer_types: Array.from({ length: 40 }, (_, index) => index % 4 === 3 ? 'full_attention' : 'linear_attention'),
        })
      }
      throw new Error(`Unexpected base-chain fetch: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Lab/Layer-Two-GGUF'),
      fetcher,
    )
    const body = await response.json() as {
      parametersB: number
      configSourceId: string | null
      spec: { layers: number; attentionLayers: number }
    }

    expect(response.status).toBe(200)
    expect(body.parametersB).toBe(34.660610688)
    expect(body.configSourceId).toBe('Qwen/Qwen3.6-35B-A3B')
    expect(body.spec).toMatchObject({ layers: 40, attentionLayers: 10 })
  })

  it('honors declared metadata lineage when the repository name suggests another version', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/models/Lab/Qwen3.8-27B-GGUF')) {
        return Response.json({
          id: 'Lab/Qwen3.8-27B-GGUF',
          sha: 'derived123',
          tags: ['gguf', 'base_model:Qwen/Qwen3.6-27B', 'base_model:quantized:Qwen/Qwen3.6-27B'],
          gguf: { total: 26_895_998_464, architecture: 'qwen35', context_length: 262144 },
        })
      }
      if (url.includes('/Lab/Qwen3.8-27B-GGUF/resolve/derived123/config.json')) {
        return new Response('missing', { status: 404 })
      }
      if (url.includes('/api/models/Qwen/Qwen3.6-27B')) {
        return Response.json({
          id: 'Qwen/Qwen3.6-27B',
          sha: 'base456',
          safetensors: { total: 27_781_427_952, parameters: { BF16: 27_781_427_952 } },
        })
      }
      if (url.includes('/Qwen/Qwen3.6-27B/resolve/base456/config.json')) {
        return Response.json({
          architectures: ['Qwen3_5ForConditionalGeneration'],
          model_type: 'qwen3_5',
          num_hidden_layers: 64,
          num_key_value_heads: 4,
          num_attention_heads: 24,
          head_dim: 256,
          max_position_embeddings: 262144,
        })
      }
      throw new Error(`Unexpected metadata-lineage fetch: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Lab/Qwen3.8-27B-GGUF'),
      fetcher,
    )
    const body = await response.json() as {
      spec: { layers: number }
      estimateReason: string | null
      configSourceId: string | null
    }

    expect(response.status).toBe(200)
    expect(body.spec.layers).toBe(64)
    expect(body.estimateReason).toBeNull()
    expect(body.configSourceId).toBe('Qwen/Qwen3.6-27B')
  })

  it('allows a merged full checkpoint even when its history includes LoRA tags', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/models/Lab/Merged-Lora-Model')) {
        return Response.json({
          id: 'Lab/Merged-Lora-Model',
          sha: 'merged123',
          tags: ['safetensors', 'lora', 'base_model:Base/Model-3B', 'base_model:adapter:Base/Model-3B'],
          safetensors: { total: 3_075_098_624, parameters: { BF16: 3_075_098_624 } },
        })
      }
      if (url.includes('/Lab/Merged-Lora-Model/resolve/merged123/config.json')) {
        return Response.json({
          architectures: ['ExampleForCausalLM'],
          model_type: 'example',
          num_hidden_layers: 36,
          num_key_value_heads: 8,
          num_attention_heads: 24,
          head_dim: 128,
          max_position_embeddings: 65536,
        })
      }
      if (url.includes('/api/models/Base/Model-3B')) {
        return Response.json({
          id: 'Base/Model-3B',
          sha: 'base456',
          safetensors: { total: 3_100_000_000, parameters: { BF16: 3_100_000_000 } },
        })
      }
      throw new Error(`Unexpected merged-model fetch: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Lab/Merged-Lora-Model'),
      fetcher,
    )
    const body = await response.json() as { modelKind: string; estimateReason: string | null; spec: unknown }

    expect(response.status).toBe(200)
    expect(body.modelKind).toBe('language')
    expect(body.estimateReason).toBeNull()
    expect(body.spec).not.toBeNull()
  })

  it('does not use a mutable main revision when base metadata omits sha', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/models/Lab/Model-GGUF')) {
        return Response.json({
          id: 'Lab/Model-GGUF',
          sha: 'derived123',
          tags: ['gguf', 'base_model:Qwen/Qwen3.8-27B', 'base_model:quantized:Qwen/Qwen3.8-27B'],
          gguf: { total: 27_320_697_856, architecture: 'qwen35', context_length: 262144 },
        })
      }
      if (url.includes('/Lab/Model-GGUF/resolve/derived123/config.json')) {
        return new Response('missing', { status: 404 })
      }
      if (url.includes('/api/models/Qwen/Qwen3.8-27B')) {
        return Response.json({ id: 'Qwen/Qwen3.8-27B' })
      }
      throw new Error(`Unexpected mutable base config fetch: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Lab/Model-GGUF'),
      fetcher,
    )
    const body = await response.json() as { spec: unknown; configSourceId: string | null }

    expect(response.status).toBe(200)
    expect(body.spec).toBeNull()
    expect(body.configSourceId).toBeNull()
  })

  it('rejects base parameters without a revision sha even when derived config is complete', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/models/Lab/Packed-Model')) {
        return Response.json({
          id: 'Lab/Packed-Model',
          sha: 'derived123',
          tags: ['4-bit', 'base_model:Base/Model-27B', 'base_model:quantized:Base/Model-27B'],
          safetensors: { total: 12_000_000_000, parameters: { U32: 7_000_000_000, BF16: 5_000_000_000 } },
        })
      }
      if (url.includes('/Lab/Packed-Model/resolve/derived123/config.json')) {
        return Response.json({
          num_hidden_layers: 32,
          num_key_value_heads: 8,
          num_attention_heads: 32,
          head_dim: 128,
          max_position_embeddings: 32768,
        })
      }
      if (url.includes('/api/models/Base/Model-27B')) {
        return Response.json({
          id: 'Base/Model-27B',
          safetensors: { total: 27_000_000_000, parameters: { BF16: 27_000_000_000 } },
        })
      }
      throw new Error(`A mutable base revision must not be used: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Lab/Packed-Model'),
      fetcher,
    )
    const body = await response.json() as { spec: unknown; estimateReason: string }

    expect(response.status).toBe(200)
    expect(body.spec).toBeNull()
    expect(body.estimateReason).toBe('unverified-base')
  })

  it('rejects a base chain that continues beyond the traversal limit', async () => {
    const ids = ['Base/One', 'Base/Two', 'Base/Three', 'Base/Four']
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/models/Lab/Too-Deep-GGUF')) {
        return Response.json({
          id: 'Lab/Too-Deep-GGUF',
          sha: 'derived123',
          tags: ['gguf', 'base_model:Base/One', 'base_model:quantized:Base/One'],
          gguf: { total: 27_000_000_000, context_length: 32768 },
        })
      }
      if (url.includes('/Lab/Too-Deep-GGUF/resolve/derived123/config.json')) {
        return Response.json({
          num_hidden_layers: 32,
          num_key_value_heads: 8,
          num_attention_heads: 32,
          head_dim: 128,
          max_position_embeddings: 32768,
        })
      }
      const index = ids.findIndex((id) => url.includes(`/api/models/${id}`))
      if (index >= 0) {
        const next = ids[index + 1]
        return Response.json({
          id: ids[index],
          sha: `base${index}`,
          tags: next ? [`base_model:${next}`, `base_model:quantized:${next}`] : [],
          safetensors: { total: 27_000_000_000, parameters: { BF16: 27_000_000_000 } },
        })
      }
      throw new Error(`Unexpected deep-chain fetch: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Lab/Too-Deep-GGUF'),
      fetcher,
    )
    const body = await response.json() as { spec: unknown; estimateReason: string }

    expect(response.status).toBe(200)
    expect(body.spec).toBeNull()
    expect(body.estimateReason).toBe('unverified-base')
  })

  it('uses versioned curated architecture facts for a gated official model', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/models/meta-llama/Llama-3.1-8B-Instruct')) {
        return Response.json({
          id: 'meta-llama/Llama-3.1-8B-Instruct',
          sha: 'official123',
          author: 'meta-llama',
          pipeline_tag: 'text-generation',
          safetensors: { total: 8_030_261_248, parameters: { BF16: 8_030_261_248 } },
        })
      }
      if (url.includes('/meta-llama/Llama-3.1-8B-Instruct/resolve/official123/config.json')) {
        return new Response('gated', { status: 401 })
      }
      throw new Error(`Unexpected gated-model fetch: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/meta-llama/Llama-3.1-8B-Instruct'),
      fetcher,
    )
    const body = await response.json() as {
      configSourceId: string | null
      spec: { layers: number; kvHeads: number; headDim: number; maxContext: number }
    }

    expect(response.status).toBe(200)
    expect(body.configSourceId).toBe('sizeof.ai curated / meta-llama/Llama-3.1-8B-Instruct')
    expect(body.spec).toMatchObject({ layers: 32, kvHeads: 8, headDim: 128, maxContext: 131072 })
  })

  it('rejects paths that could escape the fixed Hugging Face origin', async () => {
    const fetcher = vi.fn()
    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/..%2F..%2Fevil/repo'),
      fetcher,
    )

    expect(response.status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns a useful not-found response without retrying', async () => {
    const fetcher = vi.fn(async () => new Response('missing', { status: 404 }))
    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Unknown/Missing'),
      fetcher,
    )

    expect(response.status).toBe(404)
    expect(fetcher).toHaveBeenCalledTimes(1)
    await expect(response.json()).resolves.toEqual({ error: 'Model not found or private' })
  })

  it('normalizes a metadata network failure into a JSON upstream error', async () => {
    const fetcher = vi.fn(async () => { throw new Error('connection reset') })
    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Qwen/Qwen3.8-27B'),
      fetcher,
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'Hugging Face is temporarily unavailable' })
  })

  it('does not reveal whether an inaccessible repository is private', async () => {
    const fetcher = vi.fn(async () => new Response('unauthorized', { status: 401 }))
    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Private/Model'),
      fetcher,
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Model not found or private' })
  })

  it('passes through the retry delay when Hugging Face rate limits requests', async () => {
    const fetcher = vi.fn(async () => new Response('slow down', {
      status: 429,
      headers: { 'Retry-After': '60' },
    }))
    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Qwen/Qwen3.8-27B'),
      fetcher,
    )

    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('60')
  })
})
