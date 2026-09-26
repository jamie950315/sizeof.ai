import { describe, expect, it, vi } from 'vitest'
import { handleWorkerRequest } from './index'

const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext

function previewEnv() {
  const upstream = vi.fn(async (request: Request) => Response.json({ proxied: new URL(request.url).pathname }))
  const assets = vi.fn(async () => new Response('<html><head><link rel="canonical" href="https://sizeof.ai/" /></head><body><div id="root"></div></body></html>', {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  }))
  return {
    upstream,
    assets,
    env: {
      ASSETS: { fetch: assets },
      ENVIRONMENT: 'testnet',
      PUBLIC_ORIGIN: 'https://testnet2.0ruka.dev',
      UPSTREAM_API: { fetch: upstream },
    } as unknown as Parameters<typeof handleWorkerRequest>[1],
  }
}

describe('preview host', () => {
  it.each(['/api/models/Qwen/Qwen3-8B', '/api/search/models?q=Qwen', '/api/status', '/badge/v1/estimate.svg', '/embed/v1/estimate'])(
    'serves %s through the upstream testnet Worker without local secrets',
    async (path) => {
      const { env, upstream, assets } = previewEnv()
      const response = await handleWorkerRequest(new Request(`https://testnet2.0ruka.dev${path}`), env, ctx)
      expect(upstream).toHaveBeenCalledTimes(1)
      expect(assets).not.toHaveBeenCalled()
      expect(await response.json()).toEqual({ proxied: path.split('?')[0] })
    },
  )

  it('keeps pages local and uses the preview origin for canonical metadata', async () => {
    const { env, upstream } = previewEnv()
    const response = await handleWorkerRequest(new Request('https://testnet2.0ruka.dev/'), env, ctx)
    expect(upstream).not.toHaveBeenCalled()
    expect(await response.text()).toContain('https://testnet2.0ruka.dev/')
  })

  it('points robots and sitemap at the preview origin', async () => {
    const { env } = previewEnv()
    const robots = await handleWorkerRequest(new Request('https://testnet2.0ruka.dev/robots.txt'), env, ctx)
    expect(await robots.text()).toContain('Sitemap: https://testnet2.0ruka.dev/sitemap.xml')
  })
})
