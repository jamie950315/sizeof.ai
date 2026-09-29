import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleServiceStatus } from './service-status'
import type { PrefixSearchEnv } from './prefix-search'

const now = Date.parse('2026-09-08T12:00:00Z')
const env: PrefixSearchEnv = { SIZEOF_SEARCH_JP_URL: 'https://jp.internal.example/private-route', SIZEOF_SEARCH_US_URL: 'https://us.internal.example', SIZEOF_SEARCH_TOKEN: 'top-secret-bearer' }
const request = () => new Request('https://testnet.sizeof.ai/api/status')
const health = (host: string, overrides: Record<string, unknown> = {}) => ({ host, ready: true, syncHealthy: true, models: 3050000, generation: 'a'.repeat(64), updatedAt: new Date(now - 3600000).toISOString(), initialBackfillComplete: true, lastFullBackfillAt: '2026-09-07T00:00:00Z', sync: { checkedAt: now / 1000, token: 'secret' }, rawError: 'internal key and stack', snapshotUrl: 'https://private.example', ...overrides })
function mockRegions(jp: Record<string, unknown> = {}, us: Record<string, unknown> = {}, status = 200) {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => Response.json(String(input).includes('jp.internal') ? health('jp', jp) : health('us', us), { status }))
  vi.stubGlobal('fetch', fetchMock); return fetchMock
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
describe('public search status projection', () => {
  it('projects only bounded public fields without origins, tokens or raw errors', async () => {
    const fetchMock = mockRegions()
    const response = await handleServiceStatus(request(), env), text = await response.text(), data = JSON.parse(text)
    expect(data.alignment).toBe('aligned'); expect(data.completeness).toBe('not-guaranteed'); expect(data.regions[0]).toMatchObject({ id: 'jp', label: 'Osaka', reachable: true, ready: true, stale: false, initialBackfillComplete: true })
    for (const forbidden of ['internal.example', 'private.example', 'top-secret', 'rawError', 'snapshotUrl', 'token', 'stack']) expect(text).not.toContain(forbidden)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(fetchMock).toHaveBeenCalledWith('https://jp.internal.example/private-route/health', expect.objectContaining({ redirect: 'manual' }))
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has('Authorization')).toBe(false)
  })
  it.each([{ generation: 'b'.repeat(64) }, { models: 3050001 }])('reports differing published state %j', async change => { mockRegions({}, change); expect((await (await handleServiceStatus(request(), env)).json<any>()).alignment).toBe('different') })
  it.each([{ generation: null }, { ready: false }])('cannot assert agreement with incomplete state %j', async change => { mockRegions({}, change); expect((await (await handleServiceStatus(request(), env)).json<any>()).alignment).toBe('unknown') })
  it('keeps serving-ready distinct from a degraded synchronization report', async () => { mockRegions({ syncHealthy: false }, {}, 503); const data = await (await handleServiceStatus(request(), env)).json<any>(); expect(data.regions[0]).toMatchObject({ reachable: true, ready: true, syncHealthy: false, error: 'reported-degraded' }); expect(data.alignment).toBe('aligned') })
  it('marks stale after eight hours and missing timestamps as unknown', async () => { mockRegions({ updatedAt: new Date(now - 8 * 3600000 - 1).toISOString() }, { updatedAt: null }); const data = await (await handleServiceStatus(request(), env)).json<any>(); expect(data.regions[0].stale).toBe(true); expect(data.regions[1].stale).toBeNull() })
  it.each([{ host: 'us' }, { generation: 'secret' }, { models: -1 }, { models: 1.5 }, { models: 100000001 }, { ready: 'true' }, { updatedAt: 'nonsense' }, { updatedAt: new Date(now + 120000).toISOString() }])('fails closed on malformed health %j', async change => { mockRegions(change); const data = await (await handleServiceStatus(request(), env)).json<any>(); expect(data.regions[0].reachable).toBe(false); expect(data.regions[0].models).toBeNull(); expect(data.alignment).toBe('unknown') })
  it('does not request missing or unsafe configured origins', async () => { const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); const data = await (await handleServiceStatus(request(), { SIZEOF_SEARCH_JP_URL: 'https://name:password@example.com', SIZEOF_SEARCH_US_URL: '' })).json<any>(); expect(fetchMock).not.toHaveBeenCalled(); expect(data.regions.map((r: { error: string }) => r.error)).toEqual(['invalid-configuration', 'not-configured']) })
  it('rejects method before upstream work', async () => { const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); const response = await handleServiceStatus(new Request(request(), { method: 'POST' }), env); expect(response.status).toBe(405); expect(fetchMock).not.toHaveBeenCalled() })
  it('cancels rejected HTTP response bodies and hides their content', async () => { const cancel = vi.fn(); vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ cancel }), { status: 302, headers: { Location: 'https://secret.example' } }))); const data = await (await handleServiceStatus(request(), env)).json<any>(); expect(cancel).toHaveBeenCalledTimes(2); expect(data.regions[0].error).toBe('http-302'); expect(JSON.stringify(data)).not.toContain('secret.example') })
  it('cancels oversized health payloads', async () => { const cancel = vi.fn(); vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ cancel }), { headers: { 'Content-Length': '32769' } }))); const data = await (await handleServiceStatus(request(), env)).json<any>(); expect(cancel).toHaveBeenCalledTimes(2); expect(data.alignment).toBe('unknown') })
  it('uses bounded abort signals and hides upstream timeout details', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort(new Error('private network timeout')))
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => { init?.signal?.throwIfAborted(); throw new Error('unexpected') }))
    const data = await (await handleServiceStatus(request(), env)).json<any>(); expect(timeout).toHaveBeenCalledWith(4000); expect(data.regions[0].error).toBe('route-unreachable-or-invalid'); expect(JSON.stringify(data)).not.toContain('private network')
  })
  it('propagates client cancellation to both pending health requests', async () => {
    const controller = new AbortController(), signals: AbortSignal[] = []
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => { const signal = init!.signal!; signals.push(signal); signal.addEventListener('abort', () => reject(signal.reason), { once: true }) })))
    const pending = handleServiceStatus(new Request(request(), { signal: controller.signal }), env)
    controller.abort(new Error('private cancellation reason'))
    const data = await (await pending).json<any>()
    expect(signals).toHaveLength(2); expect(signals.every(signal => signal.aborted)).toBe(true); expect(data.alignment).toBe('unknown'); expect(JSON.stringify(data)).not.toContain('private cancellation')
  })
})
