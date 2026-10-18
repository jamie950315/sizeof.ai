// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { handleSwiftApi, SwiftApiRelay } from './swift-api'
import type { SwiftChatBindings } from './swift-chat'

const key = 'test-api-secret-at-least-32-characters'
const forward = vi.fn(async () => Response.json({ ok: true }))
const env = { SWIFT_API_KEY: key, SWIFT_BRIDGE: { idFromName: () => 'owner', get: () => ({ fetch: forward }) } } as unknown as SwiftChatBindings
const request = (path: string, body?: unknown, auth = true) => new Request(`https://sizeof.ai${path}`, {
  ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${key}` } : {}) },
})

describe('Swift standard API routes', () => {
  it('requires API credentials without relying on browser Access', async () => {
    expect((await handleSwiftApi(request('/v1/models', undefined, false), env))?.status).toBe(401)
    const response = await handleSwiftApi(new Request('https://sizeof.ai/v1/models', { headers: { 'x-api-key': key } }), env)
    expect(await response?.json()).toMatchObject({ data: [{ id: 'swift-flash-next' }] })
  })
  it('does not wake the GPU for model discovery or invalid requests', async () => {
    forward.mockClear()
    await handleSwiftApi(request('/v1/models'), env)
    expect((await handleSwiftApi(request('/v1/responses', { model: 'wrong' }), env))?.status).toBe(400)
    expect(forward).not.toHaveBeenCalled()
  })
  it('maps all native formats and token counters without modifying their data', async () => {
    for (const path of ['/v1/responses', '/v1/chat/completions', '/v1/messages', '/v1/messages/count_tokens', '/v1/responses/input_tokens']) {
      await handleSwiftApi(request(path, { model: 'swift-flash-next', stream: false }), env)
      expect((forward.mock.calls.at(-1) as unknown as [Request])[0].url).toBe('https://bridge/inference')
    }
  })
})

describe('Swift API stream relay', () => {
  function setup(stream: boolean, protocol = 'responses') {
    const relay = new SwiftApiRelay()
    const socket = { send: vi.fn() } as unknown as WebSocket
    const pending = relay.fetch(new Request('https://bridge/inference', { method: 'POST',
      body: JSON.stringify({ protocol, body: { stream } }),
    }), socket)
    return { relay, socket, pending }
  }
  it('forwards native SSE and completion without buffering until the end', async () => {
    const { relay, socket, pending } = setup(true)
    const response = await pending
    const id = JSON.parse((socket.send as ReturnType<typeof vi.fn>).mock.calls[0][0]).id
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('connecting')
    relay.receive(socket, { id, sse: 'event: response.output_text.delta\ndata: {"delta":"hello"}\n\n' })
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('hello')
    relay.receive(socket, { id, result: { body: null, status: 200 } })
    expect((await reader.read()).done).toBe(true)
  })
  it('preserves a nonstream error HTTP status and cancels the controller request', async () => {
    const { relay, socket, pending } = setup(false)
    await new Promise(resolve => setTimeout(resolve, 0))
    const id = JSON.parse((socket.send as ReturnType<typeof vi.fn>).mock.calls[0][0]).id
    relay.receive(socket, { id, api_error: { message: 'Busy', code: 'model_busy' }, status: 429 })
    const response = await pending
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ error: { message: 'Busy' } })
  })
  it('does not replay requests when the controller disconnects', async () => {
    const { relay, socket, pending } = setup(false)
    await new Promise(resolve => setTimeout(resolve, 0))
    relay.disconnect(socket)
    expect((await pending).status).toBe(503)
    const commands = (socket.send as ReturnType<typeof vi.fn>).mock.calls.map(call => JSON.parse(call[0]))
    expect(commands.map(item => item.action)).toEqual(['inference', 'inference_cancel'])
  })
})
