// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { handleSwiftChat, SwiftChatBridge, swiftOwner, type SwiftChatBindings } from './swift-chat'

const team = 'https://swift-test.cloudflareaccess.com'
let signing: CryptoKeyPair
let jwk: JsonWebKey & { kid: string }
const bridgeFetch = vi.fn(async (_request: RequestInfo | URL, _init?: RequestInit) => Response.json({ phase: 'stopped', controller_connected: true }))
const assetsFetch = vi.fn(async (_request: Request) => new Response('<html>Swift</html>', { headers: { 'Content-Type': 'text/html' } }))
const env: SwiftChatBindings = {
  SWIFT_ACCESS_TEAM: team, SWIFT_ACCESS_AUD: 'swift-audience', SWIFT_OWNER_EMAIL: 'owner@example.com',
  SWIFT_CONTROLLER_TOKEN: 'a-private-controller-token-longer-than-32-characters',
  SWIFT_BRIDGE: { idFromName: vi.fn(() => 'owner'), get: vi.fn(() => ({ fetch: bridgeFetch })) } as unknown as DurableObjectNamespace,
  ASSETS: { fetch: assetsFetch },
}
const base64url = (bytes: Uint8Array) => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)))
async function assertion(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${encode({ alg: 'RS256', kid: 'test-key' })}.${encode({ iss: team, aud: ['swift-audience'], email: 'owner@example.com', iat: now, exp: now + 600, ...overrides })}`
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signing.privateKey, new TextEncoder().encode(unsigned))
  return `${unsigned}.${base64url(new Uint8Array(signature))}`
}
async function ownerRequest(path: string, options: RequestInit = {}) {
  return new Request(`https://sizeof.ai${path}`, { ...options, headers: {
    'Cf-Access-Jwt-Assertion': await assertion(), Origin: 'https://sizeof.ai', 'Content-Type': 'application/json',
    ...options.headers,
  } })
}
beforeAll(async () => {
  signing = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as CryptoKeyPair
  jwk = { ...await crypto.subtle.exportKey('jwk', signing.publicKey) as JsonWebKey, kid: 'test-key' }
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
    // Workers rejects redirect: 'error'; never follow a certificate redirect.
    expect(options.redirect).toBe('manual')
    return Response.json({ keys: [jwk] })
  }))
})
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers() })

describe('private Swift routes', () => {
  it('leaves every existing site route untouched', async () => {
    expect(await handleSwiftChat(new Request('https://sizeof.ai/api/status'), env)).toBeNull()
    expect(await handleSwiftChat(new Request('https://sizeof.ai/chatty'), env)).toBeNull()
  })
  it('requires a signed owner assertion even on workers.dev and static file paths', async () => {
    for (const path of ['/chat/', '/chat/index.html', '/chat/api/rpc', '/%63hat/index.html', '/chat%2findex.html']) {
      const response = await handleSwiftChat(new Request(`https://worker.workers.dev${path}`), env)
      expect(response?.status).toBe(401)
    }
    expect(assetsFetch).not.toHaveBeenCalled(); expect(bridgeFetch).not.toHaveBeenCalled()
    expect(await swiftOwner(await ownerRequest('/chat/'), env)).toBe(true)
  })
  it('rejects expired, wrong-owner, wrong-audience and wrong-issuer assertions', async () => {
    for (const overrides of [{ exp: 1 }, { email: 'other@example.com' }, { aud: ['other'] }, { iss: 'https://other.cloudflareaccess.com' }]) {
      expect(await swiftOwner(new Request('https://sizeof.ai/chat/', { headers: { 'Cf-Access-Jwt-Assertion': await assertion(overrides) } }), env)).toBe(false)
    }
    const valid = await assertion()
    const forged = valid.slice(0, -8) + 'AAAAAAAA'
    expect(await swiftOwner(new Request('https://sizeof.ai/chat/', { headers: { 'Cf-Access-Jwt-Assertion': forged } }), env)).toBe(false)
  })
  it('serves the standalone file privately with preview-safe CSP and no shared caching', async () => {
    const response = await handleSwiftChat(await ownerRequest('/chat/'), env)
    expect(await response!.text()).toContain('Swift')
    expect(assetsFetch.mock.calls[0]?.[0].url).toBe('https://sizeof.ai/chat/index.html')
    expect(response?.headers.get('Cache-Control')).toBe('no-store')
    expect(response?.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
    expect(response?.headers.get('X-Robots-Tag')).toContain('noindex')
  })
  it('maps lifecycle requests and original RPC without exposing credentials', async () => {
    const cases = [
      ['/chat/api/instance', 'GET', 'instance_status'], ['/chat/api/instance/start', 'POST', 'instance_start'],
      ['/chat/api/instance/shutdown', 'POST', 'instance_shutdown'], ['/chat/api/rpc', 'POST', 'rpc'],
    ]
    for (const [path, method, action] of cases) {
      const response = await handleSwiftChat(await ownerRequest(path, { method, ...(method === 'POST' ? { body: '{"action":"status"}' } : {}) }), env)
      expect(response?.status).toBe(200)
      const call = bridgeFetch.mock.calls.at(-1) as unknown as [string, RequestInit]
      expect(JSON.parse(call[1].body as string)).toEqual({ action, payload: method === 'POST' ? { action: 'status' } : {} })
    }
  })
  it('rejects cross-origin mutations, invalid JSON and unlisted routes before forwarding', async () => {
    expect((await handleSwiftChat(await ownerRequest('/chat/api/instance/start', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' }), env))?.status).toBe(403)
    expect((await handleSwiftChat(await ownerRequest('/chat/api/rpc', { method: 'POST', body: '[]' }), env))?.status).toBe(400)
    expect((await handleSwiftChat(await ownerRequest('/chat/api/rpc', { method: 'POST', headers: { 'Content-Length': '99999999' }, body: '{}' }), env))?.status).toBe(413)
    expect((await handleSwiftChat(await ownerRequest('/chat/api/exec', { method: 'POST', body: '{}' }), env))?.status).toBe(404)
    expect(bridgeFetch).not.toHaveBeenCalled()
  })
  it('requires the separate controller credential for the reverse connection', async () => {
    expect((await handleSwiftChat(new Request('https://sizeof.ai/_swift/controller', { headers: { Upgrade: 'websocket' } }), env))?.status).toBe(401)
    const request = new Request('https://sizeof.ai/_swift/controller', { headers: { Upgrade: 'websocket', Authorization: `Bearer ${env.SWIFT_CONTROLLER_TOKEN}` } })
    expect((await handleSwiftChat(request, env))?.status).toBe(200)
    expect(bridgeFetch).toHaveBeenCalledWith(request)
  })
})

describe('Swift controller relay', () => {
  function setup(connected = true) {
    vi.stubGlobal('WebSocketRequestResponsePair', class {})
    const socket = { readyState: 1, send: vi.fn(), close: vi.fn() } as unknown as WebSocket
    const context = { getWebSockets: () => connected ? [socket] : [], setWebSocketAutoResponse: vi.fn() } as unknown as DurableObjectState
    return { bridge: new SwiftChatBridge(context), socket }
  }
  const command = () => new Request('https://bridge/command', { method: 'POST', body: JSON.stringify({ action: 'rpc', payload: { action: 'status' } }) })
  it('reports offline as unknown, never stopped', async () => {
    const { bridge } = setup(false)
    expect(await (await bridge.fetch(command())).json()).toMatchObject({ phase: 'unknown', controller_connected: false })
  })
  it('correlates only the matching socket and request and returns no cached response', async () => {
    const { bridge, socket } = setup()
    const response = bridge.fetch(command())
    await new Promise(resolve => setTimeout(resolve, 0))
    const sent = JSON.parse((socket.send as ReturnType<typeof vi.fn>).mock.calls[0][0])
    expect(sent).toMatchObject({ action: 'rpc', payload: { action: 'status' } })
    bridge.webSocketMessage({} as WebSocket, JSON.stringify({ id: sent.id, result: { unsafe: true } }))
    bridge.webSocketMessage(socket, JSON.stringify({ id: sent.id, result: { phase: 'ready' } }))
    const result = await response
    expect(await result.json()).toEqual({ phase: 'ready' }); expect(result.headers.get('Cache-Control')).toBe('no-store')
  })
  it('reports a disconnect during a command without replaying it', async () => {
    const { bridge, socket } = setup()
    const response = bridge.fetch(command())
    await new Promise(resolve => setTimeout(resolve, 0))
    bridge.webSocketClose(socket)
    expect((await response).status).toBe(503)
    expect(socket.send).toHaveBeenCalledTimes(1)
  })
})
