export type QuantizationId =
  | 'fp16'
  | 'q8_0'
  | 'q6_k'
  | 'q5_k_m'
  | 'q4_k_m'
  | 'q3_k_m'
  | 'q2_k'
  | 'q1'

export type KvPrecisionId = 'fp16' | 'q8_0' | 'q4_0'

export interface QuantizationSpec {
  id: QuantizationId
  label: string
  bitsPerWeight: number
  note: string
}

export const quantizations: QuantizationSpec[] = [
  { id: 'fp16', label: '16bit', bitsPerWeight: 16, note: 'Highest fidelity' },
  { id: 'q8_0', label: '8bit', bitsPerWeight: 8.5, note: 'Near-lossless' },
  { id: 'q6_k', label: '6bit', bitsPerWeight: 6.57, note: 'Very high quality' },
  { id: 'q5_k_m', label: '5bit', bitsPerWeight: 5.68, note: 'High quality' },
  { id: 'q4_k_m', label: '4bit', bitsPerWeight: 4.85, note: 'Best balance' },
  { id: 'q3_k_m', label: '3bit', bitsPerWeight: 3.91, note: 'Memory first' },
  { id: 'q2_k', label: '2bit', bitsPerWeight: 3.35, note: 'Maximum compression' },
  { id: 'q1', label: '1bit', bitsPerWeight: 1, note: 'Extreme compression estimate' },
]

export const kvPrecisions: { id: KvPrecisionId; label: string; bytes: number }[] = [
  { id: 'fp16', label: 'FP16', bytes: 2 },
  { id: 'q8_0', label: 'Q8_0', bytes: 1 },
  { id: 'q4_0', label: 'Q4_0', bytes: 0.5 },
]
