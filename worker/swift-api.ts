import { readBoundedBody, UpstreamError } from './upstream'
import type { SwiftChatBindings } from './swift-chat'

const headers = { 'Cache-Control': 'no-store, no-transform', 'X-Content-Type-Options': 'nosniff' }
const models = [
  { id: 'swift-flash-next', display_name: 'Swift Flash Next IQ3_S' },
  { id: 'deepseek-v4.1-flash', display_name: 'DeepSeek V4.1 Flash UD-IQ1_M (g4-ultra896)' },
] as const
const json = (body: unknown, status = 200) => Response.json(body, { status, headers })
const errorBody = (message: string, code: string, anthropic = false) => anthropic
  ? { type: 'error', error: { type: code, message } }
  : { error: { message, type: 'invalid_request_error', code, param: null } }

function authorized(request: Request, secret?: string): boolean {
  const actual = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? request.headers.get('x-api-key') ?? ''
  if (!secret || secret.length < 32 || actual.length !== secret.length) return false
  let difference = 0
  for (let index = 0; index < secret.length; index++) difference |= actual.charCodeAt(index) ^ secret.charCodeAt(index)
  return difference === 0
}

export async function handleSwiftApi(request: Request, env: SwiftChatBindings): Promise<Response | null> {
  const path = new URL(request.url).pathname
  if (path !== '/v1' && !path.startsWith('/v1/')) return null
  const anthropic = path.startsWith('/v1/messages')
  if (!authorized(request, env.SWIFT_API_KEY)) return json(errorBody('A valid API key is required.', 'authentication_error', anthropic), 401)
  if (!env.SWIFT_BRIDGE) return json(errorBody('The inference relay is not configured.', 'api_error', anthropic), 503)
  const bridge = env.SWIFT_BRIDGE.get(env.SWIFT_BRIDGE.idFromName('owner'))
  if (path === '/v1/models' && request.method === 'GET') return json({ object: 'list', data: [
    ...models.map(entry => ({ ...entry, object: 'model', created: 1792252800, owned_by: 'owner' })),
  ], has_more: false, first_id: models[0].id, last_id: models.at(-1)!.id })
  if (path === '/v1/status' && request.method === 'GET') return bridge.fetch('https://bridge/command', {
    method: 'POST', body: JSON.stringify({ action: 'instance_status', payload: {} }),
  })
  const routes: Record<string, string> = {
    '/v1/chat/completions': 'chat', '/v1/responses': 'responses', '/v1/messages': 'messages',
    '/v1/messages/count_tokens': 'messages_count', '/v1/responses/input_tokens': 'responses_count',
  }
  if (!routes[path]) return json(errorBody('Unknown API endpoint.', 'not_found_error', anthropic), 404)
  if (request.method !== 'POST') return json(errorBody('Use POST for inference.', 'invalid_request_error', anthropic), 405)
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') return json(errorBody('JSON is required.', 'invalid_request_error', anthropic), 415)
  let body: Record<string, unknown>
  try {
    body = JSON.parse(new TextDecoder().decode(await readBoundedBody(new Response(request.body, { headers: request.headers }), 8 * 1024 * 1024)))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid object')
  } catch (error) {
    return json(errorBody(error instanceof UpstreamError ? 'Request exceeds 8 MiB.' : 'Invalid JSON object.', 'invalid_request_error', anthropic), error instanceof UpstreamError ? 413 : 400)
  }
  if (!models.some(entry => entry.id === body.model)) return json(errorBody('The requested model is not available.', 'model_not_found', anthropic), 404)
  if (body.stream !== undefined && typeof body.stream !== 'boolean') return json(errorBody('The stream option must be a boolean.', 'invalid_request_error', anthropic), 400)
  return bridge.fetch(new Request('https://bridge/inference', { method: 'POST', signal: request.signal,
    body: JSON.stringify({ protocol: routes[path], body }),
  }))
}

type Pending = {
  socket: WebSocket; protocol: string; stream: boolean; resolve: (response: Response) => void
  output?: ReadableStreamDefaultController<Uint8Array>; timer: ReturnType<typeof setTimeout>
}

/** In-memory streams only; generation is never replayed after relay interruption. */
export class SwiftApiRelay {
  private pending = new Map<string, Pending>()
  async fetch(request: Request, socket?: WebSocket): Promise<Response> {
    const value = await request.json<{ protocol: string; body: Record<string, unknown> }>()
    const anthropic = value.protocol.startsWith('messages')
    if (!socket) return json(errorBody('Controller offline. Colab allocation is unknown.', 'api_error', anthropic), 503)
    if (this.pending.size >= 4) return json(errorBody('The model is busy.', 'rate_limit_error', anthropic), 429)
    const id = crypto.randomUUID()
    const stream = value.body.stream === true
    return new Promise<Response>(resolve => {
      const pending: Pending = { socket, protocol: value.protocol, stream, resolve,
        timer: setTimeout(() => this.fail(id, 'The inference relay timed out.', 504), 45000) }
      this.pending.set(id, pending)
      if (stream) {
        const body = new ReadableStream<Uint8Array>({
          start: controller => { pending.output = controller; controller.enqueue(new TextEncoder().encode(': swift.status connecting\n\n')) },
          cancel: () => this.cancel(id),
        }, { highWaterMark: 1024 * 1024, size: chunk => chunk.byteLength })
        resolve(new Response(body, { headers: { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Request-Id': id } }))
      }
      request.signal.addEventListener('abort', () => this.cancel(id), { once: true })
      try { socket.send(JSON.stringify({ id, action: 'inference', payload: value })) }
      catch { this.fail(id, 'The controller disconnected. This request was not replayed.', 503) }
    })
  }
  receive(socket: WebSocket, value: Record<string, unknown>): boolean {
    const id = String(value.id)
    const pending = this.pending.get(id)
    if (!pending || pending.socket !== socket) return false
    clearTimeout(pending.timer)
    if (typeof value.sse === 'string') {
      pending.timer = setTimeout(() => this.fail(id, 'The inference relay stopped responding.', 504), 45000)
      if (pending.output && value.sse) {
        if ((pending.output.desiredSize ?? 0) < -8 * 1024 * 1024) { this.fail(id, 'The stream consumer is too slow.', 502); return true }
        pending.output.enqueue(new TextEncoder().encode(value.sse))
      }
      return true
    }
    if (value.api_error || value.error) {
      const error = value.api_error as { message?: string; code?: string } | undefined
      this.fail(id, error?.message ?? 'The controller request failed.', Number(value.status ?? 502), error?.code)
      return true
    }
    this.pending.delete(id)
    const result = value.result as { body: unknown; status: number }
    if (pending.output) pending.output.close()
    else pending.resolve(json(result.body, result.status))
    return true
  }
  disconnect(socket: WebSocket) {
    for (const [id, pending] of this.pending) if (pending.socket === socket) this.fail(id, 'Controller disconnected. This request was not replayed.', 503)
  }
  private cancel(id: string, resolveCancelled = true) {
    const pending = this.pending.get(id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(id)
    try { pending.socket.send(JSON.stringify({ id, action: 'inference_cancel' })) } catch { /* Already disconnected. */ }
    if (resolveCancelled && !pending.stream) pending.resolve(json(errorBody('Request cancelled.', 'cancelled', pending.protocol.startsWith('messages')), 499))
  }
  private fail(id: string, message: string, status: number, code = 'api_error') {
    const pending = this.pending.get(id)
    if (!pending) return
    const anthropic = pending.protocol.startsWith('messages')
    this.cancel(id, false)
    if (pending.output) {
      const data = anthropic ? errorBody(message, code, true) : pending.protocol === 'responses'
        ? { type: 'error', message, code } : errorBody(message, code)
      const event = anthropic || pending.protocol === 'responses' ? 'event: error\n' : ''
      pending.output.enqueue(new TextEncoder().encode(`${event}data: ${JSON.stringify(data)}\n\n`))
      pending.output.close()
    } else pending.resolve(json(errorBody(message, code, anthropic), status))
  }
}
