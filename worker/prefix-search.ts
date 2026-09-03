export interface PrefixSearchEnv {
  SIZEOF_SEARCH_JP_URL?: string
  SIZEOF_SEARCH_US_URL?: string
  SIZEOF_SEARCH_TOKEN?: string
}

export interface PrefixSearchResult {
  query: string
  models: unknown[]
  nextCursor?: string | null
  source: string
  indexSize?: number
}

function trimBase(url: string) {
  return url.replace(/\/$/, '')
}

function searchPath(requestUrl: string) {
  const url = new URL(requestUrl)
  const path = new URL('/search', 'https://sizeof.internal')
  path.search = url.search
  return `${path.pathname}${path.search}`
}

async function fetchIndex(base: string, token: string, requestUrl: string, signal: AbortSignal) {
  const response = await fetch(`${trimBase(base)}${searchPath(requestUrl)}`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    signal,
  })
  if (!response.ok) throw new Error(`index ${response.status}`)
  const payload = await response.json() as PrefixSearchResult
  if (!Array.isArray(payload.models)) throw new Error('index unreadable')
  if ((payload.indexSize ?? 0) <= 0 && payload.models.length === 0) throw new Error('index empty')
  return payload
}

export async function racePrefixSearch(
  env: PrefixSearchEnv,
  requestUrl: string,
  timeoutMs = 4_000,
): Promise<{ result: PrefixSearchResult | null; miss?: string }> {
  const token = env.SIZEOF_SEARCH_TOKEN?.trim()
  const urls = [env.SIZEOF_SEARCH_JP_URL, env.SIZEOF_SEARCH_US_URL]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
  if (!token || urls.length === 0) return { result: null, miss: token ? 'no-index-urls' : 'no-index-token' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const result = await Promise.any(urls.map((base) => fetchIndex(base, token, requestUrl, controller.signal)))
    controller.abort()
    return { result }
  } catch (error) {
    const detail = error instanceof AggregateError
      ? error.errors.map((item) => item instanceof Error ? item.message : String(item)).join('; ')
      : error instanceof Error ? error.message : String(error)
    console.warn(JSON.stringify({ message: 'prefix search race missed', hosts: urls.length, detail }))
    return { result: null, miss: detail.slice(0, 180) }
  } finally {
    clearTimeout(timer)
  }
}
