import { normalizeHuggingFaceModel, parseHuggingFaceModelPath } from '../src/lib/huggingface'

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const responseHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
}

function json(data: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...responseHeaders, ...headers },
  })
}

function apiRoute(pathname: string) {
  const prefix = '/api/models/'
  if (!pathname.startsWith(prefix)) return null
  return parseHuggingFaceModelPath(`/${pathname.slice(prefix.length)}`)
}

export function createModelCacheKey(request: Request) {
  const url = new URL(request.url)
  url.searchParams.set('__sizeof_cache', 'hf-model-v2')
  return new Request(url.toString())
}

export async function handleModelApi(request: Request, fetcher: Fetcher = fetch): Promise<Response> {
  const route = apiRoute(new URL(request.url).pathname)
  if (!route) return json({ error: 'Invalid Hugging Face model path' }, 400)

  const owner = encodeURIComponent(route.owner)
  const repo = encodeURIComponent(route.repo)
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'sizeof.ai/1.0 (+https://sizeof.ai)',
  }
  const metadataUrl = new URL(`https://huggingface.co/api/models/${owner}/${repo}`)
  for (const field of [
    'author',
    'cardData',
    'disabled',
    'downloads',
    'gated',
    'lastModified',
    'library_name',
    'likes',
    'pipeline_tag',
    'private',
    'safetensors',
    'sha',
    'tags',
  ]) metadataUrl.searchParams.append('expand', field)

  const metadataResponse = await fetcher(metadataUrl.toString(), { headers })

  if ([401, 403, 404].includes(metadataResponse.status)) {
    return json({ error: 'Model not found or private' }, 404)
  }
  if (metadataResponse.status === 429) {
    return json(
      { error: 'Hugging Face rate limit reached. Try again shortly.' },
      503,
      { 'Retry-After': metadataResponse.headers.get('Retry-After') ?? '60' },
    )
  }
  if (!metadataResponse.ok) return json({ error: 'Hugging Face is temporarily unavailable' }, 502)

  try {
    const metadata: unknown = await metadataResponse.json()
    const revision = typeof metadata === 'object' && metadata !== null && 'sha' in metadata && typeof metadata.sha === 'string'
      ? metadata.sha
      : 'main'
    const configResponse = await fetcher(
      `https://huggingface.co/${owner}/${repo}/resolve/${encodeURIComponent(revision)}/config.json`,
      { headers },
    )
    const config: unknown = configResponse.ok ? await configResponse.json() : {}
    return json(normalizeHuggingFaceModel(metadata, config))
  } catch (error) {
    console.error(JSON.stringify({
      message: 'failed to normalize Hugging Face model',
      model: `${route.owner}/${route.repo}`,
      error: error instanceof Error ? error.message : String(error),
    }))
    return json({ error: 'Hugging Face returned an unreadable response' }, 502)
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/models/')) return env.ASSETS.fetch(request)

    const cache = caches.default
    const cacheKey = createModelCacheKey(request)
    const cached = await cache.match(cacheKey)
    if (cached) return cached

    const response = await handleModelApi(request)
    if (response.ok) ctx.waitUntil(cache.put(cacheKey, response.clone()))
    return response
  },
} satisfies ExportedHandler<Env>
