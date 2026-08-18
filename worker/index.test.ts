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

    expect(new URL(key.url).searchParams.get('__sizeof_cache')).toBe('hf-model-v9')
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

  it('does not estimate a sidecar whose parameter count is implausible for its quantized base model', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/models/Lab/Qwen-MTP-GGUF')) {
        return Response.json({
          id: 'Lab/Qwen-MTP-GGUF',
          author: 'Lab',
          sha: 'derived123',
          tags: [
            'gguf',
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
      throw new Error(`Unexpected fetch: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Lab/Qwen-MTP-GGUF'),
      fetcher,
    )
    const body = await response.json() as {
      parametersB: number
      configSourceId: string | null
      spec: unknown
    }

    expect(response.status).toBe(200)
    expect(body.parametersB).toBe(0.460730096)
    expect(body.spec).toBeNull()
    expect(body.configSourceId).toBeNull()
    const baseMetadataCall = String(fetcher.mock.calls[2]?.[0])
    expect(baseMetadataCall).toContain('expand=sha')
    expect(baseMetadataCall).toContain('expand=safetensors')
    expect(fetcher).toHaveBeenCalledTimes(3)
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
    expect(fetcher).toHaveBeenCalledTimes(3)
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
    expect(fetcher).toHaveBeenCalledTimes(2)
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

  it('does not estimate packed quantized weights without a verifiable base relation', async () => {
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
      estimateReason: string
      quantizationFormat: string
      spec: unknown
    }

    expect(response.status).toBe(200)
    expect(body.quantizationFormat).toBe('auto-round-4bit')
    expect(body.estimateReason).toBe('unverified-base')
    expect(body.spec).toBeNull()
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

  it('rejects cross-version Qwen base inheritance', async () => {
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
      throw new Error(`Cross-version base should not be fetched: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Lab/Qwen3.8-27B-GGUF'),
      fetcher,
    )
    const body = await response.json() as { spec: unknown; estimateReason: string }

    expect(response.status).toBe(200)
    expect(body.spec).toBeNull()
    expect(body.estimateReason).toBe('unverified-base')
    expect(fetcher).toHaveBeenCalledTimes(2)
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
    expect(fetcher).toHaveBeenCalledTimes(3)
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
