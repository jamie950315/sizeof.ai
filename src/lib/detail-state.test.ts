import { describe, expect, it } from 'vitest'
import { parseDetailState, serializeDetailState, type DetailCalculatorState } from './detail-state'

describe('detail calculator URL state', () => {
  const defaults: DetailCalculatorState = {
    quantization: 'q4_k_m',
    context: 8192,
    kvPrecision: 'fp16',
    mlaCacheMode: 'expanded',
    vramGiB: 32,
    selectedSource: 'estimated',
    selectedVariantId: null,
  }

  it('round-trips every reproducible calculator field including a bounded custom capacity without hardware metadata', () => {
    const state: DetailCalculatorState = {
      quantization: 'q6_k', context: 32768, kvPrecision: 'q8_0', mlaCacheMode: 'latent',
      vramGiB: 40, selectedSource: 'mlx-community', selectedVariantId: 'abc:weights.gguf',
    }

    const search = serializeDetailState(state)
    expect(search).toBe('state=1&quant=q6_k&ctx=32768&kv=q8_0&mla=latent&vram=40&source=mlx-community&variant=abc%3Aweights.gguf')
    expect(parseDetailState(search, defaults)).toEqual(state)
  })

  it('falls back field by field and discards malformed source, variants, and out-of-bounds capacity', () => {
    const parsed = parseDetailState(
      '?quant=nope&ctx=999&kv=nope&mla=nope&vram=5000&source=' + 'x'.repeat(121)
        + '&variant=../../secret',
      defaults,
    )

    expect(parsed).toEqual(defaults)
  })

  it('does not serialize unknown query parameters', () => {
    const parsed = parseDetailState('?unknown=value&ctx=16384', defaults)
    expect(serializeDetailState(parsed)).toBe('state=1&quant=q4_k_m&ctx=16384&kv=fp16&mla=expanded&vram=32&source=estimated&variant=none')
  })

  it('preserves manually entered non-preset context in shared links', () => {
    const state = { ...defaults, context: 5000 }
    expect(parseDetailState(serializeDetailState(state), defaults)).toEqual(state)
  })

  it('clears stale estimated variants without carrying profile metadata', () => {
    const defaultsWithOptionalState: DetailCalculatorState = {
      ...defaults,
      selectedVariantId: 'known:variant',
    }

    expect(parseDetailState('?variant=../../unsafe', defaultsWithOptionalState))
      .toEqual({ ...defaultsWithOptionalState, selectedVariantId: null })
  })

  it('round-trips explicit null optional state across browsers with stale defaults', () => {
    const staleDefaults: DetailCalculatorState = {
      ...defaults,
      selectedSource: 'mlx-community',
      selectedVariantId: 'stale:variant',
    }
    const intentionallyCleared: DetailCalculatorState = {
      ...defaults,
      selectedSource: 'estimated',
      selectedVariantId: null,
    }

    const serialized = serializeDetailState(intentionallyCleared)
    expect(serialized).toContain('state=1')
    expect(serialized).toContain('variant=none')
    expect(serialized).not.toContain('hardware=')
    expect(parseDetailState(serialized, staleDefaults)).toEqual(intentionallyCleared)
    expect(parseDetailState('?source=estimated', staleDefaults).selectedVariantId).toBeNull()
  })
})
