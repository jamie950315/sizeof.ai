import {
  getHuggingFaceParameterCount,
  normalizeHuggingFaceModel,
  parseHuggingFaceModelPath,
} from '../src/lib/huggingface'
import { curatedHuggingFaceConfigs } from '../src/data/huggingface-configs'

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

function metadataTags(metadata: Record<string, unknown>) {
  return Array.isArray(metadata.tags)
    ? metadata.tags.filter((tag): tag is string => typeof tag === 'string')
    : []
}

function pairedBaseId(tags: string[], relation: 'adapter' | 'quantized') {
  const baseTag = tags.find((tag) => /^base_model:[^:]+\/[^:]+$/.test(tag))
  const baseId = baseTag?.slice('base_model:'.length)
  return baseId && tags.includes(`base_model:${relation}:${baseId}`) ? baseId : null
}

function qwenVersion(modelId: string) {
  const match = modelId.toLowerCase().match(/qwen[-_.]?(\d+)(?:[-_.](\d+))?/)
  return match ? `${match[1]}.${match[2] ?? '0'}` : null
}

function hasCompatibleLineage(sourceId: string, baseId: string) {
  const sourceQwen = qwenVersion(sourceId)
  const baseQwen = qwenVersion(baseId)
  return sourceQwen === null || baseQwen === null || sourceQwen === baseQwen
}

function hasPackedWeightEncoding(metadata: Record<string, unknown>, tags: string[]) {
  const safetensors = typeof metadata.safetensors === 'object' && metadata.safetensors !== null
    ? metadata.safetensors as Record<string, unknown>
    : {}
  const parameters = typeof safetensors.parameters === 'object' && safetensors.parameters !== null
    ? safetensors.parameters as Record<string, unknown>
    : {}
  const dtypes = Object.keys(parameters).map((dtype) => dtype.toUpperCase())
  if (dtypes.some((dtype) => ['I32', 'U32'].includes(dtype))) return true

  const tagText = tags.join(' ').toLowerCase()
  const declaresSubBytePacking = /(?:^|\W)(?:int4|w4|fp4|nvfp4|[2-7](?:\.\d+)?-?bit)(?:$|\W)/.test(tagText)
  return declaresSubBytePacking && dtypes.some((dtype) => ['I8', 'U8', 'I16', 'U16'].includes(dtype))
}

export function createModelCacheKey(request: Request) {
  const url = new URL(request.url)
  url.search = ''
  url.searchParams.set('__sizeof_cache', 'hf-model-v9')
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
    'usedStorage',
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
    let estimateReason: 'adapter-only' | 'parameter-mismatch' | 'unverified-base' | undefined
    let modelKindOverride: 'language' | undefined
    let parameterCountOverride: number | undefined

    const modelId = `${route.owner}/${route.repo}`
    if (!configResponse.ok && curatedHuggingFaceConfigs[modelId]) {
      config = curatedHuggingFaceConfigs[modelId]
      configSourceId = `sizeof.ai curated / ${modelId}`
    }

    const needsBaseConfig = (!configResponse.ok
      && !curatedHuggingFaceConfigs[modelId])
      || normalizeHuggingFaceModel(metadata, config).spec === null

    if (typeof metadata === 'object' && metadata !== null) {
      const metadataRecord = metadata as Record<string, unknown>
      const gguf = metadataRecord.gguf
      const tags = metadataTags(metadataRecord)
      const quantizedBaseId = pairedBaseId(tags, 'quantized')
      const adapterBaseId = pairedBaseId(tags, 'adapter')
      const hasFullGguf = typeof gguf === 'object' && gguf !== null
        && 'total' in gguf && typeof gguf.total === 'number' && gguf.total > 0
      const ggufArchitecture = typeof gguf === 'object' && gguf !== null
        && 'architecture' in gguf && typeof gguf.architecture === 'string'
        ? gguf.architecture.toLowerCase()
        : ''
      const isAdapter = tags.some((tag) => typeof tag === 'string'
        && (['lora', 'peft'].includes(tag.toLowerCase()) || tag.toLowerCase().includes('adapter')))
        || ['lora', 'adapter'].some((marker) => ggufArchitecture.includes(marker))

      const startingBaseId = quantizedBaseId ?? adapterBaseId
      if (isAdapter && !adapterBaseId) {
        allowEstimate = false
        estimateReason = 'adapter-only'
      } else if (startingBaseId && `${route.owner}/${route.repo}` !== startingBaseId) {
        const chain: Array<{ id: string; metadata: Record<string, unknown> }> = []
        const seen = new Set([`${route.owner}/${route.repo}`])
        let sourceId = `${route.owner}/${route.repo}`
        let nextBaseId: string | null = startingBaseId

        for (let depth = 0; depth < 3 && nextBaseId; depth += 1) {
          if (seen.has(nextBaseId) || !hasCompatibleLineage(sourceId, nextBaseId)) {
            allowEstimate = false
            estimateReason = 'unverified-base'
            break
          }
          const baseRoute = parseHuggingFaceModelPath(`/${nextBaseId}`)
          if (!baseRoute) {
            allowEstimate = false
            estimateReason = 'unverified-base'
            break
          }

          const baseOwner = encodeURIComponent(baseRoute.owner)
          const baseRepo = encodeURIComponent(baseRoute.repo)
          const baseMetadataUrl = new URL(`https://huggingface.co/api/models/${baseOwner}/${baseRepo}`)
          for (const field of ['sha', 'safetensors', 'gguf', 'tags']) {
            baseMetadataUrl.searchParams.append('expand', field)
          }
          const baseMetadataResponse = await fetcher(baseMetadataUrl.toString(), { headers })
          if (!baseMetadataResponse.ok) {
            allowEstimate = false
            estimateReason = 'unverified-base'
            break
          }
          const baseMetadata = await baseMetadataResponse.json() as Record<string, unknown>
          if (baseMetadata.id !== nextBaseId) {
            allowEstimate = false
            estimateReason = 'unverified-base'
            break
          }
          if (typeof baseMetadata.sha !== 'string' || !baseMetadata.sha) {
            allowEstimate = false
            estimateReason = 'unverified-base'
            break
          }

          chain.push({ id: nextBaseId, metadata: baseMetadata })
          seen.add(nextBaseId)
          const immediateDerivedParameters = getHuggingFaceParameterCount(metadata)
          const immediateBaseParameters = getHuggingFaceParameterCount(baseMetadata)
          const immediateRatio = immediateDerivedParameters !== null && immediateBaseParameters !== null
            ? immediateDerivedParameters / immediateBaseParameters
            : null
          const hardMinimumRatio = hasFullGguf ? 0.8 : 0.2
          if (immediateRatio !== null && immediateRatio < hardMinimumRatio) {
            allowEstimate = false
            estimateReason = isAdapter ? 'adapter-only' : 'parameter-mismatch'
            break
          }
          sourceId = nextBaseId
          nextBaseId = quantizedBaseId
            ? pairedBaseId(metadataTags(baseMetadata), 'quantized')
            : null
        }

        if (allowEstimate && nextBaseId) {
          allowEstimate = false
          estimateReason = 'unverified-base'
        }

        const canonicalBase = chain.at(-1)
        const derivedParameters = getHuggingFaceParameterCount(metadata)
        const baseParameters = canonicalBase
          ? getHuggingFaceParameterCount(canonicalBase.metadata)
          : null
        const parameterRatio = derivedParameters !== null && baseParameters !== null
          ? derivedParameters / baseParameters
          : null
        const minimumRatio = hasFullGguf || adapterBaseId
          ? 0.8
          : hasPackedWeightEncoding(metadataRecord, tags)
            ? 0.2
            : 0.45
        const hasPlausibleParameterCount = parameterRatio !== null
          && parameterRatio >= minimumRatio && parameterRatio <= 1.2

        if (allowEstimate && canonicalBase) {
          allowEstimate = hasPlausibleParameterCount
          if (!hasPlausibleParameterCount) estimateReason = isAdapter ? 'adapter-only' : 'parameter-mismatch'

          if (adapterBaseId && hasPlausibleParameterCount) {
            modelKindOverride = 'language'
          } else if (isAdapter) {
            allowEstimate = false
            estimateReason = 'adapter-only'
          }

          if (quantizedBaseId && !hasFullGguf && hasPlausibleParameterCount && baseParameters !== null) {
            parameterCountOverride = baseParameters
          }

          const stillNeedsBaseConfig = needsBaseConfig
            && normalizeHuggingFaceModel(metadata, config, {
              modelKindOverride,
              parameterCountOverride,
            }).spec === null
          if (allowEstimate && stillNeedsBaseConfig) {
            for (const node of chain) {
              const nodeRoute = parseHuggingFaceModelPath(`/${node.id}`)
              const nodeSha = node.metadata.sha
              if (!nodeRoute || typeof nodeSha !== 'string' || !nodeSha) continue
              const baseConfigResponse = await fetcher(
                `https://huggingface.co/${encodeURIComponent(nodeRoute.owner)}/${encodeURIComponent(nodeRoute.repo)}/resolve/${encodeURIComponent(nodeSha)}/config.json`,
                { headers },
              )
              if (!baseConfigResponse.ok) continue
              const candidateConfig = await baseConfigResponse.json()
              const candidate = normalizeHuggingFaceModel(metadata, candidateConfig, {
                parameterCountOverride,
              })
              if (candidate.spec) {
                config = candidateConfig
                configSourceId = node.id
                break
              }
            }
          }
        }
      } else if (quantizedBaseId) {
          allowEstimate = false
          estimateReason = 'unverified-base'
      } else if (hasPackedWeightEncoding(metadataRecord, tags)) {
        allowEstimate = false
        estimateReason = 'unverified-base'
      }
    }

    return json(normalizeHuggingFaceModel(metadata, config, {
      allowEstimate,
      configSourceId,
      estimateReason,
      modelKindOverride,
      parameterCountOverride,
    }))
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
