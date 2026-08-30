import { kvPrecisions, quantizations, type KvPrecisionId, type QuantizationId } from '../data/quantizations'

export interface CompareItemState {
  modelId: string
  quantization: QuantizationId
  context: number
  kvPrecision: KvPrecisionId
  mlaCacheMode: 'expanded' | 'latent'
  vramGiB: number
  source: string
  variantId: string | null
}

export interface CompareState {
  items: CompareItemState[]
}

const MAX_QUERY_LENGTH = 8192
const MAX_ITEM_LENGTH = 512
const MAX_ID_SEGMENT_LENGTH = 96
const MAX_CONTEXT = 16_777_216
const MAX_VRAM_GIB = 4096
const MAX_SOURCE_LENGTH = 96
const MAX_VARIANT_LENGTH = 120
const MODEL_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SOURCE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const VARIANT = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const RESERVED_IDS = new Set(['api', 'compare', 'assets', 'favicon.ico', 'robots.txt'])

function validModelId(value: string) {
  const parts = value.split('/')
  return parts.length === 2
    && parts.every((part) => part.length > 0 && part.length <= MAX_ID_SEGMENT_LENGTH && MODEL_SEGMENT.test(part))
    && !RESERVED_IDS.has(value.toLowerCase())
    && !RESERVED_IDS.has(parts[0].toLowerCase())
}

function validContext(value: number) {
  return Number.isSafeInteger(value) && value >= 1024 && value <= MAX_CONTEXT && value % 1024 === 0
}

function validVram(value: number) {
  return Number.isFinite(value) && value > 0 && value <= MAX_VRAM_GIB
}

function decode(value: string) {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return null
  }
}

function modelEntries(search: string) {
  if (search.length > MAX_QUERY_LENGTH) return []
  const values: string[] = []
  let versioned = false
  for (const entry of (search.startsWith('?') ? search.slice(1) : search).split('&')) {
    const separator = entry.indexOf('=')
    const key = decode(separator < 0 ? entry : entry.slice(0, separator))
    const value = decode(separator < 0 ? '' : entry.slice(separator + 1))
    if (key === 'compare' && value === '1') versioned = true
    if (key !== 'model') continue
    if (value !== null && value.length <= MAX_ITEM_LENGTH) values.push(value)
  }
  return versioned ? values : []
}

function safeSource(value: string | undefined, fallback: string) {
  return value && value.length <= MAX_SOURCE_LENGTH && SOURCE.test(value) ? value : fallback
}

function safeVariant(value: string | undefined) {
  return value && value.length <= MAX_VARIANT_LENGTH && VARIANT.test(value) ? value : null
}

export function parseCompareState(
  search: string,
  defaults: Omit<CompareItemState, 'modelId'>,
): CompareState {
  const items: CompareItemState[] = []
  const seen = new Set<string>()
  for (const rawItem of modelEntries(search)) {
    if (items.length === 4) break
    const [modelId, quantization, context, kvPrecision, mlaCacheMode, vramGiB, source, variantId] = rawItem.split('~')
    if (!validModelId(modelId)) continue
    const normalizedId = modelId.toLowerCase()
    if (seen.has(normalizedId)) continue
    seen.add(normalizedId)
    const parsedContext = Number(context)
    const parsedVram = Number(vramGiB)
    const parsedSource = safeSource(source, defaults.source)
    items.push({
      modelId,
      quantization: quantizations.some((item) => item.id === quantization)
        ? quantization as QuantizationId
        : defaults.quantization,
      context: validContext(parsedContext) ? parsedContext : defaults.context,
      kvPrecision: kvPrecisions.some((item) => item.id === kvPrecision)
        ? kvPrecision as KvPrecisionId
        : defaults.kvPrecision,
      mlaCacheMode: mlaCacheMode === 'expanded' || mlaCacheMode === 'latent' ? mlaCacheMode : defaults.mlaCacheMode,
      vramGiB: validVram(parsedVram) ? parsedVram : defaults.vramGiB,
      source: parsedSource,
      variantId: parsedSource === 'estimated' || variantId === 'none' ? null : safeVariant(variantId) ?? defaults.variantId,
    })
  }
  return { items }
}

export function serializeCompareState(state: CompareState): string {
  const uniqueItems: CompareItemState[] = []
  const seen = new Set<string>()
  for (const item of state.items) {
    if (uniqueItems.length === 4 || !validModelId(item.modelId)) continue
    const normalizedId = item.modelId.toLowerCase()
    if (seen.has(normalizedId)) continue
    seen.add(normalizedId)
    uniqueItems.push(item)
  }
  return [
    'compare=1',
    ...uniqueItems.map((item) => {
      const source = safeSource(item.source, 'estimated')
      const variantId = source === 'estimated' ? 'none' : safeVariant(item.variantId ?? undefined) ?? 'none'
      const values = [
        item.modelId,
        quantizations.some((option) => option.id === item.quantization) ? item.quantization : 'q4_k_m',
        validContext(item.context) ? String(item.context) : '8192',
        kvPrecisions.some((option) => option.id === item.kvPrecision) ? item.kvPrecision : 'fp16',
        item.mlaCacheMode === 'latent' ? 'latent' : 'expanded',
        validVram(item.vramGiB) ? String(item.vramGiB) : '32',
        source,
        variantId,
      ]
      return `model=${encodeURIComponent(values.join('~'))}`
    }),
  ].join('&')
}
