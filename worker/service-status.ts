import { readBoundedBody } from './upstream'
import type { PrefixSearchEnv } from './prefix-search'

type Region = { id: 'jp' | 'us'; label: string; reachable: boolean; ready: boolean | null; syncHealthy: boolean | null; models: number | null; updatedAt: string | null; generation: string | null; stale: boolean | null; lastSyncAt: string | null; initialBackfillComplete: boolean | null; lastFullBackfillAt: string | null; error: string | null }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
function date(value: unknown, now: number): string | null {
  if (value == null) return null
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value)) || Date.parse(value) > now + 60_000) throw new Error('Invalid date')
  return new Date(value).toISOString()
}

async function regionStatus(id: 'jp' | 'us', base: string | undefined, now: number, signal: AbortSignal): Promise<Region> {
  const result: Region = { id, label: id === 'jp' ? 'Osaka' : 'San Jose', reachable: false, ready: null, syncHealthy: null, models: null, updatedAt: null, generation: null, stale: null, lastSyncAt: null, initialBackfillComplete: null, lastFullBackfillAt: null, error: null }
  if (!base) return { ...result, error: 'not-configured' }
  try {
    const url = new URL(base)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return { ...result, error: 'invalid-configuration' }
    url.pathname = url.pathname.replace(/\/$/, '') + '/health'
    const response = await fetch(url.toString(), { redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]), headers: { Accept: 'application/json', 'User-Agent': 'sizeof.ai-status/1.0' } })
    if (response.status !== 200 && response.status !== 503) { await response.body?.cancel(); return { ...result, error: `http-${response.status}` } }
    const value: unknown = JSON.parse(new TextDecoder().decode(await readBoundedBody(response, 32768)))
    if (!record(value) || value.host !== id || typeof value.ready !== 'boolean' || typeof value.syncHealthy !== 'boolean'
      || typeof value.models !== 'number' || !Number.isSafeInteger(value.models) || value.models < 0 || value.models > 100_000_000
      || (value.generation != null && (typeof value.generation !== 'string' || !/^[a-f0-9]{64}$/.test(value.generation)))) return { ...result, error: 'invalid-response' }
    const updatedAt = date(value.updatedAt, now)
    let lastSyncAt: string | null = null
    if (record(value.sync) && typeof value.sync.checkedAt === 'number' && Number.isFinite(value.sync.checkedAt) && value.sync.checkedAt >= 0 && value.sync.checkedAt * 1000 <= now + 60_000) lastSyncAt = new Date(value.sync.checkedAt * 1000).toISOString()
    return { ...result, reachable: true, ready: value.ready, syncHealthy: value.syncHealthy, models: value.models,
      updatedAt, generation: typeof value.generation === 'string' ? value.generation : null,
      stale: updatedAt ? now - Date.parse(updatedAt) > 8 * 3600_000 : null, lastSyncAt,
      initialBackfillComplete: typeof value.initialBackfillComplete === 'boolean' ? value.initialBackfillComplete : null,
      lastFullBackfillAt: date(value.lastFullBackfillAt, now), error: response.status === 503 ? 'reported-degraded' : null }
  } catch { return { ...result, error: 'route-unreachable-or-invalid' } }
}

export async function handleServiceStatus(request: Request, env: PrefixSearchEnv): Promise<Response> {
  if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET', 'Cache-Control': 'no-store' } })
  const now = Date.now()
  const regions = await Promise.all([regionStatus('jp', env.SIZEOF_SEARCH_JP_URL, now, request.signal), regionStatus('us', env.SIZEOF_SEARCH_US_URL, now, request.signal)])
  const comparable = regions.every(region => region.reachable && region.ready && region.generation)
  const alignment = !comparable ? 'unknown' : regions[0].generation === regions[1].generation && regions[0].models === regions[1].models ? 'aligned' : 'different'
  return Response.json({ checkedAt: new Date(now).toISOString(), regions, alignment, completeness: 'not-guaranteed',
    coverageNote: 'Public model names discovered by the indexer. Initial backfill completion and matching replicas do not prove a complete live Hugging Face catalog. New-name discovery uses a five-known-pages cutoff; deletions and older newly public models may require another full audit. Model-detail caches and documentation have separate refresh times.' },
  { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
}
