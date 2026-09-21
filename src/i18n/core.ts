import messages from './messages.json'

export const LANGUAGES = [
  { code: 'en', label: 'English' }, { code: 'zh-CN', label: '简体中文' },
  { code: 'zh-TW', label: '繁體中文' }, { code: 'ja', label: '日本語' },
  { code: 'es', label: 'Español' }, { code: 'ru', label: 'Русский' },
  { code: 'de', label: 'Deutsch' }, { code: 'fr', label: 'Français' },
  { code: 'pt', label: 'Português' }, { code: 'ko', label: '한국어' },
  { code: 'ar', label: 'العربية' }, { code: 'hi', label: 'हिन्दी' },
  { code: 'id', label: 'Bahasa Indonesia' },
] as const
export type Locale = typeof LANGUAGES[number]['code']
export const catalogs: Partial<Record<Locale, Record<string, string>>> = { en: messages }
export function registerCatalog(locale: Locale, catalog: Record<string, string>) { catalogs[locale] = catalog }
let activeLocale: Locale = 'en'
export function getActiveLocale() { return activeLocale }
export function setActiveLocale(locale: Locale) { activeLocale = locale }
export function resolveLocale(value: unknown): Locale | undefined {
  return LANGUAGES.find(item => item.code === value)?.code
}
const protectedTerms = new Set(['sizeof', '.ai', 'sizeof.ai', 'GiB', 'GIB', 'GB', 'MB', 'TB', 'KB', 'B', 'L', 'KV', 'KVH', 'VRAM', 'RAM', 'CPU', 'GPU', 'FP16', 'FP32', 'BF16', 'Qwen', 'OpenBMB', 'Unsloth', 'Bartowski', 'Hugging Face', 'MLX', 'GGUF', 'EXL2', 'EXL3', 'CUDA', 'ROCm', 'MTP', 'MLA', 'KDA', 'SSM', 'MoE', 'vLLM', 'llama.cpp', 'macOS', 'Linux', 'Windows', 'Apple', 'NVIDIA'])

/** Translate published UI prose only. Identifiers and user-entered data remain unchanged. */
export function translate(text: string, locale: Locale = activeLocale): string {
  if (locale === 'en' || !text) return text
  if (protectedTerms.has(text.trim())) return text
  const dictionary = catalogs[locale]
  if (!dictionary) return text
  if (Object.hasOwn(dictionary, text)) return dictionary[text]
  const trimmed = text.trim()
  if (trimmed !== text && Object.hasOwn(dictionary, trimmed)) return text.replace(trimmed, dictionary[trimmed])
  return text
}

/** Format one explicit source message. Values are opaque and are never translated. */
export function formatMessage(key: string, values: readonly unknown[], locale: Locale = activeLocale): string {
  return translate(key, locale).replace(/\{(\d+)\}/g, (placeholder, slot: string) => {
    const value = values[Number(slot)]
    return value === undefined ? placeholder : String(value)
  })
}

export function localizeNode<T>(value: T): T {
  if (typeof value === 'string') return translate(value) as T
  if (Array.isArray(value)) return value.map(item => localizeNode(item)) as T
  return value
}

/** Language is routing metadata, not a calculator/runbook schema field. */
export function routingSearch(search: string): string {
  const params = new URLSearchParams(search)
  params.delete('lang')
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function localizeHref(href: string, locale: Locale = activeLocale, origin?: string): string {
  if (!href || href.startsWith('#') || /^(?:mailto:|tel:|data:|blob:|javascript:)/i.test(href)) return href
  const browser = (globalThis as unknown as { window?: { location: { origin: string; search?: string } } }).window
  const base = origin ?? browser?.location.origin ?? 'https://testnet.sizeof.ai'
  try {
    const url = new URL(href, base)
    const baseUrl = new URL(base)
    if (url.hostname === 'docs.sizeof.ai' && baseUrl.hostname === 'testnet.sizeof.ai') {
      url.hostname = baseUrl.hostname
      url.pathname = `/docs${url.pathname === '/' ? '' : url.pathname}`
    }
    if (url.origin !== baseUrl.origin && !['docs.sizeof.ai', 'testnet.sizeof.ai'].includes(url.hostname)) return href
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/assets/')) return href
    if (locale !== 'en' || url.searchParams.has('lang') || browser?.location.search && new URLSearchParams(browser.location.search).has('lang')) url.searchParams.set('lang', locale)
    return href.startsWith('/') && url.origin === baseUrl.origin ? `${url.pathname}${url.search}${url.hash}` : url.href
  } catch { return href }
}

/** Localize human-readable exports without changing fenced commands, URLs or backup schemas. */
export function localizeOutput(text: string): string {
  if (/^https?:\/\/\S+$/.test(text)) return localizeHref(text)
  if (/^(?:curl\b|hf download\b|llama(?:-server| cli)\b|vllm\b|mlx_lm\.|python\b|source\b)/.test(text.trim())) return text
  let fenced = false
  return text.split('\n').map(line => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return line }
    if (fenced) return line
    const whole = translate(line)
    if (whole !== line) return whole
    const prefix = /^(\s*(?:#{1,6} |[-*] (?:\[ \] )?|\d+\. ))/.exec(line)?.[0] ?? ''
    const content = line.slice(prefix.length)
    const direct = translate(content)
    if (direct !== content) return prefix + direct
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(content)
    if (link) return `${prefix}[${translate(link[1])}](${localizeHref(link[2])})`
    const label = /^([^:]+): (.*)$/.exec(content)
    if (label) return `${prefix}${translate(label[1])}: ${label[2]}`
    if (content.startsWith('|')) return prefix + content.split('|').map(cell => translate(cell)).join('|')
    return line
  }).join('\n')
}
