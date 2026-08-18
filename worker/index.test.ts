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

    expect(new URL(key.url).searchParams.get('__sizeof_cache')).toBe('hf-model-v7')
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
