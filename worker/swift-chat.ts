import { readBoundedBody, UpstreamError } from './upstream'
import { handleSwiftApi, SwiftApiRelay } from './swift-api'

/** Private Swift frontend and a credential-free relay to the official Colab controller. */
export interface SwiftChatBindings {
  SWIFT_BRIDGE?: DurableObjectNamespace
  SWIFT_CONTROLLER_TOKEN?: string
  SWIFT_API_KEY?: string
  SWIFT_ACCESS_AUD?: string
  SWIFT_ACCESS_TEAM?: string
  SWIFT_OWNER_EMAIL?: string
  ASSETS: { fetch(request: Request): Promise<Response> }
}

const privateHeaders = {
  'Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: privateHeaders })
const MAX_BYTES = 8 * 1024 * 1024
const keys = new Map<string, { until: number; keys: (JsonWebKey & { kid?: string })[] }>()

function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0))
}

/** Verify the Access assertion as well as the edge policy, including workers.dev requests. */
export async function swiftOwner(request: Request, env: SwiftChatBindings): Promise<boolean> {
  const token = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!token || token.length > 16384 || !env.SWIFT_ACCESS_AUD || !env.SWIFT_OWNER_EMAIL
    || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.SWIFT_ACCESS_TEAM ?? '')) return false
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return false
    const header = JSON.parse(new TextDecoder().decode(decode(parts[0])))
    const claim = JSON.parse(new TextDecoder().decode(decode(parts[1])))
    const now = Date.now() / 1000
    if (header.alg !== 'RS256' || typeof header.kid !== 'string'
      || claim.iss !== env.SWIFT_ACCESS_TEAM || !Array.isArray(claim.aud)
      || !claim.aud.includes(env.SWIFT_ACCESS_AUD) || claim.email !== env.SWIFT_OWNER_EMAIL
      || typeof claim.exp !== 'number' || claim.exp <= now
      || typeof claim.iat !== 'number' || claim.iat > now + 60
      || (claim.nbf !== undefined && (typeof claim.nbf !== 'number' || claim.nbf > now + 60))) {
      return false
    }
    let cached = keys.get(env.SWIFT_ACCESS_TEAM!)
    if (!cached || cached.until < Date.now()) {
      const response = await fetch(`${env.SWIFT_ACCESS_TEAM}/cdn-cgi/access/certs`, {
        redirect: 'manual', signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) return false
      const body = JSON.parse(new TextDecoder().decode(await readBoundedBody(response, 262144))) as { keys: (JsonWebKey & { kid?: string })[] }
      if (!Array.isArray(body.keys)) return false
      cached = { until: Date.now() + 300000, keys: body.keys }
      keys.set(env.SWIFT_ACCESS_TEAM!, cached)
    }
    const jwk = cached.keys.find(key => key.kid === header.kid && key.kty === 'RSA')
    if (!jwk) return false
    const key = await crypto.subtle.importKey('jwk', jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`))
  } catch { return false }
}

function controllerAuthorized(request: Request, env: SwiftChatBindings): boolean {
  const actual = request.headers.get('Authorization') ?? ''
  const expected = `Bearer ${env.SWIFT_CONTROLLER_TOKEN ?? ''}`
  if (!env.SWIFT_CONTROLLER_TOKEN || env.SWIFT_CONTROLLER_TOKEN.length < 32 || actual.length !== expected.length) return false
  let different = 0
  for (let index = 0; index < expected.length; index++) different |= actual.charCodeAt(index) ^ expected.charCodeAt(index)
  return different === 0
}

export async function handleSwiftChat(request: Request, env: SwiftChatBindings): Promise<Response | null> {
  const url = new URL(request.url)
  const api = await handleSwiftApi(request, env)
  if (api) return api
  // Static Assets decodes file paths. Classify encoded aliases before the public asset handler.
  let pathname = url.pathname
  try { pathname = new URL(decodeURIComponent(pathname), url.origin).pathname } catch { /* Invalid paths cannot identify a private asset. */ }
  if (url.pathname === '/_swift/controller') {
    if (!controllerAuthorized(request, env)) return reply({ error: 'Unauthorized' }, 401)
    if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return reply({ error: 'WebSocket required' }, 426)
    if (!env.SWIFT_BRIDGE) return reply({ error: 'Chat is not configured' }, 503)
    return env.SWIFT_BRIDGE.get(env.SWIFT_BRIDGE.idFromName('owner')).fetch(request)
  }
  if (pathname !== '/chat' && !pathname.startsWith('/chat/')) return null
  if (!await swiftOwner(request, env)) return reply({ error: 'Sign in to your owner account.', sign_in: '/chat/' }, 401)
  if (pathname !== url.pathname) return reply({ error: 'Use the canonical /chat/ URL.' }, 400)
  if (url.pathname === '/chat') return Response.redirect(`${url.origin}/chat/`, 308)
  if (url.pathname.startsWith('/chat/api/')) {
    const routes: Record<string, [string, string]> = {
      '/chat/api/instance': ['GET', 'instance_status'],
      '/chat/api/instance/start': ['POST', 'instance_start'],
      '/chat/api/instance/shutdown': ['POST', 'instance_shutdown'],
      '/chat/api/rpc': ['POST', 'rpc'],
    }
    const route = routes[url.pathname]
    if (!route) return reply({ error: 'Not found' }, 404)
    if (request.method !== route[0]) return reply({ error: 'Method not allowed' }, 405)
    let payload: Record<string, unknown> = {}
    if (request.method === 'POST') {
      if (request.headers.get('Origin') !== url.origin) return reply({ error: 'Same-origin request required' }, 403)
      if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') return reply({ error: 'JSON required' }, 415)
      try {
        const text = new TextDecoder().decode(await readBoundedBody(new Response(request.body, { headers: request.headers }), MAX_BYTES))
        payload = JSON.parse(text)
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid object')
      } catch (error) {
        return error instanceof UpstreamError ? reply({ error: 'Request is too large' }, 413) : reply({ error: 'Invalid JSON object' }, 400)
      }
    }
    if (!env.SWIFT_BRIDGE) return reply({ error: 'Chat is not configured' }, 503)
    return env.SWIFT_BRIDGE.get(env.SWIFT_BRIDGE.idFromName('owner')).fetch('https://bridge/command', {
      method: 'POST', body: JSON.stringify({ action: route[1], payload }),
    })
  }
  if (url.pathname !== '/chat/' && url.pathname !== '/chat/index.html') return reply({ error: 'Not found' }, 404)
  if (request.method !== 'GET' && request.method !== 'HEAD') return reply({ error: 'Method not allowed' }, 405)
  const assetUrl = new URL('/chat/index.html', url)
  const asset = await env.ASSETS.fetch(new Request(assetUrl, { method: request.method }))
  const headers = new Headers(asset.headers)
  for (const [key, value] of Object.entries(privateHeaders)) headers.set(key, value)
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
  return new Response(asset.body, { status: asset.status, headers })
}

/** No conversations, credentials or commands are persisted in Durable Object storage. */
export class SwiftChatBridge {
  private api = new SwiftApiRelay()
  private pending = new Map<string, { socket: WebSocket; resolve: (value: Response) => void; timer: ReturnType<typeof setTimeout> }>()
  constructor(private ctx: DurableObjectState) {
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const pair = new WebSocketPair()
      for (const socket of this.ctx.getWebSockets('controller')) {
        this.disconnect(socket)
        socket.close(4001, 'Controller reconnected')
      }
      this.ctx.acceptWebSocket(pair[1], ['controller'])
      return new Response(null, { status: 101, webSocket: pair[0] })
    }
    if (new URL(request.url).pathname === '/inference') {
      return this.api.fetch(request, this.ctx.getWebSockets('controller').find(socket => socket.readyState === 1))
    }
    const command = await request.json<{ action: string; payload: unknown }>()
    const socket = this.ctx.getWebSockets('controller').find(socket => socket.readyState === 1)
    if (!socket) return reply({ phase: 'unknown', controller_connected: false,
      detail: 'Controller offline. Colab may still be running.', error: 'Controller offline. Colab status is unknown.' }, 503)
    if (this.pending.size >= 8) return reply({ error: 'Wait for the current request to finish.' }, 429)
    const id = crypto.randomUUID()
    return new Promise<Response>(resolve => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve(reply({ error: 'Controller did not respond. Check status before retrying an action.',
          phase: 'unknown', controller_connected: false }, 504))
      }, command.action === 'rpc' ? 45000 : 15000)
      this.pending.set(id, { socket, resolve, timer })
      try { socket.send(JSON.stringify({ id, ...command })) }
      catch { this.disconnect(socket) }
    })
  }
  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string' || new TextEncoder().encode(message).length > MAX_BYTES) {
      this.disconnect(socket); socket.close(1009, 'Response too large'); return
    }
    try {
      const value = JSON.parse(message)
      if (typeof value.id !== 'string') return
      if (this.api.receive(socket, value)) return
      const pending = this.pending.get(value.id)
      if (!pending || pending.socket !== socket) return
      clearTimeout(pending.timer)
      this.pending.delete(value.id)
      pending.resolve(value.error ? reply({ error: String(value.error) }, 502) : reply(value.result))
    } catch { this.disconnect(socket); socket.close(1007, 'Invalid response') }
  }
  private disconnect(socket: WebSocket) {
    this.api.disconnect(socket)
    for (const [id, pending] of this.pending) if (pending.socket === socket) {
      clearTimeout(pending.timer); this.pending.delete(id)
      pending.resolve(reply({ error: 'Controller disconnected. Check status before retrying an action.',
        phase: 'unknown', controller_connected: false }, 503))
    }
  }
  webSocketClose(socket: WebSocket) { this.disconnect(socket) }
  webSocketError(socket: WebSocket) { this.disconnect(socket) }
}
