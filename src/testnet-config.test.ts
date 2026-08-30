import { describe, expect, it } from 'vitest'
import packageJsonText from '../package.json?raw'
import wranglerConfigText from '../wrangler.jsonc?raw'

const productionCacheId = '64daa9eb377a4098969912297dbecbef'

type WranglerConfig = {
  routes?: Array<{ pattern?: string; custom_domain?: boolean }>
  env?: Record<string, {
    name?: string
    routes?: Array<{ pattern?: string; custom_domain?: boolean }>
    vars?: Record<string, string>
    kv_namespaces?: Array<{ binding?: string; id?: string }>
    assets?: {
      directory?: string
      binding?: string
      not_found_handling?: string
      run_worker_first?: boolean
    }
  }>
}

describe('testnet deployment configuration', () => {
  it('isolates the testnet Worker, route, cache, marker, and scripts from production', () => {
    const config = JSON.parse(wranglerConfigText) as WranglerConfig
    const packageJson = JSON.parse(packageJsonText) as {
      scripts: Record<string, string>
    }
    const testnet = config.env?.testnet

    expect(config.routes).toEqual([
      { pattern: 'sizeof.ai', custom_domain: true },
      { pattern: 'www.sizeof.ai', custom_domain: true },
    ])
    expect(testnet).toMatchObject({
      name: 'sizeof-ai-testnet',
      routes: [{ pattern: 'testnet.sizeof.ai', custom_domain: true }],
      vars: { ENVIRONMENT: 'testnet' },
      assets: {
        directory: './dist',
        binding: 'ASSETS',
        not_found_handling: 'single-page-application',
        run_worker_first: true,
      },
    })
    expect(testnet?.routes).toHaveLength(1)

    const modelCache = testnet?.kv_namespaces?.find(({ binding }) => binding === 'MODEL_CACHE')
    expect(modelCache?.id).toMatch(/^[a-f0-9]{32}$/)
    expect(modelCache?.id).not.toBe(productionCacheId)

    expect(packageJson.scripts['cf:check:testnet']).toContain('--env testnet')
    expect(packageJson.scripts['deploy:testnet']).toContain('npm run build')
    expect(packageJson.scripts['deploy:testnet']).toContain('--env testnet')
  })
})
