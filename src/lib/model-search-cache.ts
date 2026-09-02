const SEARCH_CACHE_STORAGE_KEY = 'sizeof.search-cache.v1'
const SEARCH_CACHE_LIMIT = 80

export interface HuggingFaceSearchModel {
  id: string
  owner: string
  name: string
  downloads: number
  likes: number
  task: string | null
  trendingScore: number
  gated: boolean
}

export interface HuggingFaceSearchResponse {
  query: string
  models: HuggingFaceSearchModel[]
  nextCursor?: string | null
}

export interface SearchCacheKeyInput {
  query: string
  author?: string
  modelType?: string
  cursor?: string
}

interface SearchCacheFile {
  entries: Array<[string, HuggingFaceSearchResponse]>
}

const memoryCache = new Map<string, HuggingFaceSearchResponse>()

export function createSearchCacheKey(input: SearchCacheKeyInput) {
  return JSON.stringify({
    query: input.query,
    author: input.author?.trim() ?? '',
    type: input.modelType?.trim() ?? '',
    cursor: input.cursor ?? '',
  })
}

function isSearchModel(value: unknown): value is HuggingFaceSearchModel {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return typeof item.id === 'string'
    && typeof item.owner === 'string'
    && typeof item.name === 'string'
    && typeof item.downloads === 'number'
    && typeof item.likes === 'number'
    && (item.task === null || typeof item.task === 'string')
    && typeof item.trendingScore === 'number'
    && typeof item.gated === 'boolean'
}

function isSearchResponse(value: unknown): value is HuggingFaceSearchResponse {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  if (typeof item.query !== 'string' || !Array.isArray(item.models)) return false
  if (item.nextCursor != null && typeof item.nextCursor !== 'string') return false
  return item.models.every(isSearchModel)
}

function readPersistedCache() {
  try {
    const raw = sessionStorage.getItem(SEARCH_CACHE_STORAGE_KEY)
    if (!raw) return
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || !('entries' in parsed)) return
    const entries = (parsed as SearchCacheFile).entries
    if (!Array.isArray(entries)) return
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !isSearchResponse(entry[1])) continue
      memoryCache.set(entry[0], entry[1])
    }
  } catch {
    // Ignore unavailable or unreadable session storage.
  }
}

function persistCache() {
  try {
    const file: SearchCacheFile = { entries: [...memoryCache.entries()] }
    sessionStorage.setItem(SEARCH_CACHE_STORAGE_KEY, JSON.stringify(file))
  } catch {
    // Quota or private-mode failures should not break search.
  }
}

let loaded = false
function ensureLoaded() {
  if (loaded) return
  loaded = true
  readPersistedCache()
}

export function readSearchCache(key: string) {
  ensureLoaded()
  return memoryCache.get(key) ?? null
}

export function writeSearchCache(key: string, value: HuggingFaceSearchResponse) {
  ensureLoaded()
  memoryCache.delete(key)
  memoryCache.set(key, value)
  while (memoryCache.size > SEARCH_CACHE_LIMIT) {
    const oldest = memoryCache.keys().next().value
    if (typeof oldest !== 'string') break
    memoryCache.delete(oldest)
  }
  persistCache()
}

export function clearSearchCacheForTests() {
  memoryCache.clear()
  loaded = false
  try {
    sessionStorage.removeItem(SEARCH_CACHE_STORAGE_KEY)
  } catch {
    // Ignore.
  }
}
