import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createHfTokenPool,
  createRotatingHfFetcher,
  isHfEnterpriseKeysEnabled,
  resetHfTokenRotationForTests,
  resolveHfTokens,
} from './hf-token-pool'

const enterpriseEnv = {
  HF_TOKEN: 'hf_primary',
  HF_TOKEN_ENTERPRISE_1: 'hf_ent_1',
  HF_TOKEN_ENTERPRISE_2: 'hf_ent_2',
  HF_TOKEN_ENTERPRISE_3: 'hf_ent_3',
  HF_TOKEN_ENTERPRISE_4: 'hf_ent_4',
}

afterEach(() => {
  resetHfTokenRotationForTests()
})

describe('resolveHfTokens', () => {
  it('uses only the existing token while enterprise keys stay locked', () => {
    expect(isHfEnterpriseKeysEnabled(enterpriseEnv)).toBe(false)
    expect(resolveHfTokens(enterpriseEnv)).toEqual(['hf_primary'])
    expect(resolveHfTokens({
      ...enterpriseEnv,
      HF_ENTERPRISE_KEYS_ENABLED: 'false',
    })).toEqual(['hf_primary'])
    expect(resolveHfTokens({
      ...enterpriseEnv,
      HF_ENTERPRISE_KEYS_ENABLED: '1',
    })).toEqual(['hf_primary'])
  })

  it('adds enterprise keys only after the explicit enable flag is true', () => {
    expect(resolveHfTokens({
      ...enterpriseEnv,
      HF_ENTERPRISE_KEYS_ENABLED: 'true',
    })).toEqual(['hf_primary', 'hf_ent_1', 'hf_ent_2', 'hf_ent_3', 'hf_ent_4'])
  })

  it('skips blank duplicate enterprise slots and still works without the primary token', () => {
    expect(resolveHfTokens({
      HF_ENTERPRISE_KEYS_ENABLED: ' TRUE ',
      HF_TOKEN_ENTERPRISE_1: ' hf_ent_1 ',
      HF_TOKEN_ENTERPRISE_2: '',
      HF_TOKEN_ENTERPRISE_3: 'hf_ent_1',
      HF_TOKEN_ENTERPRISE_4: 'hf_ent_4',
    })).toEqual(['hf_ent_1', 'hf_ent_4'])
  })
})

describe('createHfTokenPool', () => {
  it('rotates to the next active token on every Hugging Face lookup', () => {
    const pool = createHfTokenPool({
      ...enterpriseEnv,
      HF_ENTERPRISE_KEYS_ENABLED: 'true',
    })

    expect(pool.size).toBe(5)
    expect(pool.enterpriseKeysEnabled).toBe(true)
    expect([pool.next(), pool.next(), pool.next(), pool.next(), pool.next(), pool.next()]).toEqual([
      'hf_primary',
      'hf_ent_1',
      'hf_ent_2',
      'hf_ent_3',
      'hf_ent_4',
      'hf_primary',
    ])
  })
})

describe('createRotatingHfFetcher', () => {
  it('attaches the next token only to Hugging Face requests and leaves other URLs untouched', async () => {
    const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response('ok'))
    const rotating = createRotatingHfFetcher(fetcher, createHfTokenPool({
      ...enterpriseEnv,
      HF_ENTERPRISE_KEYS_ENABLED: 'true',
    }))
    const originalHeaders = { Accept: 'application/json' }

    await rotating('https://huggingface.co/api/models?search=qwen', { headers: originalHeaders })
    await rotating('https://huggingface.co/api/models/Qwen/Qwen3.8-27B')
    await rotating('https://example.com/health', { headers: originalHeaders })
    await rotating('https://huggingface.co/api/models?search=ornith', {
      headers: { Authorization: 'Bearer hf_already_set' },
    })

    expect(originalHeaders).toEqual({ Accept: 'application/json' })
    expect(fetcher.mock.calls[0]?.[1]).toEqual({
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer hf_primary',
      },
    })
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get('Authorization')).toBe('Bearer hf_ent_1')
    expect(fetcher.mock.calls[2]?.[1]).toEqual({ headers: { Accept: 'application/json' } })
    expect(fetcher.mock.calls[3]?.[1]).toEqual({
      headers: { Authorization: 'Bearer hf_already_set' },
    })
  })
})
