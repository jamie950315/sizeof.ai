import { describe, expect, it } from 'vitest'
import { DEFAULT_COMPATIBILITY, compatibilityEvidence, compatibilitySearch, parseCompatibility } from './compatibility'
describe('conservative compatibility evidence', () => {
  it('distinguishes documented building blocks from unverified family', () => { const rows = compatibilityEvidence(DEFAULT_COMPATIBILITY); expect(rows.filter(r => r.status === 'documented')).toHaveLength(3); expect(rows.find(r => r.dimension === 'Model family')?.status).toBe('unknown') })
  it('marks explicit native Windows vLLM restriction, not WSL', () => { expect(compatibilityEvidence({ ...DEFAULT_COMPATIBILITY, engine: 'vllm', os: 'windows' })[0].status).toBe('unsupported'); expect(compatibilityEvidence({ ...DEFAULT_COMPATIBILITY, engine: 'vllm', os: 'wsl2' })[0].status).toBe('documented') })
  it('does not silently equate standard vLLM with Metal plugin', () => expect(compatibilityEvidence({ ...DEFAULT_COMPATIBILITY, engine: 'vllm' }).find(r => r.dimension === 'Hardware backend')).toMatchObject({ status: 'unknown' }))
  it('marks direct non-GGUF llama packaging as unsupported', () => expect(compatibilityEvidence({ ...DEFAULT_COMPATIBILITY, format: 'hf-safetensors' }).find(r => r.dimension === 'Model packaging')?.status).toBe('unsupported'))
  it('unknown is not unsupported', () => expect(compatibilityEvidence({ ...DEFAULT_COMPATIBILITY, hardware: 'other', format: 'other' }).some(r => r.status === 'unsupported')).toBe(false))
  it('has dated primary sources for all evidence', () => { for (const engine of ['llama.cpp', 'mlx-lm', 'vllm'] as const) for (const row of compatibilityEvidence({ ...DEFAULT_COMPATIBILITY, engine })) { expect(['github.com', 'docs.vllm.ai']).toContain(new URL(row.source).hostname); expect(row.reviewed).toBe('2026-09-08') } })
  it('round trips', () => expect(parseCompatibility(compatibilitySearch(DEFAULT_COMPATIBILITY))).toEqual(DEFAULT_COMPATIBILITY))
  it.each(['?v=2', '?v=1', '?v=1&__proto__=x', `?${compatibilitySearch(DEFAULT_COMPATIBILITY)}&engine=mlx-lm`, '?x=' + 'a'.repeat(1024)])('rejects malformed input %s', search => expect(() => parseCompatibility(search)).toThrow())
  it('rejects inherited fields', () => expect(() => compatibilityEvidence(Object.create(DEFAULT_COMPATIBILITY))).toThrow())
  it('does not serialize unrecognized data', () => expect(() => compatibilitySearch({ ...DEFAULT_COMPATIBILITY, secret: 'x' } as typeof DEFAULT_COMPATIBILITY)).toThrow())
})
