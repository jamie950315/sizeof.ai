import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { buildEstimateUrl, parseArgs, runCli } from './sizeof.mjs'

const response = {
  schema: 'sizeof-estimate/v1', model: { id: 'Qwen/Qwen3.8-27B' },
  result: { state: 'estimate', fit: 'comfortable', estimate: { totalGiB: 18.25 } },
  evidence: [{ label: 'Published model specification', kind: 'verified' }],
  disclaimer: 'Estimate only. Verify on the target runtime and hardware.',
}

describe('sizeof CLI', () => {
  it('parses bounded arguments and constructs the testnet API URL by default', () => {
    const parsed = parseArgs(['Qwen/Qwen3.8-27B', '--quant', 'q4_k_m', '--context', '8192', '--kv', 'q8_0', '--vram', '48', '--engine', 'vllm', '--concurrency', '4'])
    expect(parsed.baseUrl).toBe('https://testnet.sizeof.ai')
    expect(buildEstimateUrl(parsed).toString()).toBe('https://testnet.sizeof.ai/api/v1/estimate?model=Qwen%2FQwen3.8-27B&quant=q4_k_m&context=8192&kv=q8_0&vram=48&engine=vllm&concurrency=4')
  })

  it('honors process configuration overrides but rejects credentials and invalid arguments', () => {
    expect(parseArgs(['Org/Model'], { SIZEOF_API_BASE: 'http://127.0.0.1:8790' }).baseUrl).toBe('http://127.0.0.1:8790')
    expect(parseArgs(['Org/Model', '--base-url', 'https://preview.example/']).baseUrl).toBe('https://preview.example')
    expect(buildEstimateUrl(parseArgs(['Org/Model', '--base-url', 'https://preview.example/prefix'])).pathname).toBe('/prefix/api/v1/estimate')
    expect(() => parseArgs(['Org/Model', '--base-url', 'https://user:secret@example.com'])).toThrow('Base URL')
    expect(() => parseArgs(['Org/Model', '--context', '1'])).toThrow('context')
    expect(() => parseArgs(['Org/Model', '--unknown', 'x'])).toThrow('Unknown option')
  })

  it('prints unchanged JSON or clear human output', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json(response)))
    const stdout = vi.fn()
    expect(await runCli(['Qwen/Qwen3.8-27B', '--json'], { fetch, stdout, stderr: vi.fn(), env: {} })).toBe(0)
    expect(stdout).toHaveBeenCalledWith(`${JSON.stringify(response, null, 2)}\n`)

    stdout.mockClear()
    expect(await runCli(['Qwen/Qwen3.8-27B'], { fetch, stdout, stderr: vi.fn(), env: {} })).toBe(0)
    expect(stdout.mock.calls.flat().join('')).toContain('ESTIMATE · comfortable · 18.25 GiB')
    expect(stdout.mock.calls.flat().join('')).toContain('Evidence: Published model specification (verified)')
    expect(stdout.mock.calls.flat().join('')).toContain(response.disclaimer)
  })

  it('uses stderr and a non-zero status without echoing an untrusted response body', async () => {
    const stderr = vi.fn()
    const status = await runCli(['Org/Private'], {
      fetch: vi.fn().mockResolvedValue(new Response('<script>secret body</script>', { status: 404 })),
      stdout: vi.fn(), stderr, env: {},
    })
    expect(status).toBe(1)
    expect(stderr.mock.calls.flat().join('')).toContain('Request failed (404)')
    expect(stderr.mock.calls.flat().join('')).not.toContain('secret body')
  })

  it('keeps useful remote JSON errors bounded to one printable line', async () => {
    const stderr = vi.fn()
    const injected = `Model not found\r\n\u001b[31mred\u001b[0m\u001b]0;title\u0007${'x'.repeat(500)}`
    const status = await runCli(['Org/Missing'], {
      fetch: vi.fn().mockResolvedValue(Response.json({ error: injected }, { status: 404 })),
      stdout: vi.fn(), stderr, env: {},
    })
    expect(status).toBe(1)
    const output = stderr.mock.calls.flat().join('')
    expect(output).toContain('Model not found')
    expect(output.split('\n')).toHaveLength(2)
    expect(output).not.toMatch(/[\r\u0000-\u0009\u000B-\u001F\u007F-\u009F]/)
    expect(output).not.toContain('\u001b[')
    expect(output).not.toContain('\u001b]')
    expect(output.length).toBeLessThanOrEqual(220)
  })

  it('ships a composite Action with bounded inputs, testnet default, outputs, and no token surface', async () => {
    const action = await readFile(`${process.cwd()}/action.yml`, 'utf8')
    expect(action).toContain('using: composite')
    expect(action).toContain('default: https://testnet.sizeof.ai')
    expect(action).toContain('total:')
    expect(action).toContain('status:')
    expect(action).toContain('cli/sizeof.mjs')
    expect(action).toContain('cli/action-result.mjs')
    expect(action).not.toContain('value.result?.state')
    expect(action).not.toMatch(/token|secret/i)
  })

  it('registers local executables without making the private package publishable and documents every testnet surface', async () => {
    const packageJson = JSON.parse(await readFile(`${process.cwd()}/package.json`, 'utf8'))
    const readme = await readFile(`${process.cwd()}/README.md`, 'utf8')
    expect(packageJson.private).toBe(true)
    expect(packageJson.bin).toEqual({ sizeof: './cli/sizeof.mjs', 'sizeof-mcp': './mcp/server.mjs' })
    for (const heading of ['Testnet preview', 'Public API', 'CLI', 'GitHub Action', 'Badge and embed', 'MCP']) {
      expect(readme).toContain(heading)
    }
    expect(readme).toContain('https://testnet.sizeof.ai')
    expect(readme).toContain('preview')
    expect(readme).not.toContain('testnet is production-stable')
  })
})
