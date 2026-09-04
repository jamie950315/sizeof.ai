import { afterEach, describe, expect, it, vi } from 'vitest'
import { racePrefixSearch, type PrefixSearchEnv } from './prefix-search'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function env(overrides: Partial<PrefixSearchEnv> = {}): PrefixSearchEnv {
  return {
    SIZEOF_SEARCH_JP_URL: 'https://jp.example',
    SIZEOF_SEARCH_US_URL: 'https://us.example',
    SIZEOF_SEARCH_TOKEN: 'secret',
    ...overrides,
  }
}

const SEARCH_REQUEST = 'https://testnet.sizeof.ai/api/search/models?q=Q'

function jsonIndex(source: string, models: unknown[], indexSize = 10) {
  return Response.json({ query: 'Q', models, source, indexSize })
}

describe('racePrefixSearch', () => {
  it('uses the first index that returns models', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('jp.example')) {
        await new Promise((resolve) => setTimeout(resolve, 40))
        return jsonIndex('jp', [{ id: 'Qwen/Slow' }])
      }
      return jsonIndex('us', [{ id: 'Qwen/Fast' }])
    }))

    const result = await racePrefixSearch(env(), SEARCH_REQUEST)

    expect(result.result?.source).toBe('us')
    expect(result.result?.models).toEqual([{ id: 'Qwen/Fast' }])
  })

  it('falls back when both indexes fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 502 })))
    const result = await racePrefixSearch(env(), SEARCH_REQUEST)
    expect(result.result).toBeNull()
    expect(result.miss).toMatch(/index 502/)
  })

  it('returns no-index-token when the bearer is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await racePrefixSearch(env({ SIZEOF_SEARCH_TOKEN: '   ' }), SEARCH_REQUEST)
    expect(result).toEqual({ result: null, miss: 'no-index-token' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns no-index-urls when both hosts are missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await racePrefixSearch(env({
      SIZEOF_SEARCH_JP_URL: '',
      SIZEOF_SEARCH_US_URL: '  ',
    }), SEARCH_REQUEST)
    expect(result).toEqual({ result: null, miss: 'no-index-urls' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats an empty index as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonIndex('jp', [], 0)))
    const result = await racePrefixSearch(env({ SIZEOF_SEARCH_US_URL: undefined }), SEARCH_REQUEST)
    expect(result.result).toBeNull()
    expect(result.miss).toMatch(/index empty/)
  })

  it('treats an unreadable payload as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ query: 'Q', models: { id: 'nope' }, source: 'jp', indexSize: 10 })))
    const result = await racePrefixSearch(env({ SIZEOF_SEARCH_US_URL: undefined }), SEARCH_REQUEST)
    expect(result.result).toBeNull()
    expect(result.miss).toMatch(/index unreadable/)
  })

  it('keeps a trailing slash off the search path', async () => {
    const fetchMock = vi.fn(async () => jsonIndex('jp', [{ id: 'Qwen/Qwen3-0.6B' }]))
    vi.stubGlobal('fetch', fetchMock)
    await racePrefixSearch(env({
      SIZEOF_SEARCH_JP_URL: 'https://jp.example/',
      SIZEOF_SEARCH_US_URL: undefined,
    }), SEARCH_REQUEST)
    expect(fetchMock).toHaveBeenCalledWith('https://jp.example/search?q=Q', expect.anything())
  })

  it('forwards author, type, and cursor query params', async () => {
    const fetchMock = vi.fn(async () => jsonIndex('jp', [{ id: 'Qwen/Qwen3-0.6B' }]))
    vi.stubGlobal('fetch', fetchMock)
    await racePrefixSearch(
      env({ SIZEOF_SEARCH_US_URL: undefined }),
      'https://testnet.sizeof.ai/api/search/models?q=Qwen&author=Qwen&type=text-generation&cursor=12',
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://jp.example/search?q=Qwen&author=Qwen&type=text-generation&cursor=12',
      expect.anything(),
    )
  })

  it('lets JP win when US returns 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('us.example')) return new Response('nope', { status: 502 })
      await new Promise((resolve) => setTimeout(resolve, 20))
      return jsonIndex('jp', [{ id: 'Qwen/JP' }])
    }))
    const result = await racePrefixSearch(env(), SEARCH_REQUEST)
    expect(result.result?.source).toBe('jp')
    expect(result.result?.models).toEqual([{ id: 'Qwen/JP' }])
  })

  it('accepts an empty page when the index is populated', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonIndex('jp', [], 3_040_000)))
    const result = await racePrefixSearch(env({ SIZEOF_SEARCH_US_URL: undefined }), SEARCH_REQUEST)
    expect(result.result).toMatchObject({ source: 'jp', models: [], indexSize: 3_040_000 })
  })

  it('treats a timeout as a miss', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise((_, reject) => {
        const abort = () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
        if (init?.signal?.aborted) abort()
        else init?.signal?.addEventListener('abort', abort, { once: true })
      })
    )))
    const pending = racePrefixSearch(env(), SEARCH_REQUEST, 25)
    await vi.advanceTimersByTimeAsync(25)
    const result = await pending
    expect(result.result).toBeNull()
    expect(result.miss).toMatch(/abort/i)
  })
})
