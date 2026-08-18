import { describe, expect, it, vi } from 'vitest'
import { createModelCacheKey, handleModelApi } from './index'

describe('Hugging Face model API', () => {
  it('uses an internal versioned cache key independent of the public schema query', () => {
    const key = createModelCacheKey(
      new Request('https://sizeof.ai/api/models/moonshotai/Kimi-K3?schema=2'),
    )

    expect(new URL(key.url).searchParams.get('__sizeof_cache')).toBe('hf-model-v2')
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
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('expand=downloads')
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('expand=likes')
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'https://huggingface.co/Qwen/Qwen3.8-27B/resolve/abc123/config.json',
      expect.any(Object),
    )
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
