import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleModelApi, handleWorkerRequest, readGguf } from './index'
import { normalizeHuggingFaceModel } from '../src/lib/huggingface'

const id = 'meta-llama/Llama-3.1-8B-Instruct'
const revision = 'a'.repeat(40)
const metadata = { id, sha: revision, private: false, safetensors: { total: 8_000_000_000 }, tags: [] }
const config = { model_type: 'llama', num_hidden_layers: 32, num_attention_heads: 32,
  num_key_value_heads: 8, hidden_size: 4096, head_dim: 128, max_position_embeddings: 131072 }
const modelRequest = () => new Request(`https://testnet.sizeof.ai/api/models/${id}`)

function environment(stale = false) {
  const get = vi.fn().mockResolvedValue(stale ? {
    version: 4, fetchedAt: Date.now() - 2 * 86_400_000,
    body: JSON.stringify(normalizeHuggingFaceModel(metadata, config)),
  } : null)
  return { MODEL_CACHE: { get, put: vi.fn().mockResolvedValue(undefined) }, ASSETS: { fetch: vi.fn() } }
}
function context() {
  return {
    waitUntil: vi.fn(), passThroughOnException: vi.fn(), abort: vi.fn(), props: undefined,
    get exports(): never { throw new Error('Unexpected use of context exports') },
    get tracing(): never { throw new Error('Unexpected use of context tracing') },
  } satisfies ExecutionContext
}

afterEach(() => vi.restoreAllMocks())

describe('review: upstream failures must not look like successful estimates', () => {
  it.each([500, 404])('distinguishes unavailable target from missing target (%s)', async (status) => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/models/org/Target')) return new Response(null, { status })
      if (url.includes('/tree/')) return Response.json([])
      if (url.endsWith('/config.json')) return Response.json({ architectures: ['DFlashDraftModel'], dflash_config: { block_size: 8 } })
      return Response.json({ id: 'org/Draft', sha: revision, private: false,
        pipeline_tag: 'text-generation', tags: ['dflash', 'draft-model', 'base_model:org/Target'],
        safetensors: { parameters: { BF16: 100_000_000 }, total: 100_000_000 } })
    })
    const response = await handleModelApi(new Request('https://testnet.sizeof.ai/api/models/org/Draft'), fetcher)
    expect(response.status).toBe(status === 500 ? 502 : 200)
    if (status === 500) expect(response.headers.get('X-Sizeof-Retryable')).toBe('1')
  })

  it('rejects oversized chunked target JSON rather than hiding it as a draft-only result', async () => {
    const cancel = vi.fn()
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/models/org/Target')) return new Response(new ReadableStream<Uint8Array>({
        pull(controller) { controller.enqueue(new Uint8Array(1_000_000)) }, cancel,
      }))
      if (url.includes('/tree/')) return Response.json([])
      if (url.endsWith('/config.json')) return Response.json({ architectures: ['DFlashDraftModel'], dflash_config: { block_size: 8 } })
      return Response.json({ id: 'org/Draft', sha: revision, private: false,
        pipeline_tag: 'text-generation', tags: ['dflash', 'draft-model', 'base_model:org/Target'],
        safetensors: { parameters: { BF16: 100_000_000 }, total: 100_000_000 } })
    })
    const response = await handleModelApi(new Request('https://testnet.sizeof.ai/api/models/org/Draft'), fetcher)
    expect(response.status).toBe(502)
    expect(response.headers.get('X-Sizeof-Retryable')).toBeNull()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('rejects config 500 even for a curated model', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(metadata))
      .mockResolvedValueOnce(new Response('unavailable', { status: 500 }))
    const response = await handleModelApi(modelRequest(), fetcher)
    expect(response.status).toBe(502)
    expect(response.headers.get('X-Sizeof-Retryable')).toBe('1')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it.each(['later-page-error', 'pagination-limit', 'malformed-link'])(
    'rejects incomplete repository listing: %s', async (mode) => {
      let pages = 0
      const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input))
        if (url.pathname.endsWith('config.json')) return Response.json(config)
        if (url.pathname.includes('/tree/')) {
          pages += 1
          if (mode === 'later-page-error' && pages === 2) return new Response(null, { status: 500 })
          const link = mode === 'malformed-link' ? 'broken; rel="next"'
            : `<${url.origin}${url.pathname}?cursor=${pages}>; rel="next"`
          return Response.json([{ type: 'file', path: `model-${pages}.safetensors`, size: 100 }], { headers: { Link: link } })
        }
        return Response.json(metadata)
      })
      const response = await handleModelApi(modelRequest(), fetcher)
      expect(response.status).toBe(502)
      expect(await response.json()).toHaveProperty('error')
      expect(pages).toBe(mode === 'later-page-error' ? 2 : mode === 'pagination-limit' ? 10 : 1)
    },
  )

  it.each([false, true])('cancels oversized GGUF streams (declared=%s)', async (declared) => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(600_000)) }, cancel,
    })
    const response = new Response(stream, { headers: declared ? { 'Content-Length': '2000000' } : {} })
    await expect(readGguf('https://huggingface.co/org/repo/resolve/main/model.gguf', {
      fetch: vi.fn().mockResolvedValue(response), additionalFetchHeaders: {},
    })).rejects.toThrow()
    expect(cancel).toHaveBeenCalledOnce()
  })
})

describe('review: public validation and stale responses', () => {
  it('rejects incomplete index model rows instead of passing corrupt data to the browser', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({
      query: 'Q', source: 'jp', indexSize: 1, nextCursor: null, models: [{ id: 'Qwen/Qwen3' }],
    }))
    const response = await handleWorkerRequest(new Request('https://testnet.sizeof.ai/api/search/models?q=Q'), {
      ...environment(), SIZEOF_SEARCH_JP_URL: 'https://jp.example', SIZEOF_SEARCH_TOKEN: 'test',
    }, context())
    expect(response.status).toBe(503)
  })

  it('configured index failure is explicit and does not call Hugging Face', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, { status: 503 }))
    const response = await handleWorkerRequest(new Request('https://testnet.sizeof.ai/api/search/models?q=Q'), {
      ...environment(), SIZEOF_SEARCH_JP_URL: 'https://jp.example', SIZEOF_SEARCH_US_URL: 'https://us.example',
      SIZEOF_SEARCH_TOKEN: 'test-credential',
    }, context())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'SEARCH_INDEX_UNAVAILABLE' })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls.every(([url]) => !String(url).includes('huggingface.co'))).toBe(true)
  })

  it.each([
    ['/api/models/org/repo', 'POST', 405],
    ['/api/models/invalid', 'GET', 400],
    ['/api/search/models?q=Q', 'POST', 405],
    ['/api/search/models?q=', 'GET', 400],
    ['/api/search/models?q=Q&cursor=abc', 'GET', 400],
    ['/api/search/models?q=Q&cursor=10001', 'GET', 400],
    ['/api/v1/estimate?model=org/repo&context=NaN', 'GET', 400],
  ])('rejects %s %s before cache/network', async (path, method, status) => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
    const env = { ...environment(), SIZEOF_SEARCH_JP_URL: 'https://jp.example', SIZEOF_SEARCH_TOKEN: 'test' }
    const response = await handleWorkerRequest(new Request(`https://testnet.sizeof.ai${path}`, { method }), env, context())
    expect(response.status).toBe(status)
    expect(env.MODEL_CACHE.get).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('serves labeled stale data only for transient failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, { status: 503 }))
    const response = await handleWorkerRequest(modelRequest(), environment(true), context())
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Sizeof-Model-Source')).toBe('kv-stale')
    expect(response.headers.get('Warning')).toContain('stale')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it.each(['/api/v1/estimate', '/badge/v1/estimate.svg', '/embed/v1/estimate'])(
    'refuses a machine-consumable estimate from stale metadata on %s', async (path) => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, { status: 503 }))
      const response = await handleWorkerRequest(new Request(
        `https://testnet.sizeof.ai${path}?model=${encodeURIComponent(id)}`,
      ), environment(true), context())
      expect(response.status).toBe(503)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    },
  )

  it.each(['broken-json', 'wrong-shape', 'private'])('does not mask %s with stale success', async (mode) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => mode === 'broken-json'
      ? new Response('{bad-json') : Response.json(mode === 'private' ? { ...metadata, private: true } : []))
    const response = await handleWorkerRequest(modelRequest(), environment(true), context())
    expect(response.status).toBe(mode === 'private' ? 404 : 502)
    expect(response.headers.get('X-Sizeof-Model-Source')).not.toBe('kv-stale')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})
