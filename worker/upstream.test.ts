import { describe, expect, it, vi } from 'vitest'
import { fetchWithSafeRedirects } from './upstream'

describe('upstream credential boundaries', () => {
  it('retains Range but strips credentials on signed-CDN redirects', async () => {
    const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'https://cdn.example/weights?signature=test' } }))
      .mockResolvedValueOnce(new Response('ok'))
    await fetchWithSafeRedirects(fetcher, 'https://huggingface.co/org/model/resolve/rev/file', {
      headers: { Authorization: 'Bearer test', Range: 'bytes=0-100', Cookie: 'test=private' },
    })
    const headers = new Headers(fetcher.mock.calls[1][1]?.headers)
    expect(headers.get('Authorization')).toBeNull()
    expect(headers.get('Cookie')).toBeNull()
    expect(headers.get('Range')).toBe('bytes=0-100')
    expect(fetcher.mock.calls[0][1]?.redirect).toBe('manual')
  })

  it('refuses insecure redirects before sending credentials', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { Location: 'http://huggingface.co/insecure' } }))
    await expect(fetchWithSafeRedirects(fetcher, 'https://huggingface.co/org/model', {
      headers: { Authorization: 'Bearer test' },
    })).rejects.toThrow('Unsafe upstream redirect')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
