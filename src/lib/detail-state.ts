import { kvPrecisions, quantizations, type KvPrecisionId, type QuantizationId } from '../data/quantizations'

export interface DetailCalculatorState {
  quantization: QuantizationId
  context: number
  kvPrecision: KvPrecisionId
  mlaCacheMode: 'expanded' | 'latent'
  vramGiB: number
  selectedSource: string
  selectedVariantId: string | null
}

const MAX_CONTEXT = 16_777_216
const MAX_SOURCE_LENGTH = 96
const MAX_VARIANT_LENGTH = 120
const VRAM_CAPACITIES = new Set([8, 12, 16, 24, 32, 36, 48, 64, 80, 96, 128, 192, 256, 384, 512])
const MAX_CUSTOM_VRAM_GIB = 4096
const SOURCE_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i
const VARIANT_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/i

function validContext(value: number) {
  return Number.isSafeInteger(value) && value >= 1024 && value <= MAX_CONTEXT
}

function validVram(value: number) {
  return VRAM_CAPACITIES.has(value) || (Number.isFinite(value) && value > 0 && value <= MAX_CUSTOM_VRAM_GIB)
}

function safeSource(value: string | null, fallback: string) {
  return value !== null && value.length <= MAX_SOURCE_LENGTH && SOURCE_PATTERN.test(value) ? value : fallback
}

function safeVariant(value: string | null) {
  return value !== null && value.length <= MAX_VARIANT_LENGTH && VARIANT_PATTERN.test(value) ? value : null
}

function decodeQueryPart(value: string): string | null {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return null
  }
}

function parseQuery(search: string): Map<string, string> {
  const values = new Map<string, string>()
  const query = search.startsWith('?') ? search.slice(1) : search
  for (const part of query.split('&')) {
    if (!part) continue
    const separator = part.indexOf('=')
    const key = decodeQueryPart(separator < 0 ? part : part.slice(0, separator))
    const value = decodeQueryPart(separator < 0 ? '' : part.slice(separator + 1))
    if (key !== null && value !== null && !values.has(key)) values.set(key, value)
  }
  return values
}

function serializeQuery(entries: Array<[string, string]>): string {
  return entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')
}

export function parseDetailState(search: string, defaults: DetailCalculatorState): DetailCalculatorState {
  const params = parseQuery(search)
  const versioned = params.get('state') === '1'
  const quantization = params.get('quant') ?? null
  const kvPrecision = params.get('kv') ?? null
  const context = Number(params.get('ctx') ?? null)
  const vramGiB = Number(params.get('vram') ?? null)
  const mlaCacheMode = params.get('mla') ?? null
  const selectedSource = safeSource(params.get('source') ?? null, defaults.selectedSource)
  const variantValue = params.get('variant') ?? null

  return {
    quantization: quantizations.some((item) => item.id === quantization)
      ? quantization as QuantizationId
      : defaults.quantization,
    context: validContext(context) ? context : defaults.context,
    kvPrecision: kvPrecisions.some((item) => item.id === kvPrecision)
      ? kvPrecision as KvPrecisionId
      : defaults.kvPrecision,
    mlaCacheMode: mlaCacheMode === 'expanded' || mlaCacheMode === 'latent'
      ? mlaCacheMode
      : defaults.mlaCacheMode,
    vramGiB: validVram(vramGiB) ? vramGiB : defaults.vramGiB,
    selectedSource,
    selectedVariantId: selectedSource === 'estimated' || (versioned && variantValue === 'none')
      ? null
      : params.has('variant')
        ? safeVariant(variantValue) ?? defaults.selectedVariantId
      : defaults.selectedVariantId,
  }
}

export function serializeDetailState(state: DetailCalculatorState): string {
  const entries: Array<[string, string]> = [
    ['state', '1'],
    ['quant', state.quantization],
    ['ctx', String(state.context)],
    ['kv', state.kvPrecision],
    ['mla', state.mlaCacheMode],
    ['vram', String(state.vramGiB)],
    ['source', state.selectedSource],
  ]
  entries.push(['variant', state.selectedVariantId ?? 'none'])
  return serializeQuery(entries)
}
