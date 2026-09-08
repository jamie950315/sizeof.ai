import { readUpstreamJson } from './upstream'
import { parseHuggingFaceModelPath } from '../src/lib/huggingface'

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
  const parsedBase = new URL(base)
  if (parsedBase.protocol !== 'https:' || parsedBase.username || parsedBase.password || parsedBase.search || parsedBase.hash) {
    throw new Error('index URL must be an HTTPS base without credentials or query')
  }
  const response = await fetch(`${trimBase(base)}${searchPath(requestUrl)}`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    signal,
    redirect: 'manual',
  })
  if (!response.ok) throw new Error(`index ${response.status}`)
  const payload = await readUpstreamJson(response) as PrefixSearchResult
  const expectedQuery = new URL(requestUrl).searchParams.get('q')?.trim()
  if (!payload || !Array.isArray(payload.models) || payload.models.length > 12
    || payload.query !== expectedQuery || typeof payload.source !== 'string'
    || !/^[a-z0-9_-]{1,32}$/i.test(payload.source)
    || !Number.isSafeInteger(payload.indexSize) || payload.indexSize! < 0
    || (payload.nextCursor != null && (typeof payload.nextCursor !== 'string' || !/^\d{1,7}$/.test(payload.nextCursor)))) {
    throw new Error('index unreadable')
  }
  const ids = new Set<string>()
  for (const raw of payload.models) {
    if (!raw || typeof raw !== 'object' || !('id' in raw) || typeof raw.id !== 'string'
      || !parseHuggingFaceModelPath(`/${raw.id}`) || ids.has(raw.id) || ('private' in raw && raw.private === true)) {
      throw new Error('index returned invalid or duplicate model data')
    }
    ids.add(raw.id)
    const row = raw as Record<string, unknown>
    const route = parseHuggingFaceModelPath(`/${raw.id}`)!
    if (row.owner !== route.owner || row.name !== route.repo || typeof row.gated !== 'boolean'
      || (row.task !== null && typeof row.task !== 'string')
      || ['downloads', 'likes', 'trendingScore'].some((key) => typeof row[key] !== 'number'
        || !Number.isFinite(row[key]) || (row[key] as number) < 0)) {
      throw new Error('index returned incomplete model data')
    }
  }
  if ((payload.indexSize ?? 0) <= 0) throw new Error('index empty')
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
