import { readBoundedBody } from './upstream'

const MODEL_CACHE_VERSION = 4
const MODEL_CACHE_FRESH_MS = 24 * 60 * 60 * 1_000
const MODEL_CACHE_STALE_MS = 7 * 24 * 60 * 60 * 1_000
const MODEL_CACHE_MAX_AGE_MS = MODEL_CACHE_FRESH_MS + MODEL_CACHE_STALE_MS
const MODEL_CACHE_MAX_BODY_LENGTH = 4 * 1024 * 1024
const MODEL_CACHE_EXPIRATION_SECONDS = 30 * 24 * 60 * 60

export const modelResponseHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=300',
  'Cloudflare-CDN-Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800, stale-if-error=604800',
}

export interface ModelCacheEntry {
  version: 4
  fetchedAt: number
  body: string
}

export interface CachedModelResponse {
  entry: ModelCacheEntry
  ageMs: number
  state: 'fresh' | 'stale'
}

export interface ModelCacheNamespace {
  get(key: string, options: { type: 'json'; cacheTtl: number }): Promise<unknown>
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>
}

function isModelCacheEntry(value: unknown): value is ModelCacheEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return entry.version === MODEL_CACHE_VERSION
    && typeof entry.fetchedAt === 'number'
    && Number.isFinite(entry.fetchedAt)
    && typeof entry.body === 'string'
    && entry.body.length > 0
    && entry.body.length <= MODEL_CACHE_MAX_BODY_LENGTH
}

function cachedBodyMatchesKey(body: string, key: string) {
  const match = /^model-response-v4:([^/]+)\/(.+)$/.exec(key)
  if (!match) return false
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed !== 'object' || parsed === null || !('id' in parsed)) return false
    const id = (parsed as { id?: unknown }).id
    const expectedId = `${decodeURIComponent(match[1]!)}/${decodeURIComponent(match[2]!)}`
    return typeof id === 'string' && id.toLowerCase() === expectedId.toLowerCase()
  } catch {
    return false
  }
}

export function createModelKvKey(owner: string, repo: string) {
  return `model-response-v4:${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
}

export async function readModelResponse(
  namespace: ModelCacheNamespace,
  key: string,
  now = Date.now(),
): Promise<CachedModelResponse | null> {
  let value: unknown
  try {
    value = await namespace.get(key, { type: 'json', cacheTtl: 60 })
  } catch (error) {
    console.error(JSON.stringify({
      message: 'failed to read model response from KV',
      key,
      error: error instanceof Error ? error.message : String(error),
    }))
    return null
  }
  if (value === null) return null
  if (!isModelCacheEntry(value) || !cachedBodyMatchesKey(value.body, key)) {
    console.error(JSON.stringify({ message: 'Invalid model cache entry rejected', key }))
    return null
  }
  if (value.fetchedAt > now) return null
  const ageMs = now - value.fetchedAt
  if (ageMs >= MODEL_CACHE_MAX_AGE_MS) return null
  return {
    entry: value,
    ageMs,
    state: ageMs < MODEL_CACHE_FRESH_MS ? 'fresh' : 'stale',
  }
}

export function modelResponseFromCache(cached: CachedModelResponse): Response {
  const remainingFreshSeconds = Math.max(
    0,
    Math.ceil((MODEL_CACHE_FRESH_MS - cached.ageMs) / 1_000),
  )
  const remainingStaleSeconds = Math.max(
    0,
    Math.ceil((MODEL_CACHE_MAX_AGE_MS - cached.ageMs) / 1_000),
  )
  const edgeCacheControl = cached.state === 'fresh'
    ? `public, max-age=${remainingFreshSeconds}, stale-while-revalidate=604800, stale-if-error=604800`
    : `public, max-age=0, stale-while-revalidate=${Math.min(60, remainingStaleSeconds)}, stale-if-error=${remainingStaleSeconds}`

  return new Response(cached.entry.body, {
    headers: {
      ...modelResponseHeaders,
      'Cloudflare-CDN-Cache-Control': edgeCacheControl,
      'X-Sizeof-Model-Source': cached.state === 'fresh' ? 'kv' : 'kv-stale',
    },
  })
}

export async function readFreshModelResponse(
  namespace: ModelCacheNamespace,
  key: string,
  now = Date.now(),
): Promise<Response | null> {
  const cached = await readModelResponse(namespace, key, now)
  return cached?.state === 'fresh' ? modelResponseFromCache(cached) : null
}

export function queueModelResponseWrite(
  namespace: ModelCacheNamespace,
  key: string,
  response: Response,
  ctx: ExecutionContext,
  fetchedAt = Date.now(),
) {
  ctx.waitUntil((async () => {
    const body = new TextDecoder().decode(await readBoundedBody(response, MODEL_CACHE_MAX_BODY_LENGTH))
    if (!cachedBodyMatchesKey(body, key)) throw new Error('Model cache identity mismatch')
    const entry: ModelCacheEntry = {
      version: MODEL_CACHE_VERSION,
      fetchedAt,
      body,
    }
    await namespace.put(key, JSON.stringify(entry), {
      expirationTtl: MODEL_CACHE_EXPIRATION_SECONDS,
    })
  })().catch((error) => {
    console.error(JSON.stringify({
      message: 'failed to write model response to KV',
      key,
      error: error instanceof Error ? error.message : String(error),
    }))
  }))
}
