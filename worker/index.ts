import {
  getHuggingFaceParameterCount,
  isHuggingFaceVae,
  normalizeHuggingFaceModel,
  parseHuggingFaceModelPath,
  type HuggingFaceModelKind,
  type HuggingFaceResourceEstimate,
} from '../src/lib/huggingface'
import { curatedHuggingFaceConfigs } from '../src/data/huggingface-configs'
import { curatedHuggingFaceResourceProfiles } from '../src/data/huggingface-resource-profiles'
import {
  applyReleaseManifest,
  parseHuggingFaceVariants,
  parseNInferManifest,
  parseVariantArtifactManifest,
  type HuggingFaceRepoSnapshot,
  type HuggingFaceTreeEntry,
  type HuggingFaceVariant,
  type NInferManifestFacts,
  type VariantArtifactManifestFacts,
} from '../src/lib/huggingface-variants'
import { deriveGgufModelFacts, parseGgufMetadataPrefix } from '../src/lib/gguf'

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type GgufReader = (
  url: string,
  options: { fetch: Fetcher; additionalFetchHeaders: Record<string, string> },
) => Promise<{ metadata: unknown; parameterCount: number | null }>

interface CommunityRepositoryCandidate {
  id?: unknown
  author?: unknown
  sha?: unknown
  tags?: unknown
  siblings?: unknown
}

const trustedQuantizationPublishers = [
  'unsloth',
  'lmstudio-community',
  'mlx-community',
  'bartowski',
] as const

export function selectCommunityRepositories(
  value: unknown,
  baseModelId: string,
): Array<{ id: string; author: string; sha: string; tags: string[]; siblings: string[] }> {
  if (!Array.isArray(value)) return []
  const relation = `base_model:quantized:${baseModelId}`.toLowerCase()
  const candidates = value.flatMap((raw): Array<{
    id: string; author: string; sha: string; tags: string[]; siblings: string[]; priority: number
  }> => {
    if (typeof raw !== 'object' || raw === null) return []
    const item = raw as CommunityRepositoryCandidate
    if (typeof item.id !== 'string' || typeof item.author !== 'string'
      || typeof item.sha !== 'string' || !/^[a-f0-9]{40}$/i.test(item.sha)) return []
    const repositoryName = item.id.split('/')[1] ?? ''
    if (/(?:^|[-_.])mtp(?:[-_.]|$)/i.test(repositoryName)) return []
    const tags = Array.isArray(item.tags)
      ? item.tags.filter((tag): tag is string => typeof tag === 'string')
      : []
    if (!tags.some((tag) => tag.toLowerCase() === relation)) return []
    const priority = trustedQuantizationPublishers.indexOf(
      item.author.toLowerCase() as typeof trustedQuantizationPublishers[number],
    )
    if (priority < 0) return []
    const siblings = Array.isArray(item.siblings)
      ? item.siblings.flatMap((sibling) => {
          if (typeof sibling !== 'object' || sibling === null) return []
          const file = sibling as Record<string, unknown>
          return typeof file.rfilename === 'string' ? [file.rfilename] : []
        })
      : []
    return [{ id: item.id, author: item.author, sha: item.sha, tags, siblings, priority }]
  })
  candidates.sort((a, b) => a.priority - b.priority
    || Number(!a.tags.some((tag) => tag.toLowerCase() === 'gguf'))
      - Number(!b.tags.some((tag) => tag.toLowerCase() === 'gguf'))
    || a.id.localeCompare(b.id))
  const publisherCounts = new Map<string, number>()
  return candidates.filter((candidate) => {
    const publisher = candidate.author.toLowerCase()
    const count = publisherCounts.get(publisher) ?? 0
    if (count >= 3) return false
    publisherCounts.set(publisher, count + 1)
    return true
  })
}

export function selectCommunityRepository(
  value: unknown,
  baseModelId: string,
) {
  return selectCommunityRepositories(value, baseModelId)[0] ?? null
}

export const readGguf: GgufReader = async (url, options) => {
  const fetcher = options.fetch
  const response = await fetcher(url, {
    headers: {
      ...options.additionalFetchHeaders,
      Range: 'bytes=0-524287',
    },
  })
  if (!response.ok) throw new Error('Unable to read GGUF metadata')
  const contentLength = Number(response.headers.get('Content-Length'))
  if (Number.isFinite(contentLength) && contentLength > 1_048_576) {
    throw new Error('GGUF server ignored bounded Range request')
  }
  return {
    metadata: parseGgufMetadataPrefix(await response.arrayBuffer()),
    parameterCount: null,
  }
}

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

function declaredBaseId(tags: string[]) {
  const baseTag = tags.find((tag) => /^base_model:[^:]+\/[^:]+$/.test(tag))
  return baseTag?.slice('base_model:'.length) ?? null
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

function treeEntries(value: unknown): HuggingFaceTreeEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []
    const item = entry as Record<string, unknown>
    if ((item.type !== 'file' && item.type !== 'directory')
      || typeof item.path !== 'string' || typeof item.size !== 'number') return []
    return [{ type: item.type, path: item.path, size: item.size }]
  })
}

async function fetchRepoTree(
  fetcher: Fetcher,
  url: URL,
  headers: Record<string, string>,
) {
  const entries: HuggingFaceTreeEntry[] = []
  const expectedPath = url.pathname
  let nextUrl: URL | null = url

  for (let page = 0; page < 10 && nextUrl && entries.length < 1_000; page += 1) {
    let response: Response
    try {
      response = await fetcher(nextUrl.toString(), { headers })
    } catch {
      break
    }
    if (!response.ok) break

    try {
      entries.push(...treeEntries(await response.json()))
    } catch {
      break
    }
    const nextLink = response.headers.get('Link')
      ?.match(/<([^>]+)>\s*;\s*rel="?next"?/i)?.[1]
    if (!nextLink) break

    const candidate = new URL(nextLink, nextUrl)
    nextUrl = candidate.origin === 'https://huggingface.co' && candidate.pathname === expectedPath
      ? candidate
      : null
  }

  return entries.slice(0, 1_000)
}

async function fetchJson(fetcher: Fetcher, url: string, headers: Record<string, string>) {
  try {
    const response = await fetcher(url, { headers })
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

async function discoverRepoVariants(
  route: { owner: string; repo: string },
  revision: string,
  tags: string[],
  siblings: string[],
  fetcher: Fetcher,
  headers: Record<string, string>,
): Promise<{
  variants: HuggingFaceVariant[]
  ninfer: NInferManifestFacts | null
  artifactManifest: VariantArtifactManifestFacts | null
  mainEntries: HuggingFaceTreeEntry[]
}> {
  const owner = encodeURIComponent(route.owner)
  const repo = encodeURIComponent(route.repo)
  const snapshots: HuggingFaceRepoSnapshot[] = []
  const treeUrl = new URL(`https://huggingface.co/api/models/${owner}/${repo}/tree/${encodeURIComponent(revision)}`)
  treeUrl.searchParams.set('recursive', 'true')
  treeUrl.searchParams.set('expand', 'true')
  treeUrl.searchParams.set('limit', '100')
  const mainTree = await fetchRepoTree(fetcher, treeUrl, headers)
  if (mainTree.length > 0) snapshots.push({ revision, label: 'main', entries: mainTree })

  const tagText = tags.join(' ').toLowerCase()
  if (/\bexl[23]\b/.test(tagText)) {
    const refs = await fetchJson(
      fetcher,
      `https://huggingface.co/api/models/${owner}/${repo}/refs`,
      headers,
    )
    const branches = typeof refs === 'object' && refs !== null && 'branches' in refs && Array.isArray(refs.branches)
      ? refs.branches.flatMap((branch) => {
          if (typeof branch !== 'object' || branch === null) return []
          const item = branch as Record<string, unknown>
          return typeof item.name === 'string' && /bpw/i.test(item.name)
            && typeof item.targetCommit === 'string' && /^[a-f0-9]{40}$/i.test(item.targetCommit)
            ? [{ name: item.name, revision: item.targetCommit }]
            : []
        }).slice(0, 12)
      : []
    const branchSnapshots = await Promise.all(branches.map(async (branch) => {
      const url = new URL(`https://huggingface.co/api/models/${owner}/${repo}/tree/${encodeURIComponent(branch.revision)}`)
      url.searchParams.set('recursive', 'true')
      url.searchParams.set('expand', 'true')
      url.searchParams.set('limit', '100')
      const entries = await fetchRepoTree(fetcher, url, headers)
      return entries.length > 0 ? { revision: branch.revision, label: branch.name, entries } : null
    }))
    snapshots.push(...branchSnapshots.filter((snapshot): snapshot is HuggingFaceRepoSnapshot => snapshot !== null))
  }

  let variants = parseHuggingFaceVariants(snapshots, tags)
  const fileNames = new Set([...siblings, ...mainTree.map((entry) => entry.path)])
  if (fileNames.has('release-manifest.json')) {
    const manifest = await fetchJson(
      fetcher,
      `https://huggingface.co/${owner}/${repo}/resolve/${encodeURIComponent(revision)}/release-manifest.json`,
      headers,
    )
    variants = applyReleaseManifest(variants, manifest)
  }
  const ninfer = fileNames.has('artifact-manifest.json')
    ? parseNInferManifest(await fetchJson(
        fetcher,
        `https://huggingface.co/${owner}/${repo}/resolve/${encodeURIComponent(revision)}/artifact-manifest.json`,
        headers,
      ))
    : null
  const directoryVariant = variants.find((variant) => (
    variant.role === 'model' && variant.source === 'directory' && variant.path
  ))
  const artifactManifestPath = directoryVariant
    ? `${directoryVariant.path}/artifact-manifest.json`
    : null
  const artifactManifest = artifactManifestPath && fileNames.has(artifactManifestPath)
    ? parseVariantArtifactManifest(await fetchJson(
        fetcher,
        `https://huggingface.co/${owner}/${repo}/resolve/${encodeURIComponent(revision)}/${artifactManifestPath.split('/').map(encodeURIComponent).join('/')}`,
        headers,
      ))
    : null
  return { variants, ninfer, artifactManifest, mainEntries: mainTree }
}

async function discoverCommunityVariants(
  baseModelId: string,
  repoName: string,
  fetcher: Fetcher,
  headers: Record<string, string>,
) {
  const searchUrl = new URL('https://huggingface.co/api/models')
  searchUrl.searchParams.set('search', repoName)
  searchUrl.searchParams.set('limit', '100')
  searchUrl.searchParams.set('full', 'true')
  const candidates = selectCommunityRepositories(
    await fetchJson(fetcher, searchUrl.toString(), headers),
    baseModelId,
  )
  const discoveredByRepository = await Promise.all(candidates.map(async (candidate) => {
    const route = parseHuggingFaceModelPath(`/${candidate.id}`)
    if (!route) return []
    try {
      const discovered = await discoverRepoVariants(
        route,
        candidate.sha,
        candidate.tags,
        candidate.siblings,
        fetcher,
        headers,
      )
      const sourceUrl = `https://huggingface.co/${route.owner}/${route.repo}`
      return discovered.variants
        .filter((variant) => variant.role === 'model')
        .map((variant) => ({
          ...variant,
          id: `community:${candidate.id}:${variant.id}`,
          provenance: 'community' as const,
          publisher: candidate.author,
          repositoryId: candidate.id,
          sourceUrl,
        }))
    } catch {
      return []
    }
  }))
  return discoveredByRepository.flat()
}

export function createModelCacheKey(request: Request) {
  const url = new URL(request.url)
  url.search = ''
  url.searchParams.set('__sizeof_cache', 'hf-model-v22')
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

export async function handleModelApi(
  request: Request,
  fetcher: Fetcher = fetch,
  ggufReader: GgufReader = readGguf,
): Promise<Response> {
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
    'siblings',
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
    let modelKindOverride: HuggingFaceModelKind | undefined
    let parameterCountOverride: number | undefined
    let parameterCountKind: 'logical' | 'tensor-elements' = 'logical'
    let variants: HuggingFaceVariant[] = []
    let resourceEstimate: HuggingFaceResourceEstimate | undefined
    let addon: NonNullable<Parameters<typeof normalizeHuggingFaceModel>[2]>['addon'] = null

    const metadataRoute = typeof metadata === 'object' && metadata !== null
      && 'id' in metadata && typeof metadata.id === 'string'
      ? parseHuggingFaceModelPath(`/${metadata.id}`)
      : null
    const modelId = metadataRoute
      ? `${metadataRoute.owner}/${metadataRoute.repo}`
      : `${route.owner}/${route.repo}`
    const curatedResourceProfile = curatedHuggingFaceResourceProfiles[modelId]
    if (curatedResourceProfile) {
      allowEstimate = false
      modelKindOverride = curatedResourceProfile.modelKind
      resourceEstimate = curatedResourceProfile.resourceEstimate
    }
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
      const siblings = Array.isArray(metadataRecord.siblings)
        ? metadataRecord.siblings.flatMap((sibling) => {
            if (typeof sibling === 'string') return [sibling]
            if (typeof sibling !== 'object' || sibling === null) return []
            const file = sibling as Record<string, unknown>
            return typeof file.rfilename === 'string' ? [file.rfilename] : []
          })
        : []
      const discovered = await discoverRepoVariants(
        route,
        revision,
        tags,
        siblings,
        fetcher,
        headers,
      )
      variants = discovered.variants
      if (!variants.some((variant) => variant.role === 'model')
        && normalizeHuggingFaceModel(metadata, config).spec !== null
        && !pairedBaseId(tags, 'quantized') && !pairedBaseId(tags, 'adapter')) {
        variants = await discoverCommunityVariants(modelId, route.repo, fetcher, headers)
      }
      const isVae = !curatedResourceProfile && isHuggingFaceVae(metadata, config)
      const vae = isVae ? normalizeHuggingFaceModel(metadata, config) : null
      const vaeArtifact = isVae
        ? discovered.mainEntries.filter((entry) => entry.type === 'file'
          && /\.safetensors$/i.test(entry.path) && entry.size > 0)
        : []
      const vaeWeightBytes = vae?.tensorSizeBytes
        ?? (vaeArtifact.length === 1 ? vaeArtifact[0]?.size ?? null : null)
      const vaeBaseId = isVae
        ? declaredBaseId(tags)
        : null
      if (vaeBaseId) {
        const baseRoute = parseHuggingFaceModelPath(`/${vaeBaseId}`)
        if (baseRoute) {
          const baseOwner = encodeURIComponent(baseRoute.owner)
          const baseRepo = encodeURIComponent(baseRoute.repo)
          const baseMetadataUrl = new URL(`https://huggingface.co/api/models/${baseOwner}/${baseRepo}`)
          baseMetadataUrl.searchParams.append('expand', 'sha')
          baseMetadataUrl.searchParams.append('expand', 'safetensors')
          const baseMetadata = await fetchJson(fetcher, baseMetadataUrl.toString(), headers)
          const baseMetadataRoute = typeof baseMetadata === 'object' && baseMetadata !== null
            && 'id' in baseMetadata && typeof baseMetadata.id === 'string'
            ? parseHuggingFaceModelPath(`/${baseMetadata.id}`)
            : null
          const canonicalBaseId = baseMetadataRoute
            ? `${baseMetadataRoute.owner}/${baseMetadataRoute.repo}`
            : null
          if (typeof baseMetadata === 'object' && baseMetadata !== null
            && canonicalBaseId !== null && canonicalBaseId.toLowerCase() === vaeBaseId.toLowerCase()
            && 'sha' in baseMetadata && typeof baseMetadata.sha === 'string' && baseMetadata.sha) {
            const base = normalizeHuggingFaceModel(baseMetadata, {})
            if (vaeWeightBytes !== null && base.tensorSizeBytes !== null) {
              resourceEstimate = {
                kind: 'vae',
                title: 'Declared base + VAE weights',
                description: 'Static weights for the VAE and its declared base model. This component set does not use an autoregressive KV cache.',
                note: 'This is static published weight residency only. The surrounding image or video pipeline, activations, resolution, frames, and offload add runtime memory.',
                baseModelId: canonicalBaseId,
                options: [{
                  id: 'declared-base-plus-vae',
                  label: 'Declared base + VAE',
                  components: [
                    { id: 'declared-base', label: 'Declared base weights', sizeBytes: base.tensorSizeBytes },
                    { id: 'vae-weights', label: 'VAE weights', sizeBytes: vaeWeightBytes },
                  ],
                }],
              }
            }
          }
        }
      }
      if (isVae && !resourceEstimate && vaeWeightBytes !== null) {
        const path = vaeArtifact.length === 1 ? vaeArtifact[0]?.path : undefined
        resourceEstimate = {
          kind: 'vae',
          title: 'VAE loaded weights',
          description: 'Static VAE weights. This component does not use an autoregressive KV cache.',
          note: path
            ? 'This is the published VAE file footprint because the Hub does not publish tensor dtype metadata. Resolution, frames, activations, and the surrounding pipeline add runtime memory.'
            : 'This is VAE weight residency only. Image or video resolution, frames, activations, and the surrounding pipeline add runtime memory.',
          baseModelId: null,
          options: [{
            id: 'published-weights',
            label: path ? 'Published VAE weight file' : 'VAE weights',
            components: [{
              id: 'vae-weights',
              label: path ? 'VAE weight file' : 'VAE weights',
              path,
              sizeBytes: vaeWeightBytes,
            }],
          }],
        }
      }
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
      const modelVariants = variants.filter((variant) => variant.role === 'model')
      const addonVariants = variants.filter((variant) => variant.role === 'addon')
      const projectorVariants = variants.filter((variant) => variant.role === 'projector')
      const isCompositeGguf = ggufArchitecture === 'clip'
        && modelVariants.length > 0 && projectorVariants.length > 0
      const isMtpAddon = tags.some((tag) => /(?:^|[-_])mtp(?:$|[-_])/i.test(tag))
        && addonVariants.length > 0 && modelVariants.length === 0

      const startingBaseId = quantizedBaseId ?? adapterBaseId
        ?? discovered.ninfer?.baseModelId ?? discovered.artifactManifest?.baseModelId ?? null
      if (!startingBaseId && modelVariants.some((variant) => variant.format === 'gguf')
        && (isCompositeGguf || normalizeHuggingFaceModel(metadata, config).spec === null)) {
        const candidate = modelVariants
          .filter((variant) => variant.format === 'gguf' && !/-\d{5}-of-\d{5}\.gguf$/i.test(variant.path))
          .sort((a, b) => a.weightSizeBytes - b.weightSizeBytes)[0]
        if (candidate) {
          try {
            const path = candidate.path.split('/').map(encodeURIComponent).join('/')
            const parsed = await ggufReader(
              `https://huggingface.co/${owner}/${repo}/resolve/${encodeURIComponent(candidate.revision)}/${path}`,
              { fetch: fetcher, additionalFetchHeaders: headers },
            )
            const facts = deriveGgufModelFacts(parsed.metadata, parsed.parameterCount)
            if (facts) {
              config = facts.config
              configSourceId = `GGUF / ${candidate.path}`
              parameterCountOverride = facts.parameterCount
              parameterCountKind = 'logical'
            }
          } catch (error) {
            console.warn(JSON.stringify({
              message: 'unable to read full-model GGUF metadata',
              model: modelId,
              artifact: candidate.path,
              error: error instanceof Error ? error.message : String(error),
            }))
          }
        }
      }
      if (isAdapter && !adapterBaseId) {
        allowEstimate = false
        estimateReason = 'adapter-only'
      } else if (startingBaseId && `${route.owner}/${route.repo}` !== startingBaseId) {
        const chain: Array<{ id: string; metadata: Record<string, unknown> }> = []
        const seen = new Set([`${route.owner}/${route.repo}`])
        let nextBaseId: string | null = startingBaseId

        for (let depth = 0; depth < 3 && nextBaseId; depth += 1) {
          if (seen.has(nextBaseId)) {
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
          if (discovered.ninfer?.baseModelId === nextBaseId) {
            baseMetadataUrl.searchParams.set('revision', discovered.ninfer.baseRevision)
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
          if (discovered.ninfer?.baseModelId === nextBaseId
            && baseMetadata.sha !== discovered.ninfer.baseRevision) {
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
          if (!isMtpAddon && !isCompositeGguf
            && immediateRatio !== null && immediateRatio < hardMinimumRatio) {
            allowEstimate = false
            estimateReason = isAdapter ? 'adapter-only' : 'parameter-mismatch'
            break
          }
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
        const hasPlausibleParameterCount = isMtpAddon || isCompositeGguf
          || (modelVariants.length > 0 && derivedParameters === null && baseParameters !== null)
          || (parameterRatio !== null && parameterRatio >= minimumRatio && parameterRatio <= 1.2)

        if (allowEstimate && canonicalBase) {
          allowEstimate = hasPlausibleParameterCount
          if (!hasPlausibleParameterCount) estimateReason = isAdapter ? 'adapter-only' : 'parameter-mismatch'

          if (adapterBaseId && hasPlausibleParameterCount) {
            modelKindOverride = 'language'
          } else if (isAdapter) {
            allowEstimate = false
            estimateReason = 'adapter-only'
          }

          if ((quantizedBaseId || discovered.ninfer || discovered.artifactManifest)
            && (!hasFullGguf || isCompositeGguf || isMtpAddon)
            && hasPlausibleParameterCount && baseParameters !== null) {
            parameterCountOverride = baseParameters
          }

          if (isMtpAddon && baseParameters !== null) {
            parameterCountOverride = baseParameters
            const addonVariant = addonVariants[0]
            addon = {
              kind: 'mtp',
              baseModelId: canonicalBase.id,
              parametersB: derivedParameters === null ? null : derivedParameters / 1_000_000_000,
              sizeBytes: addonVariant?.weightSizeBytes ?? null,
            }
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
        parameterCountKind = 'tensor-elements'
      }
    }

    return json(normalizeHuggingFaceModel(metadata, config, {
      allowEstimate,
      configSourceId,
      estimateReason,
      modelKindOverride,
      parameterCountOverride,
      parameterCountKind,
      variants,
      resourceEstimate,
      addon,
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
