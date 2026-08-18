import {
  getHuggingFaceParameterCount,
  normalizeHuggingFaceModel,
  parseHuggingFaceModelPath,
} from '../src/lib/huggingface'

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
  url.search = ''
  url.searchParams.set('__sizeof_cache', 'hf-model-v6')
  return new Request(url.toString())
}

export function applyAssetCachePolicy(response: Response) {
  if (!response.headers.get('Content-Type')?.includes('text/html')) return response

  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-cache')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
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
    'gguf',
    'lastModified',
    'library_name',
    'likes',
    'pipeline_tag',
    'private',
    'safetensors',
    'sha',
    'tags',
  ]) metadataUrl.searchParams.append('expand', field)

  let metadataResponse: Response
  try {
    metadataResponse = await fetcher(metadataUrl.toString(), { headers })
  } catch (error) {
    console.error(JSON.stringify({
      message: 'failed to fetch Hugging Face metadata',
      model: `${route.owner}/${route.repo}`,
      error: error instanceof Error ? error.message : String(error),
    }))
    return json({ error: 'Hugging Face is temporarily unavailable' }, 502)
  }

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
    let config: unknown = configResponse.ok ? await configResponse.json() : {}
    let configSourceId: string | undefined
    let allowEstimate = true

    const needsBaseConfig = !configResponse.ok
      || normalizeHuggingFaceModel(metadata, config).spec === null

    if (typeof metadata === 'object' && metadata !== null) {
      const metadataRecord = metadata as Record<string, unknown>
      const gguf = metadataRecord.gguf
      const tags = Array.isArray(metadataRecord.tags) ? metadataRecord.tags : []
      const baseTag = tags.find((tag): tag is string =>
        typeof tag === 'string' && /^base_model:[^:]+\/[^:]+$/.test(tag),
      )
      const baseId = baseTag?.slice('base_model:'.length)
      const baseRoute = baseId ? parseHuggingFaceModelPath(`/${baseId}`) : null
      const hasQuantizedBaseRelation = baseId
        ? tags.includes(`base_model:quantized:${baseId}`)
        : false
      const hasFullGguf = typeof gguf === 'object' && gguf !== null
        && 'total' in gguf && typeof gguf.total === 'number' && gguf.total > 0
      const ggufArchitecture = typeof gguf === 'object' && gguf !== null
        && 'architecture' in gguf && typeof gguf.architecture === 'string'
        ? gguf.architecture.toLowerCase()
        : ''
      const isAdapter = tags.some((tag) => typeof tag === 'string'
        && ['lora', 'peft', 'adapter'].some((marker) => tag.toLowerCase().includes(marker)))
        || ['lora', 'adapter'].some((marker) => ggufArchitecture.includes(marker))

      if (isAdapter) allowEstimate = false

      if (hasFullGguf && hasQuantizedBaseRelation && !isAdapter && baseRoute
        && `${baseRoute.owner}/${baseRoute.repo}` !== `${route.owner}/${route.repo}`) {
        const baseOwner = encodeURIComponent(baseRoute.owner)
        const baseRepo = encodeURIComponent(baseRoute.repo)
        const baseMetadataUrl = new URL(`https://huggingface.co/api/models/${baseOwner}/${baseRepo}`)
        for (const field of ['sha', 'safetensors', 'gguf']) {
          baseMetadataUrl.searchParams.append('expand', field)
        }
        const baseMetadataResponse = await fetcher(baseMetadataUrl.toString(), { headers })
        if (baseMetadataResponse.ok) {
          const baseMetadata = await baseMetadataResponse.json() as Record<string, unknown>
          const hasExpectedBaseId = baseMetadata.id === `${baseRoute.owner}/${baseRoute.repo}`
          const derivedParameters = getHuggingFaceParameterCount(metadata)
          const baseParameters = getHuggingFaceParameterCount(baseMetadata)
          const parameterRatio = derivedParameters !== null && baseParameters !== null
            ? derivedParameters / baseParameters
            : null
          const hasPlausibleParameterCount = parameterRatio !== null
            && parameterRatio >= 0.8 && parameterRatio <= 1.2
          allowEstimate = hasExpectedBaseId && hasPlausibleParameterCount

          if (typeof baseMetadata.sha === 'string' && baseMetadata.sha
            && allowEstimate && needsBaseConfig) {
            const baseConfigResponse = await fetcher(
              `https://huggingface.co/${baseOwner}/${baseRepo}/resolve/${encodeURIComponent(baseMetadata.sha)}/config.json`,
              { headers },
            )
            if (baseConfigResponse.ok) {
              config = await baseConfigResponse.json()
              configSourceId = `${baseRoute.owner}/${baseRoute.repo}`
            }
          }
        } else {
          allowEstimate = false
        }
      }
    }

    return json(normalizeHuggingFaceModel(metadata, config, { allowEstimate, configSourceId }))
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
    if (!url.pathname.startsWith('/api/models/')) {
      return applyAssetCachePolicy(await env.ASSETS.fetch(request))
    }

    const cache = caches.default
    const cacheKey = createModelCacheKey(request)
    const cached = await cache.match(cacheKey)
    if (cached) return cached

    const response = await handleModelApi(request)
    if (response.ok) ctx.waitUntil(cache.put(cacheKey, response.clone()))
    return response
  },
} satisfies ExportedHandler<Env>
