import { describe, expect, it, vi } from 'vitest'
import { applyAssetCachePolicy, handleModelApi, handleWorkerRequest, readGguf, selectCommunityRepositories, selectCommunityRepository } from './index'
import { normalizeHuggingFaceModel } from '../src/lib/huggingface'

class MemoryModelCache {
  readonly values = new Map<string, string>()
  readonly options = new Map<string, KVNamespacePutOptions>()
  readonly reads: Array<{ key: string; options: unknown }> = []

  async get(key: string, options?: unknown) {
    this.reads.push({ key, options })
    const value = this.values.get(key)
    return value ? JSON.parse(value) as unknown : null
  }

  async put(key: string, value: string, options?: KVNamespacePutOptions) {
    this.values.set(key, value)
    this.options.set(key, options ?? {})
  }
}

function modelCacheContext() {
  const pending: Promise<unknown>[] = []
  return {
    ctx: {
      waitUntil(promise: Promise<unknown>) {
        pending.push(promise)
      },
    } as ExecutionContext,
    flush: () => Promise.all(pending),
  }
}

function mockSuccessfulModelFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('/api/models/Qwen/Qwen3.8-27B?')) {
      return Response.json({
        id: 'Qwen/Qwen3.8-27B',
        sha: 'abc123',
        safetensors: { total: 27_781_427_952 },
        tags: ['safetensors'],
      })
    }
    if (url.includes('/Qwen/Qwen3.8-27B/resolve/abc123/config.json')) {
      return Response.json({
        architectures: ['Qwen3_5ForCausalLM'],
        model_type: 'qwen3_5',
        num_hidden_layers: 64,
        num_key_value_heads: 4,
        head_dim: 256,
        max_position_embeddings: 262_144,
      })
    }
    if (url.includes('/Qwen/Qwen3.8-27B/tree/abc123')) return Response.json([])
    if (url.startsWith('https://huggingface.co/api/models?')) return Response.json([])
    throw new Error(`Unexpected cached-model fetch: ${url}`)
  })
}

function primePublicModel(cache: MemoryModelCache) {
  const model = normalizeHuggingFaceModel({
    id: 'Qwen/Qwen3.8-27B', sha: 'a'.repeat(40), author: 'Qwen',
    lastModified: '2026-08-30T00:00:00.000Z',
    safetensors: { parameters: { BF16: 27_000_000_000 } }, tags: ['text-generation'],
  }, {
    architectures: ['Qwen3_5ForCausalLM'], model_type: 'qwen3_5', num_hidden_layers: 64,
    num_key_value_heads: 4, head_dim: 256, max_position_embeddings: 262_144,
  })
  cache.values.set('model-response-v1:Qwen/Qwen3.8-27B', JSON.stringify({
    version: 1, fetchedAt: Date.now(), body: JSON.stringify(model),
  }))
  return model
}

describe('public estimate API, badge, and embed', () => {
  it('serves a finite provenance-rich v1 response from the shared model cache with explicit CORS', async () => {
    const cache = new MemoryModelCache()
    primePublicModel(cache)
    const { ctx } = modelCacheContext()
    const response = await handleWorkerRequest(
      new Request('https://testnet.sizeof.ai/api/v1/estimate?model=Qwen%2FQwen3.8-27B&quant=q4_k_m&context=8192&kv=q8_0&vram=32'),
      { ASSETS: { fetch: vi.fn() }, MODEL_CACHE: cache, ENVIRONMENT: 'testnet', HF_TOKEN: 'hf_secret_should_never_escape' },
      ctx,
    )
    const text = await response.text()
    const body = JSON.parse(text)

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300')
    expect(body).toMatchObject({
      schema: 'sizeof-estimate/v1', model: { id: 'Qwen/Qwen3.8-27B' },
      result: { state: 'estimate' }, provenance: { modelSource: 'https://huggingface.co/Qwen/Qwen3.8-27B' },
    })
    expect(text).not.toMatch(/NaN|Infinity|hf_secret|HF_TOKEN/)
  })

  it('handles OPTIONS and refuses invalid methods, long URLs, unknown, duplicate, and malformed inputs before lookup', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
    const cache = new MemoryModelCache()
    const { ctx } = modelCacheContext()
    const env = { ASSETS: { fetch: vi.fn() }, MODEL_CACHE: cache }
    try {
      const options = await handleWorkerRequest(new Request('https://testnet.sizeof.ai/api/v1/estimate', { method: 'OPTIONS' }), env, ctx)
      expect(options.status).toBe(204)
      expect(options.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(options.headers.get('Access-Control-Max-Age')).toBe('86400')
      expect(options.headers.get('Content-Type')).toContain('application/json')

      const requests = [
        new Request('https://testnet.sizeof.ai/api/v1/estimate?model=Qwen%2FModel', { method: 'POST' }),
        new Request(`https://testnet.sizeof.ai/api/v1/estimate?model=Qwen%2FModel&unused=${'x'.repeat(5000)}`),
        new Request('https://testnet.sizeof.ai/api/v1/estimate?model=Qwen%2FModel&destination=https%3A%2F%2Fevil.example'),
        new Request('https://testnet.sizeof.ai/api/v1/estimate?model=Qwen%2FModel&model=Other%2FModel'),
        new Request('https://testnet.sizeof.ai/api/v1/estimate?model=Qwen%2FModel&context=NaN'),
      ]
      for (const request of requests) {
        const response = await handleWorkerRequest(request, env, ctx)
        expect([400, 405, 414]).toContain(response.status)
        expect(response.headers.get('Cache-Control')).toBe('no-store')
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
        if (request.method === 'POST') expect(response.headers.get('Allow')).toBe('GET, OPTIONS')
      }
      expect(fetcher).not.toHaveBeenCalled()
    } finally {
      fetcher.mockRestore()
    }
  })

  it('retains private/not-found normalization and does not leak upstream metadata', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ private: true, secret: 'hidden' }), { status: 401 }))
    const cache = new MemoryModelCache()
    const { ctx } = modelCacheContext()
    try {
      const response = await handleWorkerRequest(
        new Request('https://testnet.sizeof.ai/api/v1/estimate?model=Private%2FModel'),
        { ASSETS: { fetch: vi.fn() }, MODEL_CACHE: cache, HF_TOKEN: 'hf_secret' }, ctx,
      )
      expect(response.status).toBe(404)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      await expect(response.json()).resolves.toEqual({ error: 'Model not found or private' })

      const badge = await handleWorkerRequest(
        new Request('https://testnet.sizeof.ai/badge/v1/estimate.svg?model=Private%2FModel'),
        { ASSETS: { fetch: vi.fn() }, MODEL_CACHE: cache, HF_TOKEN: 'hf_secret' }, ctx,
      )
      expect(await badge.text()).toContain('Private/Model')
    } finally {
      fetcher.mockRestore()
    }
  })

  it('renders bounded script-free badge and accessible embed from the same result', async () => {
    const cache = new MemoryModelCache()
    primePublicModel(cache)
    const { ctx } = modelCacheContext()
    const env = { ASSETS: { fetch: vi.fn() }, MODEL_CACHE: cache, ENVIRONMENT: 'testnet' }
    const query = 'model=Qwen%2FQwen3.8-27B&vram=32'
    const badge = await handleWorkerRequest(new Request(`https://testnet.sizeof.ai/badge/v1/estimate.svg?${query}`), env, ctx)
    const svg = await badge.text()
    expect(badge.headers.get('Content-Type')).toContain('image/svg+xml')
    expect(svg).toContain('Qwen/Qwen3.8-27B')
    expect(svg).toContain('ESTIMATE')
    expect(svg).toContain('32 GiB')
    expect(svg).not.toMatch(/<script|href=["']https?:/i)

    const embed = await handleWorkerRequest(new Request(`https://testnet.sizeof.ai/embed/v1/estimate?${query}`), env, ctx)
    const html = await embed.text()
    expect(embed.headers.get('Content-Security-Policy')).toContain("default-src 'none'")
    expect(embed.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(html).toContain('<main')
    expect(html).toContain('Estimate only.')
    expect(html).toContain('https://testnet.sizeof.ai/Qwen/Qwen3.8-27B?')
    expect(html).not.toContain('<script')
  })

  it('renders normalized badge and card errors without stack traces', async () => {
    const cache = new MemoryModelCache()
    const { ctx } = modelCacheContext()
    const env = { ASSETS: { fetch: vi.fn() }, MODEL_CACHE: cache }
    const badge = await handleWorkerRequest(new Request('https://testnet.sizeof.ai/badge/v1/estimate.svg?model=invalid'), env, ctx)
    const embed = await handleWorkerRequest(new Request('https://testnet.sizeof.ai/embed/v1/estimate?model=invalid'), env, ctx)
    expect(badge.status).toBe(400)
    expect(await badge.text()).toContain('UNAVAILABLE')
    expect(embed.status).toBe(400)
    expect(await embed.text()).toContain('Unable to create this estimate safely')
  })

  it('keeps strict embed security headers on early method and URL-length refusals', async () => {
    const cache = new MemoryModelCache()
    const { ctx } = modelCacheContext()
    const env = { ASSETS: { fetch: vi.fn() }, MODEL_CACHE: cache }
    const responses = [
      await handleWorkerRequest(new Request('https://testnet.sizeof.ai/embed/v1/estimate?model=Org%2FModel', { method: 'POST' }), env, ctx),
      await handleWorkerRequest(new Request(`https://testnet.sizeof.ai/embed/v1/estimate?model=Org%2FModel&unused=${'x'.repeat(5000)}`), env, ctx),
    ]
    expect(responses.map((response) => response.status)).toEqual([405, 414])
    for (const response of responses) {
      expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors *")
      expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    }
  })
})

describe('Hugging Face model API', () => {
  it('renders safe testnet model metadata without an upstream Hugging Face request', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
    const cache = new MemoryModelCache()
    const { ctx } = modelCacheContext()
    const assets = { fetch: vi.fn().mockResolvedValue(new Response('<!doctype html><html><head><title>sizeof.ai</title></head><body><div id="root"></div></body></html>', { headers: { 'Content-Type': 'text/html' } })) }

    try {
      const response = await handleWorkerRequest(
        new Request('https://testnet.sizeof.ai/Qwen/Model'),
        { ASSETS: assets, MODEL_CACHE: cache, ENVIRONMENT: 'testnet' },
        ctx,
      )
      const html = await response.text()

      expect(html).toContain('<title>Qwen/Model VRAM estimate | sizeof.ai</title>')
      expect(html).toContain('https://testnet.sizeof.ai/Qwen/Model')
      expect(html).toContain('application/ld+json')
      expect(response.headers.get('Cache-Control')).toBe('no-cache')
      expect(fetcher).not.toHaveBeenCalled()
    } finally {
      fetcher.mockRestore()
    }
  })

  it('keeps homepage metadata unchanged and gives compare its own escaped metadata', async () => {
    const cache = new MemoryModelCache()
    const { ctx } = modelCacheContext()
    const assets = { fetch: vi.fn(() => Promise.resolve(new Response('<html><head><title>sizeof.ai — LLM memory, measured</title></head><body></body></html>', { headers: { 'Content-Type': 'text/html' } }))) }

    const home = await handleWorkerRequest(new Request('https://sizeof.ai/'), { ASSETS: assets, MODEL_CACHE: cache }, ctx)
    const compare = await handleWorkerRequest(new Request('https://sizeof.ai/compare'), { ASSETS: assets, MODEL_CACHE: cache }, ctx)

    expect(await home.text()).toContain('<title>sizeof.ai — LLM memory, measured</title>')
    expect(await compare.text()).toContain('<title>Compare model memory estimates | sizeof.ai</title>')
  })

  it('rewrites only the testnet homepage static canonical to the testnet host', async () => {
    const cache = new MemoryModelCache()
    const { ctx } = modelCacheContext()
    const html = '<html><head><link rel="canonical" href="https://sizeof.ai/" /></head><body></body></html>'
    const assets = { fetch: vi.fn(() => Promise.resolve(new Response(html, { headers: { 'Content-Type': 'text/html' } }))) }

    const production = await handleWorkerRequest(new Request('https://sizeof.ai/'), { ASSETS: assets, MODEL_CACHE: cache }, ctx)
    const testnet = await handleWorkerRequest(new Request('https://testnet.sizeof.ai/'), { ASSETS: assets, MODEL_CACHE: cache, ENVIRONMENT: 'testnet' }, ctx)

    expect(await production.text()).toContain('<link rel="canonical" href="https://sizeof.ai/" />')
    expect(await testnet.text()).toContain('<link rel="canonical" href="https://testnet.sizeof.ai/" />')
  })

  it('serves a bounded script-free SVG share card with conservative headers', async () => {
    const cache = new MemoryModelCache()
    const { ctx } = modelCacheContext()
    const response = await handleWorkerRequest(
      new Request('https://sizeof.ai/share/card.svg?model=Qwen%2F%3Cscript%3E&config=4bit&capacity=32&total=18.5&lowerBound=1&date=2026-08-30'),
      { ASSETS: { fetch: vi.fn() }, MODEL_CACHE: cache },
      ctx,
    )

    expect(response.headers.get('Content-Type')).toContain('image/svg+xml')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Cache-Control')).toContain('max-age=300')
    await expect(response.text()).resolves.toContain('LOWER BOUND')
  })

  it('rejects incomplete or non-finite share-card parameters without rendering a zero fallback', async () => {
    const cache = new MemoryModelCache()
    const { ctx } = modelCacheContext()
    const env = { ASSETS: { fetch: vi.fn() }, MODEL_CACHE: cache }
    const missing = await handleWorkerRequest(new Request('https://sizeof.ai/share/card.svg?model=Qwen%2FExample&capacity=32'), env, ctx)
    const partial = await handleWorkerRequest(new Request(`https://sizeof.ai/share/card.svg?summary=${encodeURIComponent(JSON.stringify({ models: [{ id: 'Qwen/Example', capacityGiB: 32 }] }))}`), env, ctx)

    expect(missing.status).toBe(400)
    expect(partial.status).toBe(400)
    expect(missing.headers.get('Cache-Control')).toBe('no-store')
    await expect(missing.text()).resolves.not.toContain('<svg')
  })

  it('rejects blank or control-only required share-card text after sanitizing simple and summary inputs', async () => {
    const cache = new MemoryModelCache()
    const { ctx } = modelCacheContext()
    const env = { ASSETS: { fetch: vi.fn() }, MODEL_CACHE: cache }
    const invalidUrls = [
      'model=%20%20&config=4bit&capacity=32&total=18.5&date=2026-08-30',
      'model=Qwen%2FExample&config=%00%20&capacity=32&total=18.5&date=2026-08-30',
      'model=Qwen%2FExample&config=4bit&capacity=32&total=18.5&date=%07%20',
      `summary=${encodeURIComponent(JSON.stringify({ models: [{ id: 'Qwen/Example', configuration: '\u0000 ', capacityGiB: 32, totalGiB: 18.5 }], generatedAt: '\u0007 ' }))}`,
      `summary=${encodeURIComponent(JSON.stringify({ models: [{ id: 'Qwen/Example', configuration: '4bit', capacityGiB: 32, totalGiB: 18.5 }], generatedAt: '\u0007 ' }))}`,
    ]

    for (const query of invalidUrls) {
      const response = await handleWorkerRequest(new Request(`https://sizeof.ai/share/card.svg?${query}`), env, ctx)
      expect(response.status).toBe(400)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      await expect(response.text()).resolves.not.toContain('<svg')
    }
  })

  it('serves bounded robots and curated sitemap routes without dynamic discovery', async () => {
    const cache = new MemoryModelCache()
    const { ctx } = modelCacheContext()
    const env = { ASSETS: { fetch: vi.fn() }, MODEL_CACHE: cache, ENVIRONMENT: 'testnet' }
    const robots = await handleWorkerRequest(new Request('https://testnet.sizeof.ai/robots.txt'), env, ctx)
    const sitemap = await handleWorkerRequest(new Request('https://testnet.sizeof.ai/sitemap.xml'), env, ctx)
    const xml = await sitemap.text()

    expect(robots.headers.get('Content-Type')).toContain('text/plain')
    expect(await robots.text()).toContain('Sitemap: https://testnet.sizeof.ai/sitemap.xml')
    expect(sitemap.headers.get('Content-Type')).toContain('application/xml')
    expect(sitemap.headers.get('Cache-Control')).toContain('max-age=3600')
    expect(xml).toContain('https://testnet.sizeof.ai/compare')
    expect(xml).toContain('https://testnet.sizeof.ai/Qwen/Qwen3.8-27B')
    expect(xml).not.toContain('huggingface.co')
  })

  it('returns a compact trending model list for a submitted search', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([
      {
        id: 'Qwen/Qwen3.8-27B',
        downloads: 2_090_699,
        likes: 12_025,
        pipeline_tag: 'image-text-to-text',
        trendingScore: 2_236,
        gated: false,
        private: false,
      },
    ]))
    const cache = new MemoryModelCache()
    const { ctx } = modelCacheContext()

    try {
      const response = await handleWorkerRequest(
        new Request('https://sizeof.ai/api/search/models?q=QWEN'),
        { ASSETS: { fetch: vi.fn() }, MODEL_CACHE: cache, HF_TOKEN: 'hf_test_token' },
        ctx,
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        query: 'QWEN',
        nextCursor: null,
        models: [{
          id: 'Qwen/Qwen3.8-27B',
          owner: 'Qwen',
          name: 'Qwen3.8-27B',
          downloads: 2_090_699,
          likes: 12_025,
          task: 'image-text-to-text',
          trendingScore: 2_236,
          gated: false,
        }],
      })
      expect(fetcher).toHaveBeenCalledWith(
        'https://huggingface.co/api/models?search=QWEN&sort=trendingScore&direction=-1&limit=12',
        { headers: { Accept: 'application/json', Authorization: 'Bearer hf_test_token' } },
      )
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=60')
      expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe(
        'public, max-age=600, stale-while-revalidate=3600',
      )
    } finally {
      fetcher.mockRestore()
    }
  })

  it('prioritizes exact repositories, exact names, and matching authors', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([
      { id: 'Community/QWEN-extra', downloads: 900, trendingScore: 90, private: false },
      { id: 'Qwen/QWEN-extra', downloads: 100, trendingScore: 10, private: false },
      { id: 'Community/QWEN', downloads: 500, trendingScore: 50, private: false },
      { id: 'QWEN/QWEN', downloads: 1, trendingScore: 1, private: false },
    ]))
    const cache = new MemoryModelCache()
    const { ctx } = modelCacheContext()

    try {
      const response = await handleWorkerRequest(
        new Request('https://sizeof.ai/api/search/models?q=QWEN'),
        { ASSETS: { fetch: vi.fn() }, MODEL_CACHE: cache },
        ctx,
      )
      const body = await response.json() as { models: Array<{ id: string }> }

      expect(body.models.map((model) => model.id)).toEqual([
        'QWEN/QWEN',
        'Community/QWEN',
        'Qwen/QWEN-extra',
        'Community/QWEN-extra',
      ])
    } finally {
      fetcher.mockRestore()
    }
  })

  it('forwards author and model type filters and returns the next cursor', async () => {
    const nextCursor = 'eyIkb3IiOlt7InRyZW5kaW5nU2NvcmUiOjE3fV19='
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', {
      headers: {
        'Content-Type': 'application/json',
        Link: `<https://huggingface.co/api/models?search=QWEN&author=Qwen&filter=text-generation&limit=12&cursor=${encodeURIComponent(nextCursor)}>; rel="next"`,
      },
    }))
    const cache = new MemoryModelCache()
    const { ctx } = modelCacheContext()

    try {
      const response = await handleWorkerRequest(
        new Request('https://sizeof.ai/api/search/models?q=QWEN&author=Qwen&type=text-generation'),
        { ASSETS: { fetch: vi.fn() }, MODEL_CACHE: cache },
        ctx,
      )

      await expect(response.json()).resolves.toMatchObject({ nextCursor })
      expect(fetcher).toHaveBeenCalledWith(
        'https://huggingface.co/api/models?search=QWEN&sort=trendingScore&direction=-1&limit=12&author=Qwen&filter=text-generation',
        { headers: { Accept: 'application/json' } },
      )
    } finally {
      fetcher.mockRestore()
    }
  })

  it('matches the selected model type against pipeline_tag instead of loose tags', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([
      { id: 'Qwen/Qwen3-8B', pipeline_tag: 'text-generation', tags: ['text-generation'], private: false },
      {
        id: 'Qwen/Qwen3-Embedding-8B',
        pipeline_tag: 'feature-extraction',
        tags: ['text-generation', 'feature-extraction'],
        private: false,
      },
    ]))
    const cache = new MemoryModelCache()
    const { ctx } = modelCacheContext()

    try {
      const response = await handleWorkerRequest(
        new Request('https://sizeof.ai/api/search/models?q=QWEN&type=text-generation'),
        { ASSETS: { fetch: vi.fn() }, MODEL_CACHE: cache },
        ctx,
      )
      const body = await response.json() as { models: Array<{ id: string }> }

      expect(body.models.map((model) => model.id)).toEqual(['Qwen/Qwen3-8B'])
    } finally {
      fetcher.mockRestore()
    }
  })

  it('uses an opaque cursor for the next page', async () => {
    const cursor = 'eyIkb3IiOlt7Il9pZCI6eyIkZ3QiOiJhYmMifX1dfQ=='
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([]))
    const cache = new MemoryModelCache()
    const { ctx } = modelCacheContext()

    try {
      await handleWorkerRequest(
        new Request(`https://sizeof.ai/api/search/models?q=QWEN&cursor=${encodeURIComponent(cursor)}`),
        { ASSETS: { fetch: vi.fn() }, MODEL_CACHE: cache },
        ctx,
      )

      expect(fetcher).toHaveBeenCalledWith(
        `https://huggingface.co/api/models?search=QWEN&sort=trendingScore&direction=-1&limit=12&cursor=${encodeURIComponent(cursor)}`,
        { headers: { Accept: 'application/json' } },
      )
    } finally {
      fetcher.mockRestore()
    }
  })

  it.each([
    ['type', 'not-a-real-task'],
    ['author', 'invalid author!'],
    ['cursor', 'not a cursor'],
  ])('rejects an invalid %s filter without contacting Hugging Face', async (key, value) => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
    const cache = new MemoryModelCache()
    const { ctx } = modelCacheContext()

    try {
      const response = await handleWorkerRequest(
        new Request(`https://sizeof.ai/api/search/models?q=QWEN&${key}=${encodeURIComponent(value)}`),
        { ASSETS: { fetch: vi.fn() }, MODEL_CACHE: cache },
        ctx,
      )

      expect(response.status).toBe(400)
      expect(fetcher).not.toHaveBeenCalled()
    } finally {
      fetcher.mockRestore()
    }
  })

  it('rejects a search shorter than two characters without contacting Hugging Face', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
    const cache = new MemoryModelCache()
    const { ctx } = modelCacheContext()

    try {
      const response = await handleWorkerRequest(
        new Request('https://sizeof.ai/api/search/models?q=Q'),
        { ASSETS: { fetch: vi.fn() }, MODEL_CACHE: cache },
        ctx,
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'Search query must contain between 2 and 80 characters',
      })
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(fetcher).not.toHaveBeenCalled()
    } finally {
      fetcher.mockRestore()
    }
  })

  it('limits the search response even when Hugging Face returns too many models', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(
      Array.from({ length: 13 }, (_, index) => ({
        id: `Org/Model-${index + 1}`,
        downloads: 100 - index,
        likes: index,
        pipeline_tag: 'text-generation',
        trendingScore: 100 - index,
        gated: false,
        private: false,
      })),
    ))
    const cache = new MemoryModelCache()
    const { ctx } = modelCacheContext()

    try {
      const response = await handleWorkerRequest(
        new Request('https://sizeof.ai/api/search/models?q=Model'),
        { ASSETS: { fetch: vi.fn() }, MODEL_CACHE: cache },
        ctx,
      )
      const body = await response.json() as { models: Array<{ id: string }> }

      expect(body.models).toHaveLength(12)
      expect(body.models.at(-1)?.id).toBe('Org/Model-12')
    } finally {
      fetcher.mockRestore()
    }
  })

  it('only exposes search models explicitly marked public', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([
      { id: 'Org/Public', private: false },
      { id: 'Org/Private', private: true },
      { id: 'Org/Unknown' },
    ]))
    const cache = new MemoryModelCache()
    const { ctx } = modelCacheContext()

    try {
      const response = await handleWorkerRequest(
        new Request('https://sizeof.ai/api/search/models?q=Org'),
        { ASSETS: { fetch: vi.fn() }, MODEL_CACHE: cache, HF_TOKEN: 'hf_test_token' },
        ctx,
      )
      const body = await response.json() as { models: Array<{ id: string }> }

      expect(body.models.map((model) => model.id)).toEqual(['Org/Public'])
    } finally {
      fetcher.mockRestore()
    }
  })

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

  it('prevents Workers Caching from storing API errors', async () => {
    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/invalid'),
    )

    expect(response.status).toBe(400)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe('no-store')
  })

  it('rejects a private repository even when the token can read it', async () => {
    const fetcher = vi.fn(async () => Response.json({
      id: 'jamie950315/private-model',
      sha: 'private123',
      private: true,
      tags: ['safetensors'],
      safetensors: { total: 1_000_000 },
    }))

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/jamie950315/private-model'),
      fetcher,
      readGguf,
      'hf_test_token',
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Model not found or private' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('serves a fresh model from KV without calling Hugging Face', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-22T12:00:00Z'))
    const cache = new MemoryModelCache()
    cache.values.set('model-response-v1:Qwen/Qwen3.8-27B', JSON.stringify({
      version: 1,
      fetchedAt: Date.now() - 23 * 60 * 60 * 1_000,
      body: JSON.stringify({ id: 'Qwen/Qwen3.8-27B', source: 'kv' }),
    }))
    const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Hugging Face should not be called'))
    const { ctx } = modelCacheContext()
    const env = {
      ASSETS: { fetch: vi.fn() },
      MODEL_CACHE: cache,
      HF_TOKEN: 'hf_test_token',
    }

    try {
      const response = await handleWorkerRequest(
        new Request('https://sizeof.ai/api/models/Qwen/Qwen3.8-27B?schema=13'),
        env,
        ctx,
      )

      await expect(response.json()).resolves.toEqual({ id: 'Qwen/Qwen3.8-27B', source: 'kv' })
      expect(response.headers.get('X-Sizeof-Model-Source')).toBe('kv')
      expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe(
        'public, max-age=3600, stale-while-revalidate=604800, stale-if-error=604800',
      )
      expect(cache.reads).toEqual([{
        key: 'model-response-v1:Qwen/Qwen3.8-27B',
        options: { type: 'json', cacheTtl: 60 },
      }])
      expect(fetcher).not.toHaveBeenCalled()
    } finally {
      fetcher.mockRestore()
      vi.useRealTimers()
    }
  })

  it('writes a successful Hugging Face response to KV for 30 days', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-22T12:00:00Z'))
    const cache = new MemoryModelCache()
    const fetcher = mockSuccessfulModelFetch()
    const { ctx, flush } = modelCacheContext()
    const env = {
      ASSETS: { fetch: vi.fn() },
      MODEL_CACHE: cache,
      HF_TOKEN: 'hf_test_token',
    }

    try {
      const response = await handleWorkerRequest(
        new Request('https://sizeof.ai/api/models/Qwen/Qwen3.8-27B?schema=13'),
        env,
        ctx,
      )
      expect(response.status).toBe(200)
      expect(response.headers.get('X-Sizeof-Model-Source')).toBe('huggingface')
      expect(fetcher.mock.calls[0]?.[1]).toEqual({
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer hf_test_token',
          'User-Agent': 'sizeof.ai/1.0 (+https://sizeof.ai)',
        },
      })
      expect(fetcher.mock.calls.length).toBeGreaterThan(1)
      for (const [, init] of fetcher.mock.calls) {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer hf_test_token')
      }
      await flush()

      const key = 'model-response-v1:Qwen/Qwen3.8-27B'
      expect(JSON.parse(cache.values.get(key)!)).toMatchObject({
        version: 1,
        fetchedAt: Date.parse('2026-08-22T12:00:00Z'),
      })
      expect(cache.options.get(key)).toEqual({ expirationTtl: 2_592_000 })
    } finally {
      fetcher.mockRestore()
      vi.useRealTimers()
    }
  })

  it('serves stale KV data when Hugging Face has a transient failure', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-22T12:00:00Z'))
    const cache = new MemoryModelCache()
    cache.values.set('model-response-v1:Qwen/Qwen3.8-27B', JSON.stringify({
      version: 1,
      fetchedAt: Date.now() - 2 * 24 * 60 * 60 * 1_000,
      body: JSON.stringify({ id: 'Qwen/Qwen3.8-27B', source: 'stale-kv' }),
    }))
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 500 }),
    )
    const { ctx } = modelCacheContext()
    const env = {
      ASSETS: { fetch: vi.fn() },
      MODEL_CACHE: cache,
    }

    try {
      const response = await handleWorkerRequest(
        new Request('https://sizeof.ai/api/models/Qwen/Qwen3.8-27B?schema=13'),
        env,
        ctx,
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ id: 'Qwen/Qwen3.8-27B', source: 'stale-kv' })
      expect(response.headers.get('X-Sizeof-Model-Source')).toBe('kv-stale')
      expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe(
        'public, max-age=0, stale-while-revalidate=60, stale-if-error=518400',
      )
    } finally {
      fetcher.mockRestore()
      vi.useRealTimers()
    }
  })

  it('does not serve stale KV data when a model is private or missing', async () => {
    const cache = new MemoryModelCache()
    cache.values.set('model-response-v1:Qwen/Qwen3.8-27B', JSON.stringify({
      version: 1,
      fetchedAt: Date.now() - 2 * 24 * 60 * 60 * 1_000,
      body: JSON.stringify({ id: 'Qwen/Qwen3.8-27B', source: 'stale-kv' }),
    }))
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 404 }),
    )
    const { ctx } = modelCacheContext()
    const env = {
      ASSETS: { fetch: vi.fn() },
      MODEL_CACHE: cache,
    }

    try {
      const response = await handleWorkerRequest(
        new Request('https://sizeof.ai/api/models/Qwen/Qwen3.8-27B?schema=13'),
        env,
        ctx,
      )

      expect(response.status).toBe(404)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(response.headers.get('X-Sizeof-Model-Source')).toBeNull()
      expect(cache.options.size).toBe(0)
    } finally {
      fetcher.mockRestore()
    }
  })

  it('does not serve KV data older than the eight-day fallback window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-22T12:00:00Z'))
    const cache = new MemoryModelCache()
    cache.values.set('model-response-v1:Qwen/Qwen3.8-27B', JSON.stringify({
      version: 1,
      fetchedAt: Date.now() - 8 * 24 * 60 * 60 * 1_000,
      body: JSON.stringify({ id: 'Qwen/Qwen3.8-27B', source: 'expired-kv' }),
    }))
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 500 }),
    )
    const { ctx } = modelCacheContext()
    const env = {
      ASSETS: { fetch: vi.fn() },
      MODEL_CACHE: cache,
    }

    try {
      const response = await handleWorkerRequest(
        new Request('https://sizeof.ai/api/models/Qwen/Qwen3.8-27B?schema=13'),
        env,
        ctx,
      )
      expect(response.status).toBe(502)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    } finally {
      fetcher.mockRestore()
      vi.useRealTimers()
    }
  })

  it('refreshes stale KV data after a successful Hugging Face lookup', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-22T12:00:00Z'))
    const key = 'model-response-v1:Qwen/Qwen3.8-27B'
    const cache = new MemoryModelCache()
    cache.values.set(key, JSON.stringify({
      version: 1,
      fetchedAt: Date.now() - 2 * 24 * 60 * 60 * 1_000,
      body: JSON.stringify({ id: 'Qwen/Qwen3.8-27B', source: 'stale-kv' }),
    }))
    const fetcher = mockSuccessfulModelFetch()
    const { ctx, flush } = modelCacheContext()
    const env = {
      ASSETS: { fetch: vi.fn() },
      MODEL_CACHE: cache,
    }

    try {
      const response = await handleWorkerRequest(
        new Request('https://sizeof.ai/api/models/Qwen/Qwen3.8-27B?schema=refresh'),
        env,
        ctx,
      )
      expect(response.status).toBe(200)
      expect(response.headers.get('X-Sizeof-Model-Source')).toBe('huggingface')
      await flush()

      const refreshed = JSON.parse(cache.values.get(key)!) as { fetchedAt: number; body: string }
      expect(refreshed.fetchedAt).toBe(Date.parse('2026-08-22T12:00:00Z'))
      expect(JSON.parse(refreshed.body)).not.toHaveProperty('source', 'stale-kv')
    } finally {
      fetcher.mockRestore()
      vi.useRealTimers()
    }
  })

  it('keeps a successful response available when the KV write fails', async () => {
    class RejectingModelCache extends MemoryModelCache {
      override async put() {
        throw new Error('KV write quota exceeded')
      }
    }
    const cache = new RejectingModelCache()
    const fetcher = mockSuccessfulModelFetch()
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { ctx, flush } = modelCacheContext()
    const env = {
      ASSETS: { fetch: vi.fn() },
      MODEL_CACHE: cache,
    }

    try {
      const response = await handleWorkerRequest(
        new Request('https://sizeof.ai/api/models/Qwen/Qwen3.8-27B?schema=13'),
        env,
        ctx,
      )
      expect(response.status).toBe(200)
      await expect(response.clone().json()).resolves.toMatchObject({ id: 'Qwen/Qwen3.8-27B' })
      await expect(flush()).resolves.toBeDefined()
    } finally {
      fetcher.mockRestore()
      errorLog.mockRestore()
    }
  })

  it('does not read KV for an invalid model route', async () => {
    const cache = new MemoryModelCache()
    const { ctx } = modelCacheContext()
    const env = {
      ASSETS: { fetch: vi.fn() },
      MODEL_CACHE: cache,
    }

    const response = await handleWorkerRequest(
      new Request('https://sizeof.ai/api/models/invalid'),
      env,
      ctx,
    )

    expect(response.status).toBe(400)
    expect(cache.reads).toEqual([])
  })

  it('uses the same model key for different API query strings', async () => {
    const cache = new MemoryModelCache()
    cache.values.set('model-response-v1:Qwen/Qwen3.8-27B', JSON.stringify({
      version: 1,
      fetchedAt: Date.now(),
      body: JSON.stringify({ id: 'Qwen/Qwen3.8-27B', source: 'kv' }),
    }))
    const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Hugging Face should not be called'))
    const { ctx } = modelCacheContext()
    const env = {
      ASSETS: { fetch: vi.fn() },
      MODEL_CACHE: cache,
    }

    try {
      const first = await handleWorkerRequest(
        new Request('https://sizeof.ai/api/models/Qwen/Qwen3.8-27B?schema=13&probe=one'),
        env,
        ctx,
      )
      const second = await handleWorkerRequest(
        new Request('https://sizeof.ai/api/models/Qwen/Qwen3.8-27B?schema=13&probe=two'),
        env,
        ctx,
      )

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(cache.reads.map((read) => read.key)).toEqual([
        'model-response-v1:Qwen/Qwen3.8-27B',
        'model-response-v1:Qwen/Qwen3.8-27B',
      ])
      expect(fetcher).not.toHaveBeenCalled()
    } finally {
      fetcher.mockRestore()
    }
  })

  it('does not offer speculative draft repositories as ordinary community quantizations', () => {
    expect(selectCommunityRepositories([
      {
        id: 'z-lab/Qwen3.8-27B-DFlash2-GGUF', author: 'z-lab', sha: 'a'.repeat(40),
        tags: ['gguf', 'draft-model', 'speculative-decoding', 'base_model:quantized:Qwen/Qwen3.8-27B'],
      },
      {
        id: 'unsloth/Qwen3.8-27B-DFlash2-GGUF', author: 'unsloth', sha: 'b'.repeat(40),
        tags: ['gguf', 'draft-model', 'speculative-decoding', 'base_model:quantized:Qwen/Qwen3.8-27B'],
      },
    ], 'Qwen/Qwen3.8-27B')).toEqual([])
  })

  it('does not offer private repositories as community quantizations', () => {
    expect(selectCommunityRepositories([{
      id: 'unsloth/Private-Model-GGUF', author: 'unsloth', sha: 'a'.repeat(40), private: true,
      tags: ['gguf', 'base_model:quantized:Org/Model'], siblings: [],
    }], 'Org/Model')).toEqual([])
  })

  it('does not exclude a normal quantization only because its repository name contains Eagle', () => {
    expect(selectCommunityRepositories([{
      id: 'unsloth/Eagle-7B-GGUF', author: 'unsloth', sha: 'a'.repeat(40),
      tags: ['gguf', 'base_model:quantized:Example/Eagle-7B'], siblings: [],
    }], 'Example/Eagle-7B')).toHaveLength(1)
  })

  it('excludes a DFlash repository token even when draft tags are missing', () => {
    expect(selectCommunityRepositories([{
      id: 'unsloth/Qwen-DFlash-GGUF', author: 'unsloth', sha: 'a'.repeat(40),
      tags: ['gguf', 'base_model:quantized:Qwen/Qwen-Target'], siblings: [],
    }], 'Qwen/Qwen-Target')).toEqual([])
  })

  it('prioritizes a verified unsloth quantization over other community derivatives', () => {
    const selected = selectCommunityRepository([
      {
        id: 'someone/Qwen3.8-27B-GGUF', author: 'someone', sha: 'a'.repeat(40),
        tags: ['gguf', 'base_model:quantized:Qwen/Qwen3.8-27B'],
      },
      {
        id: 'unsloth/Qwen3.8-27B-GGUF', author: 'unsloth', sha: 'b'.repeat(40),
        tags: ['gguf', 'base_model:Qwen/Qwen3.8-27B', 'base_model:quantized:Qwen/Qwen3.8-27B'],
      },
      {
        id: 'unsloth/Qwen3.8-Other-GGUF', author: 'unsloth', sha: 'c'.repeat(40),
        tags: ['gguf', 'base_model:quantized:Qwen/Other'],
      },
    ], 'Qwen/Qwen3.8-27B')

    expect(selected?.id).toBe('unsloth/Qwen3.8-27B-GGUF')
  })

  it('selects verified repositories from multiple trusted publishers with per-publisher limits', () => {
    const selected = selectCommunityRepositories([
      { id: 'unsloth/Model-GGUF', author: 'unsloth', sha: 'a'.repeat(40), tags: ['gguf', 'base_model:quantized:Org/Model'] },
      { id: 'unsloth/Model-NVFP4', author: 'unsloth', sha: 'b'.repeat(40), tags: ['base_model:quantized:Org/Model'] },
      { id: 'bartowski/Model-GGUF', author: 'bartowski', sha: 'c'.repeat(40), tags: ['gguf', 'base_model:quantized:Org/Model'] },
      { id: 'lmstudio-community/Model-GGUF', author: 'lmstudio-community', sha: '1'.repeat(40), tags: ['gguf', 'base_model:quantized:Org/Model'] },
      { id: 'mlx-community/Model-MTP-4bit', author: 'mlx-community', sha: 'f'.repeat(40), tags: ['mlx', '4-bit', 'base_model:quantized:Org/Model'] },
      { id: 'mlx-community/Model-4bit', author: 'mlx-community', sha: 'd'.repeat(40), tags: ['mlx', '4-bit', 'base_model:quantized:Org/Model'] },
      { id: 'mradermacher/Model-GGUF', author: 'mradermacher', sha: '2'.repeat(40), tags: ['gguf', 'base_model:quantized:Org/Model'] },
      { id: 'unknown/Model-GGUF', author: 'unknown', sha: 'e'.repeat(40), tags: ['gguf', 'base_model:quantized:Org/Model'] },
    ], 'Org/Model')

    expect(selected.map((repo) => repo.id)).toEqual([
      'unsloth/Model-GGUF',
      'unsloth/Model-NVFP4',
      'lmstudio-community/Model-GGUF',
      'mlx-community/Model-4bit',
      'bartowski/Model-GGUF',
    ])
  })

  it('returns actual files from the highest-priority verified community quantization', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/models/Qwen/Qwen3.8-27B?')) {
        return Response.json({
          id: 'Qwen/Qwen3.8-27B', author: 'Qwen', sha: 'official123',
          safetensors: { total: 27_781_427_952 }, tags: ['safetensors'],
        })
      }
      if (url.includes('/Qwen/Qwen3.8-27B/resolve/official123/config.json')) {
        return Response.json({
          architectures: ['Qwen3_5ForCausalLM'], model_type: 'qwen3_5', num_hidden_layers: 64,
          num_key_value_heads: 4, head_dim: 256, max_position_embeddings: 262_144,
        })
      }
      if (url.includes('/Qwen/Qwen3.8-27B/tree/official123')) return Response.json([])
      if (url.startsWith('https://huggingface.co/api/models?')) {
        return Response.json([{
          id: 'unsloth/Qwen3.8-27B-GGUF', author: 'unsloth', sha: 'b'.repeat(40),
          tags: ['gguf', 'base_model:quantized:Qwen/Qwen3.8-27B'], siblings: [],
        }])
      }
      if (url.includes(`/unsloth/Qwen3.8-27B-GGUF/tree/${'b'.repeat(40)}`)) {
        return Response.json([
          { type: 'file', path: 'Qwen3.8-27B-Q4_K_M.gguf', size: 16_000_000_000 },
          { type: 'file', path: 'MTP/mtp-Qwen3.8-27B-Q4_0.gguf', size: 1_300_000_000 },
        ])
      }
      throw new Error(`Unexpected community fetch: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Qwen/Qwen3.8-27B'),
      fetcher,
    )
    const body = await response.json() as { variants: Array<Record<string, unknown>> }

    expect(response.status).toBe(200)
    expect(body.variants).toEqual([expect.objectContaining({
      label: 'GGUF Q4_K_M', provenance: 'community', publisher: 'unsloth',
      repositoryId: 'unsloth/Qwen3.8-27B-GGUF', weightSizeBytes: 16_000_000_000,
      sourceUrl: 'https://huggingface.co/unsloth/Qwen3.8-27B-GGUF',
    })])
  })

  it('calls the GGUF Range fetcher without an illegal method binding', async () => {
    const buffer = new ArrayBuffer(24)
    const bytes = new Uint8Array(buffer)
    bytes.set(new TextEncoder().encode('GGUF'))
    const view = new DataView(buffer)
    view.setUint32(4, 3, true)
    const fetcher = async function (this: unknown) {
      if (this !== undefined) throw new Error('Illegal invocation')
      return new Response(buffer, {
        status: 206,
        headers: { 'Content-Length': String(buffer.byteLength) },
      })
    }

    await expect(readGguf('https://huggingface.co/model.gguf', {
      fetch: fetcher,
      additionalFetchHeaders: {},
    })).resolves.toEqual({ metadata: {}, parameterCount: null })
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
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300')
    expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe(
      'public, max-age=86400, stale-while-revalidate=604800, stale-if-error=604800',
    )
    expect(body.id).toBe('Qwen/Qwen3.8-27B')
    expect(body.spec.attentionLayers).toBe(32)
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
          architectures: ['Qwen3_5ForCausalLM'],
          model_type: 'qwen3_5',
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

  it('returns the verified Tiny VAE preview-decoder weight profile', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/models/Kijai/MiniMax-H3-TAE')) {
        return Response.json({
          id: 'Kijai/MiniMax-H3-TAE',
          sha: 'a213ac8bf2f148b4f32372279a7f207846978900',
          tags: [],
          siblings: [{ rfilename: 'vae_approx/taeh3.safetensors' }],
          usedStorage: 9_791_388,
        })
      }
      if (url.includes('/Kijai/MiniMax-H3-TAE/resolve/')) return new Response(null, { status: 404 })
      if (url.includes('/Kijai/MiniMax-H3-TAE/tree/')) return Response.json([])
      throw new Error(`Unexpected Tiny VAE fetch: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Kijai/MiniMax-H3-TAE'),
      fetcher,
    )
    const body = await response.json() as {
      modelKind: string
      spec: unknown
      resourceEstimate: {
        kind: string
        baseModelId: string | null
        options: Array<{ components: Array<{ path: string; sizeBytes: number }> }>
      }
    }

    expect(response.status).toBe(200)
    expect(body.modelKind).toBe('video')
    expect(body.spec).toBeNull()
    expect(body.resourceEstimate).toMatchObject({
      kind: 'preview-decoder',
      baseModelId: null,
      options: [{ components: [{ path: 'vae_approx/taeh3.safetensors', sizeBytes: 9_791_388 }] }],
    })
  })

  it('uses the Hugging Face canonical id when resolving a curated resource profile', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/kijai/MiniMax-H3-TAE/tree/')) return Response.json([])
      if (url.includes('/api/models/kijai/MiniMax-H3-TAE')) {
        return Response.json({
          id: 'Kijai/MiniMax-H3-TAE',
          sha: 'a213ac8bf2f148b4f32372279a7f207846978900',
          tags: [],
        })
      }
      if (url.includes('/kijai/MiniMax-H3-TAE/resolve/')) return new Response(null, { status: 404 })
      throw new Error(`Unexpected canonical-id fetch: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/kijai/MiniMax-H3-TAE'),
      fetcher,
    )
    const body = await response.json() as { resourceEstimate: { kind: string } | null }

    expect(response.status).toBe(200)
    expect(body.resourceEstimate?.kind).toBe('preview-decoder')
  })

  it('keeps explicitly tagged workflows out of modality weight estimates', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/Example/Workflow/tree/workflow123')) return Response.json([])
      if (url.includes('/api/models/Example/Workflow')) {
        return Response.json({
          id: 'Example/Workflow',
          sha: 'workflow123',
          pipeline_tag: 'text-to-video',
          tags: ['comfyui', 'workflow', 'text-to-video'],
          safetensors: { parameters: { BF16: 5_000_000 } },
        })
      }
      if (url.includes('/Example/Workflow/resolve/workflow123/config.json')) {
        return new Response(null, { status: 404 })
      }
      throw new Error(`Unexpected workflow fetch: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Example/Workflow'),
      fetcher,
    )
    const body = await response.json() as {
      modelKind: string
      spec: unknown
      resourceEstimate: unknown
      estimateReason: string | null
    }

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      modelKind: 'workflow',
      spec: null,
      resourceEstimate: null,
      estimateReason: 'workflow-artifact',
    })
  })

  it('adds a declared base model to a VAE static-weight estimate without KV cache', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/models/Example/Video-VAE')) {
        return Response.json({
          id: 'Example/Video-VAE',
          sha: 'derived123',
          pipeline_tag: 'image-to-image',
          tags: ['vae', 'base_model:Example/Base'],
          safetensors: { parameters: { F16: 1_000 } },
        })
      }
      if (url.includes('/Example/Video-VAE/resolve/derived123/config.json')) {
        return Response.json({ architectures: ['AutoencoderKL'], model_type: 'autoencoder_kl' })
      }
      if (url.includes('/Example/Video-VAE/tree/derived123')) return Response.json([])
      if (url.includes('/api/models/Example/Base')) {
        return Response.json({
          id: 'Example/Base',
          sha: 'base456',
          safetensors: { parameters: { BF16: 8_000_000 } },
        })
      }
      throw new Error(`Unexpected declared-VAE-base fetch: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Example/Video-VAE'),
      fetcher,
    )
    const body = await response.json() as {
      spec: unknown
      resourceEstimate: {
        kind: string
        baseModelId: string | null
        options: Array<{ components: Array<{ label: string; sizeBytes: number }> }>
      }
    }

    expect(response.status).toBe(200)
    expect(body.spec).toBeNull()
    expect(body.resourceEstimate).toMatchObject({
      kind: 'vae',
      baseModelId: 'Example/Base',
      options: [{ components: [
        { label: 'Declared base weights', sizeBytes: 16_000_000 },
        { label: 'VAE weights', sizeBytes: 2_000 },
      ] }],
    })
  })

  it('does not include a private declared base in a public VAE estimate', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/models/Example/Private-Base-VAE')) return Response.json({
        id: 'Example/Private-Base-VAE', sha: 'derived123', pipeline_tag: 'image-to-image',
        tags: ['vae', 'base_model:Example/Private-Base'],
        safetensors: { parameters: { F16: 1_000 } },
      })
      if (url.includes('/Example/Private-Base-VAE/resolve/derived123/config.json')) {
        return Response.json({ architectures: ['AutoencoderKL'], model_type: 'autoencoder_kl' })
      }
      if (url.includes('/Example/Private-Base-VAE/tree/derived123')) return Response.json([])
      if (url.includes('/api/models/Example/Private-Base')) return Response.json({
        id: 'Example/Private-Base', sha: 'base456', private: true,
        safetensors: { parameters: { BF16: 8_000_000 } },
      })
      throw new Error(`Unexpected private VAE base fetch: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Example/Private-Base-VAE'),
      fetcher,
      readGguf,
      'hf_test_token',
    )
    const body = await response.json() as {
      resourceEstimate: { baseModelId: string | null; options: Array<{ components: Array<{ id: string }> }> }
    }

    expect(response.status).toBe(200)
    expect(body.resourceEstimate).toMatchObject({
      baseModelId: null,
      options: [{ components: [{ id: 'vae-weights' }] }],
    })
  })

  it('accepts a declared VAE base whose canonical metadata only differs by casing', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/Example/Case-VAE/tree/derivedcase')) return Response.json([])
      if (url.includes('/api/models/Example/Case-VAE')) {
        return Response.json({
          id: 'Example/Case-VAE',
          sha: 'derivedcase',
          pipeline_tag: 'image-to-image',
          tags: ['vae', 'base_model:example/Base'],
          safetensors: { parameters: { F16: 1_000 } },
        })
      }
      if (url.includes('/Example/Case-VAE/resolve/derivedcase/config.json')) {
        return Response.json({ architectures: ['AutoencoderKL'], model_type: 'autoencoder_kl' })
      }
      if (url.includes('/api/models/example/Base')) {
        return Response.json({
          id: 'Example/Base',
          sha: 'basecase',
          safetensors: { parameters: { BF16: 8_000_000 } },
        })
      }
      throw new Error(`Unexpected canonical-VAE-base fetch: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Example/Case-VAE'),
      fetcher,
    )
    const body = await response.json() as {
      resourceEstimate: { baseModelId: string | null; options: Array<{ components: Array<{ sizeBytes: number }> }> }
    }

    expect(response.status).toBe(200)
    expect(body.resourceEstimate).toMatchObject({
      baseModelId: 'Example/Base',
      options: [{ components: [{ sizeBytes: 16_000_000 }, { sizeBytes: 2_000 }] }],
    })
  })

  it('uses a single published VAE artifact when Hub tensor metadata is absent', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/Example/File-VAE/tree/filevae123')) {
        return Response.json([{ type: 'file', path: 'vae/model.safetensors', size: 2_400 }])
      }
      if (url.includes('/api/models/Example/File-VAE')) {
        return Response.json({
          id: 'Example/File-VAE',
          sha: 'filevae123',
          pipeline_tag: 'image-to-image',
          tags: ['vae'],
        })
      }
      if (url.includes('/Example/File-VAE/resolve/filevae123/config.json')) {
        return Response.json({ architectures: ['AutoencoderKL'], model_type: 'autoencoder_kl' })
      }
      throw new Error(`Unexpected VAE-artifact fetch: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Example/File-VAE'),
      fetcher,
    )
    const body = await response.json() as {
      spec: unknown
      resourceEstimate: {
        kind: string
        baseModelId: string | null
        options: Array<{ components: Array<{ label: string; path: string; sizeBytes: number }> }>
      }
    }

    expect(response.status).toBe(200)
    expect(body.spec).toBeNull()
    expect(body.resourceEstimate).toMatchObject({
      kind: 'vae',
      baseModelId: null,
      options: [{ components: [{ label: 'VAE weight file', path: 'vae/model.safetensors', sizeBytes: 2_400 }] }],
    })
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

  it('does not inherit architecture facts from a private base model', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/models/Example/Public-GGUF')) return Response.json({
        id: 'Example/Public-GGUF', sha: 'derived123',
        tags: ['gguf', 'base_model:Example/Private-Base', 'base_model:quantized:Example/Private-Base'],
        gguf: { total: 7_000_000_000, context_length: 131072 },
      })
      if (url.includes('/Example/Public-GGUF/resolve/derived123/config.json')) return Response.json({})
      if (url.includes('/api/models/Example/Private-Base')) return Response.json({
        id: 'Example/Private-Base', sha: 'base456', private: true,
        safetensors: { total: 14_000_000_000 },
      })
      if (url.includes('/Example/Private-Base/resolve/base456/config.json')) return Response.json({
        architectures: ['Qwen3ForCausalLM'], num_hidden_layers: 32,
        num_key_value_heads: 8, num_attention_heads: 32, head_dim: 128,
        max_position_embeddings: 131072,
      })
      throw new Error(`Unexpected private quantized base fetch: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/Example/Public-GGUF'),
      fetcher,
      readGguf,
      'hf_test_token',
    )
    const body = await response.json() as { spec: unknown; configSourceId: string | null }

    expect(response.status).toBe(200)
    expect(body.spec).toBeNull()
    expect(body.configSourceId).toBeNull()
    expect(fetcher.mock.calls.some(([input]) => (
      String(input).includes('/Example/Private-Base/resolve/')
    ))).toBe(false)
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

  it('pairs a DFlash draft with verified target weights without inventing target runtime memory', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/z-lab/Qwen3.6-35B-A3B-DFlash/tree/draft123')) {
        return Response.json([{ type: 'file', path: 'model.safetensors', size: 771_812_352 }])
      }
      if (url.includes('/api/models/z-lab/Qwen3.6-35B-A3B-DFlash')) {
        return Response.json({
          id: 'z-lab/Qwen3.6-35B-A3B-DFlash', author: 'z-lab', sha: 'draft123',
          pipeline_tag: 'text-generation',
          tags: [
            'safetensors', 'dflash', 'draft-model', 'speculative-decoding-draft',
            'base_model:Qwen/Qwen3.6-35B-A3B',
            'base_model:finetune:Qwen/Qwen3.6-35B-A3B',
          ],
          safetensors: { total: 385_906_176, parameters: { BF16: 385_906_176 } },
        })
      }
      if (url.includes('/z-lab/Qwen3.6-35B-A3B-DFlash/resolve/draft123/config.json')) {
        return Response.json({
          architectures: ['DFlashDraftModel'], model_type: 'qwen3',
          dflash_config: { block_size: 16 }, num_hidden_layers: 6,
          num_attention_heads: 32, num_key_value_heads: 8, head_dim: 128,
          max_position_embeddings: 262144, sliding_window: 4096,
          layer_types: ['sliding_attention', 'sliding_attention', 'sliding_attention', 'sliding_attention', 'sliding_attention', 'full_attention'],
        })
      }
      if (url.includes('/api/models/Qwen/Qwen3.6-35B-A3B')) {
        return Response.json({
          id: 'Qwen/Qwen3.6-35B-A3B', sha: 'target456',
          safetensors: { total: 35_951_822_704, parameters: { BF16: 35_951_822_704 } },
        })
      }
      throw new Error(`Unexpected DFlash fetch: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/z-lab/Qwen3.6-35B-A3B-DFlash'),
      fetcher,
    )
    const body = await response.json() as {
      modelKind: string
      spec: unknown
      speculative: { family: string; targetModelId: string }
      resourceEstimate: {
        kind: string
        baseModelId: string
        options: Array<{ components: Array<{ id: string; sizeBytes: number }> }>
      }
    }

    expect(response.status).toBe(200)
    expect(body.modelKind).toBe('speculative-draft')
    expect(body.spec).toBeNull()
    expect(body.speculative).toMatchObject({ family: 'dflash', targetModelId: 'Qwen/Qwen3.6-35B-A3B' })
    expect(body.resourceEstimate).toMatchObject({
      kind: 'speculative-draft',
      baseModelId: 'Qwen/Qwen3.6-35B-A3B',
      options: [{
        components: [
          { id: 'target-weights', sizeBytes: 71_903_645_408 },
          { id: 'draft-weights', sizeBytes: 771_812_352 },
        ],
      }],
    })
  })

  it('uses the canonical target id when declared target casing differs', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/z-lab/Draft/tree/draft123')) return Response.json([])
      if (url.includes('/api/models/z-lab/Draft')) return Response.json({
        id: 'z-lab/Draft', sha: 'draft123', pipeline_tag: 'text-generation',
        tags: ['dflash', 'draft-model', 'base_model:qwen/qwen-target'],
        safetensors: { parameters: { BF16: 100_000_000 }, total: 100_000_000 },
      })
      if (url.includes('/z-lab/Draft/resolve/draft123/config.json')) return Response.json({
        architectures: ['DFlashDraftModel'], dflash_config: { block_size: 8 },
      })
      if (url.toLowerCase().includes('/api/models/qwen/qwen-target')) return Response.json({
        id: 'Qwen/Qwen-Target', sha: 'target456',
        safetensors: { parameters: { BF16: 7_000_000_000 }, total: 7_000_000_000 },
      })
      throw new Error(`Unexpected fetch: ${url}`)
    })

    const response = await handleModelApi(new Request('https://sizeof.ai/api/models/z-lab/Draft'), fetcher)
    const body = await response.json() as {
      speculative: { targetModelId: string }
      resourceEstimate: { baseModelId: string } | null
    }

    expect(response.status).toBe(200)
    expect(body.speculative.targetModelId).toBe('Qwen/Qwen-Target')
    expect(body.resourceEstimate?.baseModelId).toBe('Qwen/Qwen-Target')
  })

  it('falls back to draft-only weights when the optional target lookup fails', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/z-lab/Draft/tree/draft123')) return Response.json([])
      if (url.includes('/api/models/z-lab/Draft')) return Response.json({
        id: 'z-lab/Draft', sha: 'draft123', pipeline_tag: 'text-generation',
        tags: ['dflash', 'draft-model', 'base_model:Qwen/Qwen-Target'],
        safetensors: { parameters: { BF16: 100_000_000 }, total: 100_000_000 },
      })
      if (url.includes('/z-lab/Draft/resolve/draft123/config.json')) return Response.json({
        architectures: ['DFlashDraftModel'], dflash_config: { block_size: 8 },
      })
      if (url.includes('/api/models/Qwen/Qwen-Target')) throw new Error('target unavailable')
      throw new Error(`Unexpected fetch: ${url}`)
    })

    const response = await handleModelApi(new Request('https://sizeof.ai/api/models/z-lab/Draft'), fetcher)
    const body = await response.json() as {
      modelKind: string
      resourceEstimate: { kind: string; options: Array<{ components: Array<{ id: string }> }> } | null
    }

    expect(response.status).toBe(200)
    expect(body.modelKind).toBe('speculative-draft')
    expect(body.resourceEstimate).toMatchObject({
      kind: 'speculative-draft',
      options: [{ components: [{ id: 'draft-weights' }] }],
    })
  })

  it('does not include private target weights in a public speculative profile', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/z-lab/Private-Target-Draft/tree/draft123')) return Response.json([])
      if (url.includes('/api/models/z-lab/Private-Target-Draft')) return Response.json({
        id: 'z-lab/Private-Target-Draft', sha: 'draft123', pipeline_tag: 'text-generation',
        tags: ['dflash', 'draft-model', 'base_model:Example/Private-Target'],
        safetensors: { parameters: { BF16: 100_000_000 }, total: 100_000_000 },
      })
      if (url.includes('/z-lab/Private-Target-Draft/resolve/draft123/config.json')) {
        return Response.json({ architectures: ['DFlashDraftModel'], dflash_config: { block_size: 8 } })
      }
      if (url.includes('/api/models/Example/Private-Target')) return Response.json({
        id: 'Example/Private-Target', sha: 'target456', private: true,
        safetensors: { parameters: { BF16: 7_000_000_000 }, total: 7_000_000_000 },
      })
      throw new Error(`Unexpected private speculative target fetch: ${url}`)
    })

    const response = await handleModelApi(
      new Request('https://sizeof.ai/api/models/z-lab/Private-Target-Draft'),
      fetcher,
      readGguf,
      'hf_test_token',
    )
    const body = await response.json() as {
      resourceEstimate: { options: Array<{ components: Array<{ id: string }> }> } | null
    }

    expect(response.status).toBe(200)
    expect(body.resourceEstimate).toMatchObject({
      options: [{ components: [{ id: 'draft-weights' }] }],
    })
  })

  it('uses revision-locked target safetensor artifact sizes when dtype counts are unavailable', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/z-lab/Draft/tree/draft123')) return Response.json([])
      if (url.includes('/api/models/z-lab/Draft')) return Response.json({
        id: 'z-lab/Draft', sha: 'draft123', pipeline_tag: 'text-generation',
        tags: ['dflash', 'draft-model', 'base_model:Qwen/Qwen-Target'],
        safetensors: { parameters: { BF16: 100_000_000 }, total: 100_000_000 },
      })
      if (url.includes('/z-lab/Draft/resolve/draft123/config.json')) return Response.json({
        architectures: ['DFlashDraftModel'], dflash_config: { block_size: 8 },
      })
      if (url.includes('/api/models/Qwen/Qwen-Target/tree/target456')) return Response.json([
        { type: 'file', path: 'model-00001-of-00002.safetensors', size: 4_000_000_000 },
        { type: 'file', path: 'model-00002-of-00002.safetensors', size: 3_500_000_000 },
        { type: 'file', path: 'model.safetensors.index.json', size: 10_000 },
      ])
      if (url.includes('/api/models/Qwen/Qwen-Target')) return Response.json({
        id: 'Qwen/Qwen-Target', sha: 'target456', tags: ['safetensors'],
        safetensors: { total: 7_000_000_000 },
      })
      throw new Error(`Unexpected fetch: ${url}`)
    })

    const response = await handleModelApi(new Request('https://sizeof.ai/api/models/z-lab/Draft'), fetcher)
    const body = await response.json() as {
      resourceEstimate: { options: Array<{ components: Array<{ id: string; sizeBytes: number }> }> } | null
    }

    expect(response.status).toBe(200)
    expect(body.resourceEstimate?.options[0]?.components[0]).toEqual({
      id: 'target-weights', label: 'Target model weights',
      repositoryId: 'Qwen/Qwen-Target', sizeBytes: 7_500_000_000,
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
          architectures: ['Qwen3_5ForCausalLM'], model_type: 'qwen3_5',
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
          architectures: ['Qwen3_5ForCausalLM'], model_type: 'qwen3_5',
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
          architectures: ['ExampleForCausalLM'],
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
          architectures: ['ExampleForCausalLM'],
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
