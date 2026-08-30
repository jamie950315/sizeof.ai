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

  it('round-trips every reproducible calculator field and a hardware summary', () => {
    const state: DetailCalculatorState = {
      quantization: 'q6_k', context: 32768, kvPrecision: 'q8_0', mlaCacheMode: 'latent',
      vramGiB: 64, selectedSource: 'mlx-community', selectedVariantId: 'abc:weights.gguf',
      hardwareProfile: {
        kind: 'discrete-gpu', label: 'RTX workstation', capacityGiB: 64, reservedGiB: 4, systemRamGiB: 128,
      },
    }

    const search = serializeDetailState(state)
    expect(search).toBe('quant=q6_k&ctx=32768&kv=q8_0&mla=latent&vram=64&source=mlx-community&variant=abc%3Aweights.gguf&hardware=' + encodeURIComponent('{"version":1,"profile":{"kind":"discrete-gpu","label":"RTX workstation","capacityGiB":64,"reservedGiB":4,"systemRamGiB":128}}'))
    expect(parseDetailState(search, defaults)).toEqual(state)
  })

  it('falls back field by field and discards malformed source, variants, and hardware', () => {
    const parsed = parseDetailState(
      '?quant=nope&ctx=999&kv=nope&mla=nope&vram=17&source=' + 'x'.repeat(121)
        + '&variant=../../secret&hardware=%7Bbad',
      defaults,
    )

    expect(parsed).toEqual(defaults)
  })

  it('does not serialize unknown query parameters', () => {
    const parsed = parseDetailState('?unknown=value&ctx=16384', defaults)
    expect(serializeDetailState(parsed)).toBe('quant=q4_k_m&ctx=16384&kv=fp16&mla=expanded&vram=32&source=estimated')
  })

  it('keeps optional defaults when their URL values are invalid', () => {
    const defaultsWithOptionalState: DetailCalculatorState = {
      ...defaults,
      selectedVariantId: 'known:variant',
      hardwareProfile: {
        kind: 'unified-memory', label: 'M-series', capacityGiB: 32, reservedGiB: 4,
      },
    }

    expect(parseDetailState('?variant=../../unsafe&hardware=%7Bbad', defaultsWithOptionalState))
      .toEqual(defaultsWithOptionalState)
  })
})
