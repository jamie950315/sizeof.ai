import { afterEach, describe, expect, it, vi } from 'vitest'
import { racePrefixSearch } from './prefix-search'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('racePrefixSearch', () => {
  it('uses the first index that returns models', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('jp.example')) {
        await new Promise((resolve) => setTimeout(resolve, 40))
        return Response.json({ query: 'Q', models: [{ id: 'Qwen/Slow' }], source: 'jp', indexSize: 10 })
      }
      return Response.json({ query: 'Q', models: [{ id: 'Qwen/Fast' }], source: 'us', indexSize: 10 })
    }))

    const result = await racePrefixSearch({
      SIZEOF_SEARCH_JP_URL: 'https://jp.example',
      SIZEOF_SEARCH_US_URL: 'https://us.example',
      SIZEOF_SEARCH_TOKEN: 'secret',
    }, 'https://testnet.sizeof.ai/api/search/models?q=Q')

    expect(result.result?.source).toBe('us')
    expect(result.result?.models).toEqual([{ id: 'Qwen/Fast' }])
  })

  it('falls back when both indexes fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 502 })))
    const result = await racePrefixSearch({
      SIZEOF_SEARCH_JP_URL: 'https://jp.example',
      SIZEOF_SEARCH_US_URL: 'https://us.example',
      SIZEOF_SEARCH_TOKEN: 'secret',
    }, 'https://testnet.sizeof.ai/api/search/models?q=Q')
    expect(result.result).toBeNull()
  })
})
