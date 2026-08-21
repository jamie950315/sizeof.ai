import type { KvPrecisionId, QuantizationId } from '../data/quantizations'
import { kvPrecisions, quantizations } from '../data/quantizations'

export interface CalculatorState {
  modelId: string
  quantization: QuantizationId
  context: number
  kvPrecision: KvPrecisionId
}

export const defaultCalculatorState: CalculatorState = {
  modelId: 'qwen3.8-27b',
  quantization: 'q4_k_m',
  context: 8192,
  kvPrecision: 'fp16',
}

export function parseCalculatorState(search: string): CalculatorState {
  const params = new URLSearchParams(search)
  const quant = params.get('quant')
  const kv = params.get('kv')
  const context = Number(params.get('ctx'))

  return {
    modelId: params.get('model') || defaultCalculatorState.modelId,
    quantization: quantizations.some((item) => item.id === quant)
      ? (quant as QuantizationId)
      : defaultCalculatorState.quantization,
    context:
      Number.isInteger(context) && context > 0 ? context : defaultCalculatorState.context,
    kvPrecision: kvPrecisions.some((item) => item.id === kv)
      ? (kv as KvPrecisionId)
      : defaultCalculatorState.kvPrecision,
  }
}

export function serializeCalculatorState(state: CalculatorState): string {
  return new URLSearchParams({
    model: state.modelId,
    quant: state.quantization,
    ctx: String(state.context),
    kv: state.kvPrecision,
  }).toString()
}
