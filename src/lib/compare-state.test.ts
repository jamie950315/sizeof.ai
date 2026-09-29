import { describe, expect, it } from 'vitest'
import { normalizeCompareModelInput, parseCompareState, serializeCompareState, validateCompareModelId, type CompareItemState } from './compare-state'

const defaults: Omit<CompareItemState, 'modelId'> = {
  quantization: 'q4_k_m',
  context: 8192,
  kvPrecision: 'fp16',
  mlaCacheMode: 'expanded',
  vramGiB: 32,
  source: 'estimated',
  variantId: null,
}

describe('comparison URL state', () => {
  it('round-trips two independently configured models in stable order', () => {
    const state = {
      items: [
        { modelId: 'Qwen/Qwen3.8-27B', ...defaults },
        { modelId: 'meta-llama/Llama-3.3-70B-Instruct', ...defaults, quantization: 'q8_0' as const, context: 16384, kvPrecision: 'q8_0' as const, mlaCacheMode: 'latent' as const, vramGiB: 96, source: 'unsloth', variantId: 'abc:def' },
      ],
    }

    const query = serializeCompareState(state)

    expect(query).toBe('compare=1&model=Qwen%2FQwen3.8-27B~q4_k_m~8192~fp16~expanded~32~estimated~none&model=meta-llama%2FLlama-3.3-70B-Instruct~q8_0~16384~q8_0~latent~96~unsloth~abc%3Adef')
    expect(parseCompareState(`?${query}`, defaults)).toEqual(state)
  })

  it('deduplicates model IDs case-insensitively and caps the list at four', () => {
    const query = [
      'compare=1',
      'model=Qwen%2FOne',
      'model=qwen%2Fone',
      'model=Org%2FTwo',
      'model=Org%2FThree',
      'model=Org%2FFour',
      'model=Org%2FFive',
    ].join('&')

    expect(parseCompareState(query, defaults).items.map((item) => item.modelId)).toEqual([
      'Qwen/One', 'Org/Two', 'Org/Three', 'Org/Four',
    ])
  })

  it('rejects malformed, reserved, and overlong model IDs', () => {
    const overlong = `${'a'.repeat(97)}/repo`
    const query = `compare=1&model=compare%2Fworkspace&model=bad%2F..&model=${encodeURIComponent(overlong)}`

    expect(parseCompareState(query, defaults).items).toEqual([])
  })

  it('falls back per invalid field without losing the valid model ID', () => {
    const query = 'compare=1&model=Qwen%2FModel%7Enope%7E999%7Ebad%7Ewrong%7E-1%7E%3Cscript%3E%7Etoolong'

    expect(parseCompareState(query, defaults).items).toEqual([{ modelId: 'Qwen/Model', ...defaults }])
  })

  it('caps untrusted query input before decoding', () => {
    expect(parseCompareState(`?${'x'.repeat(8193)}`, defaults)).toEqual({ items: [] })
  })

  it('requires the current version marker before accepting URL models', () => {
    expect(parseCompareState('model=Qwen%2FOne', defaults)).toEqual({ items: [] })
  })

  it('exports the canonical validator for malformed and reserved public IDs', () => {
    expect(validateCompareModelId('Qwen/Model')).toEqual({ valid: true, canonicalId: 'Qwen/Model' })
    expect(validateCompareModelId('compare/workspace')).toEqual({ valid: false, reason: 'reserved' })
    expect(validateCompareModelId('bad/..')).toEqual({ valid: false, reason: 'malformed' })
  })

  it('normalizes owner/repo, Hugging Face URLs, and sizeof.ai URLs to one canonical model ID', () => {
    expect(normalizeCompareModelInput(' Qwen/Qwen3-8B ')).toBe('Qwen/Qwen3-8B')
    expect(normalizeCompareModelInput('https://huggingface.co/Qwen/Qwen3-8B?download=true')).toBe('Qwen/Qwen3-8B')
    expect(normalizeCompareModelInput('https://www.sizeof.ai/Qwen/Qwen3-8B?state=1')).toBe('Qwen/Qwen3-8B')
    expect(normalizeCompareModelInput('https://testnet.sizeof.ai/Qwen/Qwen3-8B')).toBe('Qwen/Qwen3-8B')
  })

  it('rejects lookalike and reserved URLs instead of accepting arbitrary hosts or routes', () => {
    expect(normalizeCompareModelInput('https://huggingface.example/Qwen/Qwen3-8B')).toBeNull()
    expect(normalizeCompareModelInput('https://testnet.sizeof.ai/api/models/Qwen/Qwen3-8B')).toBeNull()
    expect(normalizeCompareModelInput('https://sizeof.ai/compare')).toBeNull()
  })
})
