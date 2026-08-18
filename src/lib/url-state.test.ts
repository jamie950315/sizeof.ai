import { describe, expect, it } from 'vitest'
import { parseCalculatorState, serializeCalculatorState } from './url-state'

describe('calculator URL state', () => {
  it('parses a valid shareable configuration', () => {
    expect(parseCalculatorState('?model=qwen3-8b&quant=q4_k_m&ctx=32768&kv=q8_0')).toEqual({
      modelId: 'qwen3-8b',
      quantization: 'q4_k_m',
      context: 32768,
      kvPrecision: 'q8_0',
    })
  })

  it('falls back safely when URL values are malformed', () => {
    expect(parseCalculatorState('?quant=made-up&ctx=-1')).toEqual({
      modelId: 'llama-3.1-8b',
      quantization: 'q4_k_m',
      context: 8192,
      kvPrecision: 'fp16',
    })
  })

  it('serializes without unrelated query parameters', () => {
    expect(
      serializeCalculatorState({
        modelId: 'phi-4-14b',
        quantization: 'q6_k',
        context: 16384,
        kvPrecision: 'fp16',
      }),
    ).toBe('model=phi-4-14b&quant=q6_k&ctx=16384&kv=fp16')
  })
})
