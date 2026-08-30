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
    expect(wranglerConfigText).toMatch(/"env"\s*:\s*\{\s*"testnet"\s*:\s*\{[\s\S]*?"name"\s*:\s*"sizeof-ai-testnet"[\s\S]*?"ENVIRONMENT"\s*:\s*"testnet"[\s\S]*?"assets"\s*:\s*\{[\s\S]*?"directory"\s*:\s*"\.\/dist"[\s\S]*?"binding"\s*:\s*"ASSETS"[\s\S]*?"not_found_handling"\s*:\s*"single-page-application"[\s\S]*?"run_worker_first"\s*:\s*true[\s\S]*?}\s*,\s*"routes"\s*:\s*\[\s*\{\s*"pattern"\s*:\s*"testnet\.sizeof\.ai"\s*,\s*"custom_domain"\s*:\s*true\s*}\s*]/s)

    const modelCacheId = wranglerConfigText.match(/"testnet"\s*:\s*\{[\s\S]*?"kv_namespaces"\s*:\s*\[\s*\{\s*"binding"\s*:\s*"MODEL_CACHE"\s*,\s*"id"\s*:\s*"([a-f0-9]{32})"\s*}\s*]/s)?.[1]
    expect(modelCacheId).toBeDefined()
    expect(modelCacheId).not.toBe(productionCacheId)

    expect(packageJson.scripts.deploy).toBe('npm run build && wrangler deploy')
    expect(packageJson.scripts['cf:check:testnet']).toBe('wrangler deploy --dry-run --env testnet')
    expect(packageJson.scripts['deploy:testnet']).toBe('npm run build && wrangler deploy --env testnet')
  })
})
