import { describe, expect, it } from 'vitest'
import packageJsonText from '../package.json?raw'
import wranglerConfigText from '../wrangler.jsonc?raw'

const productionCacheId = '64daa9eb377a4098969912297dbecbef'

describe('testnet deployment configuration', () => {
  it('isolates the testnet Worker, route, cache, marker, and scripts from production', () => {
    const packageJson = JSON.parse(packageJsonText) as {
      scripts: Record<string, string>
    }

    expect(wranglerConfigText).toMatch(/"routes"\s*:\s*\[\s*\{\s*"pattern"\s*:\s*"sizeof\.ai"\s*,\s*"custom_domain"\s*:\s*true\s*}\s*,\s*\{\s*"pattern"\s*:\s*"www\.sizeof\.ai"\s*,\s*"custom_domain"\s*:\s*true\s*}\s*]\s*,\s*"env"\s*:/s)
    const config = JSON.parse(wranglerConfigText)
    expect(config.assets.run_worker_first).toBe(true)
    expect(config.env.testnet.name).toBe('sizeof-ai-testnet')
    expect(config.env.testnet.vars.ENVIRONMENT).toBe('testnet')
    expect(config.env.testnet.assets).toMatchObject({
      directory: './dist', binding: 'ASSETS', not_found_handling: 'single-page-application',
      run_worker_first: ['/*', '!/assets/*', '!/favicon*', '!/apple-touch-icon.png'],
    })
    expect(config.env.testnet.routes).toEqual([{ pattern: 'testnet.sizeof.ai', custom_domain: true }])

    const modelCacheId = wranglerConfigText.match(/"testnet"\s*:\s*\{[\s\S]*?"kv_namespaces"\s*:\s*\[\s*\{\s*"binding"\s*:\s*"MODEL_CACHE"\s*,\s*"id"\s*:\s*"([a-f0-9]{32})"\s*}\s*]/s)?.[1]
    expect(modelCacheId).toBeDefined()
    expect(modelCacheId).not.toBe(productionCacheId)

    expect(packageJson.scripts.deploy).toBe('npm run build && wrangler deploy')
    expect(packageJson.scripts['cf:check:testnet']).toBe('wrangler deploy --dry-run --env testnet')
    expect(packageJson.scripts['deploy:testnet']).toBe('npm run build && wrangler deploy --env testnet')
  })
})
