import { describe, expect, it, vi } from 'vitest'
import { TOOL_DEFINITIONS, callTool, createMcpServer } from './server.mjs'

function estimate(model, total = 10) {
  return {
    schema: 'sizeof-estimate/v1', model: { id: model },
    result: { state: 'estimate', fit: 'comfortable', estimate: { totalGiB: total } },
    planner: { maximumSafeContext: { kind: 'available', context: 32768 } },
    evidence: [{ label: 'Published model specification', kind: 'verified' }],
    disclaimer: 'Estimate only.',
  }
}

describe('sizeof MCP stdio server', () => {
  it('exposes estimate, compare, and find_fit with bounded JSON Schemas and no destination argument', () => {
    expect(TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual(['estimate', 'compare', 'find_fit'])
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.inputSchema.additionalProperties).toBe(false)
      expect(tool.inputSchema.properties).not.toHaveProperty('baseUrl')
      expect(tool.inputSchema.properties).not.toHaveProperty('url')
      expect(tool.inputSchema.properties).not.toHaveProperty('token')
    }
    expect(createMcpServer().constructor.name).toBe('McpServer')
  })

  it('validates before fetch and returns structured estimate content', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json(estimate('Org/Model'))))
    await expect(callTool('estimate', { model: 'invalid' }, { fetch, baseUrl: 'https://testnet.sizeof.ai' })).rejects.toThrow('model')
    expect(fetch).not.toHaveBeenCalled()

    const result = await callTool('estimate', { model: 'Org/Model', context: 4096 }, { fetch, baseUrl: 'https://testnet.sizeof.ai' })
    expect(result.structuredContent).toMatchObject({ schema: 'sizeof-estimate/v1', model: { id: 'Org/Model' } })
    expect(result.content[0].text).toContain('Estimate only.')
  })

  it('keeps partial comparison failures and caps model count at four', async () => {
    const fetch = vi.fn(async (input) => String(input).includes('Org%2FBad')
      ? new Response(JSON.stringify({ error: 'Model not found or private' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
      : Response.json(estimate('Org/Good')))
    const result = await callTool('compare', { models: ['Org/Good', 'Org/Bad'] }, { fetch, baseUrl: 'https://testnet.sizeof.ai' })
    expect(result.structuredContent.results).toHaveLength(1)
    expect(result.structuredContent.failures).toEqual([{ model: 'Org/Bad', status: 404, error: 'Model not found or private' }])
    await expect(callTool('compare', { models: ['A/A', 'B/B', 'C/C', 'D/D', 'E/E'] }, { fetch, baseUrl: 'https://testnet.sizeof.ai' })).rejects.toThrow('2 to 4')
  })

  it('keeps a network failure isolated to its comparison entry', async () => {
    const fetch = vi.fn(async (input) => {
      if (String(input).includes('Org%2FOffline')) throw new Error('private network detail')
      return Response.json(estimate('Org/Good'))
    })
    const result = await callTool('compare', { models: ['Org/Good', 'Org/Offline'] }, { fetch, baseUrl: 'https://testnet.sizeof.ai' })
    expect(result.structuredContent.results).toHaveLength(1)
    expect(result.structuredContent.failures).toEqual([{ model: 'Org/Offline', status: 502, error: 'Estimate service is temporarily unavailable' }])
    expect(JSON.stringify(result)).not.toContain('private network detail')
  })

  it('keeps useful remote tool errors bounded to one printable line', async () => {
    const injected = `Model not found\r\n\u001b[31mred\u001b[0m\u001b]0;title\u0007${'x'.repeat(500)}`
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: injected }, { status: 404 }))
    await expect(callTool('estimate', { model: 'Org/Missing' }, { fetch, baseUrl: 'https://testnet.sizeof.ai' }))
      .rejects.toThrow('Model not found')
    try {
      await callTool('estimate', { model: 'Org/Missing' }, { fetch: vi.fn().mockResolvedValue(Response.json({ error: injected }, { status: 404 })), baseUrl: 'https://testnet.sizeof.ai' })
    } catch (error) {
      const message = error.message
      expect(message).not.toMatch(/[\r\n\u0000-\u001F\u007F-\u009F]/)
      expect(message).not.toContain('\u001b[')
      expect(message).not.toContain('\u001b]')
      expect(message.length).toBeLessThanOrEqual(180)
    }

    const compared = await callTool('compare', { models: ['Org/One', 'Org/Two'] }, {
      fetch: vi.fn().mockImplementation(() => Promise.resolve(Response.json({ error: injected }, { status: 404 }))),
      baseUrl: 'https://testnet.sizeof.ai',
    })
    expect(compared.structuredContent.failures[0].error).toContain('Model not found')
    expect(JSON.stringify(compared.structuredContent.failures)).not.toMatch(/[\r\n\u0000-\u001F\u007F-\u009F]/)
  })

  it('returns inverse planner output and always uses the process-level base URL', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json(estimate('Org/Model'))))
    const result = await callTool('find_fit', { model: 'Org/Model', vram: 24 }, { fetch, baseUrl: 'http://127.0.0.1:8790' })
    expect(result.structuredContent).toMatchObject({ model: { id: 'Org/Model' }, planner: { maximumSafeContext: { context: 32768 } } })
    expect(fetch.mock.calls[0][0].toString()).toMatch(/^http:\/\/127\.0\.0\.1:8790\/api\/v1\/estimate\?/)

    fetch.mockClear()
    await callTool('find_fit', { model: 'Org/Model', vram: 24 }, { fetch, baseUrl: 'https://preview.example/prefix' })
    expect(fetch.mock.calls[0][0].pathname).toBe('/prefix/api/v1/estimate')
  })
})
