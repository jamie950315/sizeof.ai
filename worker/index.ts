import {
  getHuggingFaceParameterCount,
  isHuggingFaceVae,
  normalizeHuggingFaceModel,
  parseHuggingFaceModelPath,
  type HuggingFaceModel,
  type HuggingFaceModelKind,
  type HuggingFaceResourceEstimate,
} from '../src/lib/huggingface'
import { curatedHuggingFaceConfigs } from '../src/data/huggingface-configs'
import { curatedHuggingFaceResourceProfiles } from '../src/data/huggingface-resource-profiles'
import { models } from '../src/data/models'
import { renderShareCard, type ShareCardInput } from '../src/lib/share-card'
import {
  buildPublicEstimate,
  parsePublicEstimateQuery,
  type PublicEstimateResponse,
} from '../src/lib/public-estimate'
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
import {
  createModelKvKey,
  modelResponseHeaders,
  modelResponseFromCache,
  queueModelResponseWrite,
  readModelResponse,
  type ModelCacheNamespace,
} from './model-cache'

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
  private?: unknown
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
    if (item.private === true) return []
    if (typeof item.id !== 'string' || typeof item.author !== 'string'
      || typeof item.sha !== 'string' || !/^[a-f0-9]{40}$/i.test(item.sha)) return []
    const repositoryName = item.id.split('/')[1] ?? ''
    if (/(?:^|[-_.])mtp(?:[-_.]|$)/i.test(repositoryName)) return []
    if (/(?:^|[-_.])dflash2?(?:[-_.]|$)/i.test(repositoryName)) return []
    const tags = Array.isArray(item.tags)
      ? item.tags.filter((tag): tag is string => typeof tag === 'string')
      : []
    if (tags.some((tag) => /^(?:draft-model|draft_model|speculative-decoding|speculative-decoding-draft|speculative-draft)$/i.test(tag))) return []
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

function json(data: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...modelResponseHeaders,
      ...headers,
      ...(status >= 200 && status < 300 ? {} : {
        'Cache-Control': 'no-store',
        'Cloudflare-CDN-Cache-Control': 'no-store',
      }),
    },
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

async function fetchTargetWeightSize(
  fetcher: Fetcher,
  route: { owner: string; repo: string },
  revision: string,
  tags: string[],
  headers: Record<string, string>,
) {
  const treeUrl = new URL(
    `https://huggingface.co/api/models/${encodeURIComponent(route.owner)}/${encodeURIComponent(route.repo)}/tree/${encodeURIComponent(revision)}`,
  )
  treeUrl.searchParams.set('recursive', 'true')
  treeUrl.searchParams.set('expand', 'true')
  treeUrl.searchParams.set('limit', '100')
  const entries = await fetchRepoTree(fetcher, treeUrl, headers)
  const rootSafetensors = entries.filter((entry) => entry.type === 'file'
    && !entry.path.includes('/') && entry.path.toLowerCase().endsWith('.safetensors')
    && !/(?:adapter|lora|projector|mmproj|mtp)/i.test(entry.path))
  const safetensorBytes = rootSafetensors.reduce((sum, entry) => sum + entry.size, 0)
  if (safetensorBytes > 0) return safetensorBytes

  const modelVariants = parseHuggingFaceVariants([{
    revision, label: 'main', entries,
  }], tags).filter((variant) => variant.role === 'model')
  return modelVariants.length === 1 ? modelVariants[0]?.weightSizeBytes ?? null : null
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

function publicHost(environment?: string) {
  return environment === 'testnet' ? 'https://testnet.sizeof.ai' : 'https://sizeof.ai'
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function pageMetadata(pathname: string, host: string) {
  if (pathname === '/compare') return {
    title: 'Compare model memory estimates | sizeof.ai',
    description: 'Compare public model memory estimates across configurations and hardware capacity.',
    canonical: `${host}/compare`,
    type: 'website',
  }
  const route = parseHuggingFaceModelPath(pathname)
  if (!route || pathname !== `/${route.owner}/${route.repo}`) return null
  const canonicalId = `${route.owner}/${route.repo}`
  return {
    title: `${canonicalId} VRAM estimate | sizeof.ai`,
    description: `Estimate memory for ${canonicalId} from public model metadata. Estimate, not a benchmark or guarantee.`,
    canonical: `${host}/${encodeURIComponent(route.owner)}/${encodeURIComponent(route.repo)}`,
    type: 'article',
  }
}

function injectMetadata(html: string, metadata: NonNullable<ReturnType<typeof pageMetadata>>) {
  const title = escapeHtml(metadata.title)
  const description = escapeHtml(metadata.description)
  const canonical = escapeHtml(metadata.canonical)
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'WebPage', name: metadata.title,
    description: metadata.description, url: metadata.canonical,
  }).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026')
  const tags = `<meta property="og:title" content="${title}" /><meta property="og:description" content="${description}" /><meta property="og:type" content="${metadata.type}" /><meta property="og:url" content="${canonical}" /><meta name="twitter:card" content="summary" /><meta name="twitter:title" content="${title}" /><meta name="twitter:description" content="${description}" /><script type="application/ld+json">${jsonLd}</script>`
  return html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`)
    .replace(/<meta\s+name=["']description["'][^>]*>/i, `<meta name="description" content="${description}" />`)
    .replace(/<link\s+rel=["']canonical["'][^>]*>/i, `<link rel="canonical" href="${canonical}" />`)
    .replace(/<\/head>/i, `${tags}</head>`)
}

function rewriteHomepageCanonical(html: string, host: string) {
  const canonical = escapeHtml(`${host}/`)
  return html.replace(
    /<link\s+rel=["']canonical["'][^>]*>/i,
    `<link rel="canonical" href="${canonical}" />`,
  )
}

function staticResponse(body: string, type: string, cacheControl: string, status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': type, 'Cache-Control': cacheControl, 'X-Content-Type-Options': 'nosniff' } })
}

function svgCardInput(url: URL): ShareCardInput | null {
  const boundedText = (value: string | null, limit: number, fallback: string) => (value ?? fallback).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit)
  const boundedNumber = (value: string | null) => {
    const number = Number(value)
    return Number.isFinite(number) && number > 0 && number <= 4096 ? number : null
  }
  const summary = url.searchParams.get('summary')
  if (summary && summary.length <= 2048) {
    try {
      const parsed = JSON.parse(summary) as { models?: unknown; generatedAt?: unknown }
      if (Array.isArray(parsed.models)) {
        const models = parsed.models.flatMap((item) => {
          if (!item || typeof item !== 'object') return []
          const value = item as Record<string, unknown>
          const id = typeof value.id === 'string' ? value.id : ''
          const route = parseHuggingFaceModelPath(`/${id}`)
          if (!route || `${route.owner}/${route.repo}` !== id) return []
          const configuration = typeof value.configuration === 'string' ? boundedText(value.configuration, 120, '') : ''
          const capacityGiB = boundedNumber(typeof value.capacityGiB === 'number' ? String(value.capacityGiB) : null)
          const totalGiB = boundedNumber(typeof value.totalGiB === 'number' ? String(value.totalGiB) : null)
          return configuration && capacityGiB !== null && totalGiB !== null ? [{ id, configuration, capacityGiB, totalGiB, lowerBound: value.lowerBound === true }] : []
        }).slice(0, 4)
        const generatedAt = typeof parsed.generatedAt === 'string' ? boundedText(parsed.generatedAt, 40, '') : ''
        if (models.length === parsed.models.length && models.length && generatedAt) return { models, generatedAt }
      }
    } catch { /* reject malformed comparison summaries */ }
    return null
  }
  const model = boundedText(url.searchParams.get('model'), 120, '')
  const configuration = boundedText(url.searchParams.get('config'), 120, '')
  const capacityGiB = boundedNumber(url.searchParams.get('capacity'))
  const totalGiB = boundedNumber(url.searchParams.get('total'))
  const generatedAt = boundedText(url.searchParams.get('date'), 40, '')
  if (!model || !configuration || capacityGiB === null || totalGiB === null || !generatedAt) return null
  return {
    models: [{ id: model, configuration, capacityGiB, totalGiB, lowerBound: url.searchParams.get('lowerBound') === '1' }],
    generatedAt,
  }
}

function sitemap(host: string) {
  const routes = ['/', '/compare', ...models.map((model) => new URL(model.sourceUrl).pathname)]
  const locations = [...new Set(routes)].map((route) => `<url><loc>${escapeHtml(`${host}${route}`)}</loc></url>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locations}</urlset>`
}

function finiteSearchMetric(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function isPrivateModelMetadata(value: unknown) {
  return typeof value === 'object' && value !== null
    && 'private' in value && value.private === true
}

const SEARCH_MODEL_TYPES = new Set([
  'text-generation',
  'image-text-to-text',
  'text-to-image',
  'text-to-video',
  'automatic-speech-recognition',
  'text-to-audio',
  'feature-extraction',
  'sentence-similarity',
])

function isValidSearchAuthor(value: string) {
  return value.length <= 96 && /^[a-z0-9][a-z0-9._-]*$/i.test(value)
}

function isValidSearchCursor(value: string) {
  return value.length <= 4096 && /^[a-z0-9+/_=-]+$/i.test(value)
}

function getNextSearchCursor(linkHeader: string | null) {
  if (!linkHeader) return null
  const match = linkHeader.match(/<([^>]+)>\s*;\s*rel="?next"?/i)
  if (!match?.[1]) return null
  try {
    const nextUrl = new URL(match[1])
    const cursor = nextUrl.hostname === 'huggingface.co' && nextUrl.pathname === '/api/models'
      ? nextUrl.searchParams.get('cursor')
      : null
    return cursor && isValidSearchCursor(cursor) ? cursor : null
  } catch {
    return null
  }
}

function searchMatchRank(id: string, query: string) {
  const normalizedId = id.toLocaleLowerCase('en')
  const normalizedQuery = query.toLocaleLowerCase('en')
  const separator = normalizedId.indexOf('/')
  const owner = separator === -1 ? '' : normalizedId.slice(0, separator)
  const name = separator === -1 ? normalizedId : normalizedId.slice(separator + 1)
  if (normalizedId === normalizedQuery) return 0
  if (name === normalizedQuery && owner === normalizedQuery) return 1
  if (name === normalizedQuery) return 2
  if (owner === normalizedQuery) return 3
  if (name.startsWith(normalizedQuery)) return 4
  return 5
}

export async function handleModelSearchApi(
  request: Request,
  fetcher: Fetcher = fetch,
  token?: string,
): Promise<Response> {
  const url = new URL(request.url)
  const query = url.searchParams.get('q')?.trim() ?? ''
  const author = url.searchParams.get('author')?.trim() ?? ''
  const modelType = url.searchParams.get('type')?.trim() ?? ''
  const cursor = url.searchParams.get('cursor')?.trim() ?? ''
  if (query.length < 2 || query.length > 80) {
    return json({ error: 'Search query must contain between 2 and 80 characters' }, 400)
  }
  if ((author && !isValidSearchAuthor(author))
    || (modelType && !SEARCH_MODEL_TYPES.has(modelType))
    || (cursor && !isValidSearchCursor(cursor))) {
    return json({ error: 'Invalid model search filter' }, 400)
  }

  const upstreamUrl = new URL('https://huggingface.co/api/models')
  upstreamUrl.searchParams.set('search', query)
  upstreamUrl.searchParams.set('sort', 'trendingScore')
  upstreamUrl.searchParams.set('direction', '-1')
  upstreamUrl.searchParams.set('limit', '12')
  if (author) upstreamUrl.searchParams.set('author', author)
  if (modelType) upstreamUrl.searchParams.set('filter', modelType)
  if (cursor) upstreamUrl.searchParams.set('cursor', cursor)

  try {
    const response = await fetcher(upstreamUrl.toString(), {
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    if (!response.ok) {
      return json({ error: 'Hugging Face search is temporarily unavailable' }, 502)
    }

    const value = await response.json()
    if (!Array.isArray(value)) {
      return json({ error: 'Hugging Face returned an unreadable search response' }, 502)
    }

    const searchModels = value.flatMap((raw) => {
      if (typeof raw !== 'object' || raw === null) return []
      const item = raw as Record<string, unknown>
      if (typeof item.id !== 'string' || item.private !== false) return []
      if (modelType && item.pipeline_tag !== modelType) return []
      const route = parseHuggingFaceModelPath(`/${item.id}`)
      if (!route || `${route.owner}/${route.repo}` !== item.id) return []
      return [{
        id: item.id,
        owner: route.owner,
        name: route.repo,
        downloads: finiteSearchMetric(item.downloads),
        likes: finiteSearchMetric(item.likes),
        task: typeof item.pipeline_tag === 'string' ? item.pipeline_tag : null,
        trendingScore: finiteSearchMetric(item.trendingScore),
        gated: Boolean(item.gated),
      }]
    }).sort((left, right) => {
      const rankDifference = searchMatchRank(left.id, query) - searchMatchRank(right.id, query)
      if (rankDifference !== 0) return rankDifference
      if (right.trendingScore !== left.trendingScore) return right.trendingScore - left.trendingScore
      if (right.downloads !== left.downloads) return right.downloads - left.downloads
      return left.id.localeCompare(right.id)
    }).slice(0, 12)

    return json({ query, models: searchModels, nextCursor: getNextSearchCursor(response.headers.get('Link')) }, 200, {
      'Cache-Control': 'public, max-age=60',
      'Cloudflare-CDN-Cache-Control': 'public, max-age=600, stale-while-revalidate=3600',
    })
  } catch (error) {
    console.warn(JSON.stringify({
      message: 'Hugging Face model search failed',
      error: error instanceof Error ? error.message : String(error),
    }))
    return json({ error: 'Hugging Face search is temporarily unavailable' }, 502)
  }
}

export async function handleModelApi(
  request: Request,
  fetcher: Fetcher = fetch,
  ggufReader: GgufReader = readGguf,
  token?: string,
): Promise<Response> {
  const route = apiRoute(new URL(request.url).pathname)
  if (!route) return json({ error: 'Invalid Hugging Face model path' }, 400)

  const owner = encodeURIComponent(route.owner)
  const repo = encodeURIComponent(route.repo)
  const headers = {
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
    if (isPrivateModelMetadata(metadata)) {
      return json({ error: 'Model not found or private' }, 404)
    }
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
    let canonicalSpeculativeTargetId: string | null = null

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
          baseMetadataUrl.searchParams.append('expand', 'private')
          const baseMetadata = await fetchJson(fetcher, baseMetadataUrl.toString(), headers)
          const baseMetadataRoute = typeof baseMetadata === 'object' && baseMetadata !== null
            && 'id' in baseMetadata && typeof baseMetadata.id === 'string'
            ? parseHuggingFaceModelPath(`/${baseMetadata.id}`)
            : null
          const canonicalBaseId = baseMetadataRoute
            ? `${baseMetadataRoute.owner}/${baseMetadataRoute.repo}`
            : null
          if (typeof baseMetadata === 'object' && baseMetadata !== null
            && !isPrivateModelMetadata(baseMetadata)
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
      const normalizedRepository = normalizeHuggingFaceModel(metadata, config)
      const isSpeculativeDraft = normalizedRepository.modelKind === 'speculative-draft'
      const speculativeTargetId = normalizedRepository.speculative?.targetModelId ?? null

      if (isSpeculativeDraft) {
        allowEstimate = false
        modelKindOverride = 'speculative-draft'
        if (speculativeTargetId) {
          const targetRoute = parseHuggingFaceModelPath(`/${speculativeTargetId}`)
          if (targetRoute) {
            const targetUrl = new URL(
              `https://huggingface.co/api/models/${encodeURIComponent(targetRoute.owner)}/${encodeURIComponent(targetRoute.repo)}`,
            )
            for (const field of ['sha', 'safetensors', 'gguf', 'tags', 'private']) {
              targetUrl.searchParams.append('expand', field)
            }
            try {
              const targetResponse = await fetcher(targetUrl.toString(), { headers })
              if (targetResponse.ok) {
                const targetMetadata = await targetResponse.json() as Record<string, unknown>
                const canonicalTargetId = typeof targetMetadata.id === 'string'
                  && targetMetadata.id.toLowerCase() === speculativeTargetId.toLowerCase()
                  ? targetMetadata.id
                  : null
                const target = canonicalTargetId
                  && !isPrivateModelMetadata(targetMetadata)
                  && typeof targetMetadata.sha === 'string' && targetMetadata.sha
                  ? normalizeHuggingFaceModel(targetMetadata, {})
                  : null
                canonicalSpeculativeTargetId = target ? canonicalTargetId : null
                const targetWeightBytes = target?.tensorSizeBytes ?? (
                  target && typeof targetMetadata.sha === 'string'
                    ? await fetchTargetWeightSize(
                        fetcher,
                        targetRoute,
                        targetMetadata.sha,
                        metadataTags(targetMetadata),
                        headers,
                      )
                    : null
                )
                const draftWeightBytes = normalizedRepository.tensorSizeBytes
                  ?? modelVariants[0]?.weightSizeBytes
                  ?? null
                if (targetWeightBytes && draftWeightBytes && canonicalTargetId) {
                  resourceEstimate = {
                    kind: 'speculative-draft',
                    title: 'Target + speculative draft weights',
                    description: 'Published target-model and draft-model weights required by this speculative decoding pair.',
                    note: 'This is static weight residency only. Target KV cache, draft cache, block size, batching, hidden-state transfer, and engine workspaces add runtime memory.',
                    baseModelId: canonicalTargetId,
                    options: [{
                      id: 'target-plus-draft',
                      label: 'Target + draft weights',
                      components: [
                        {
                          id: 'target-weights', label: 'Target model weights',
                          repositoryId: canonicalTargetId, sizeBytes: targetWeightBytes,
                        },
                        { id: 'draft-weights', label: 'Draft model weights', sizeBytes: draftWeightBytes },
                      ],
                    }],
                  }
                }
              }
            } catch (error) {
              console.warn(JSON.stringify({
                message: 'failed to fetch optional speculative target metadata',
                model: modelId,
                target: speculativeTargetId,
                error: error instanceof Error ? error.message : String(error),
              }))
            }
          }
        }
      }

      const startingBaseId = isSpeculativeDraft ? null : quantizedBaseId ?? adapterBaseId
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
          for (const field of ['sha', 'safetensors', 'gguf', 'tags', 'private']) {
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
          if (isPrivateModelMetadata(baseMetadata)) {
            allowEstimate = false
            estimateReason = 'unverified-base'
            break
          }
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
      } else if (quantizedBaseId && !isSpeculativeDraft) {
        allowEstimate = false
        estimateReason = 'unverified-base'
      } else if (hasPackedWeightEncoding(metadataRecord, tags)) {
        parameterCountKind = 'tensor-elements'
      }
    }

    const normalized = normalizeHuggingFaceModel(metadata, config, {
      allowEstimate,
      configSourceId,
      estimateReason,
      modelKindOverride,
      parameterCountOverride,
      parameterCountKind,
      variants,
      resourceEstimate,
      addon,
    })
    if (canonicalSpeculativeTargetId && normalized.speculative) {
      normalized.speculative = {
        ...normalized.speculative,
        targetModelId: canonicalSpeculativeTargetId,
      }
    }
    return json(normalized)
  } catch (error) {
    console.error(JSON.stringify({
      message: 'failed to normalize Hugging Face model',
      model: `${route.owner}/${route.repo}`,
      error: error instanceof Error ? error.message : String(error),
    }))
    return json({ error: 'Hugging Face returned an unreadable response' }, 502)
  }
}

interface WorkerBindings {
  MODEL_CACHE: ModelCacheNamespace
  ASSETS: { fetch(request: Request): Promise<Response> }
  HF_TOKEN?: string
  ENVIRONMENT?: string
}

const publicEstimateCorsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, Content-Type',
  'Access-Control-Max-Age': '86400',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
}

function publicEstimateJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...publicEstimateCorsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      ...(status >= 200 && status < 300
        ? {
            'Cache-Control': 'public, max-age=300',
            'Cloudflare-CDN-Cache-Control': 'public, max-age=600, stale-while-revalidate=3600',
          }
        : {
            'Cache-Control': 'no-store',
            'Cloudflare-CDN-Cache-Control': 'no-store',
          }),
    },
  })
}

async function loadPublicModelResponse(
  route: { owner: string; repo: string },
  env: WorkerBindings,
  ctx: ExecutionContext,
) {
  const key = createModelKvKey(route.owner, route.repo)
  const cached = await readModelResponse(env.MODEL_CACHE, key)
  if (cached?.state === 'fresh') return modelResponseFromCache(cached)

  const internalRequest = new Request(
    `https://sizeof.internal/api/models/${encodeURIComponent(route.owner)}/${encodeURIComponent(route.repo)}`,
  )
  const response = await handleModelApi(internalRequest, fetch, readGguf, env.HF_TOKEN)
  if (response.ok) {
    response.headers.set('X-Sizeof-Model-Source', 'huggingface')
    queueModelResponseWrite(env.MODEL_CACHE, key, response.clone(), ctx)
  }
  if (cached?.state === 'stale' && response.status >= 500) return modelResponseFromCache(cached)
  return response
}

type PublicEstimateResolution =
  | { ok: true; value: PublicEstimateResponse }
  | { ok: false; status: number; error: string }

async function resolvePublicEstimate(
  url: URL,
  env: WorkerBindings,
  ctx: ExecutionContext,
): Promise<PublicEstimateResolution> {
  const parsed = parsePublicEstimateQuery(url.searchParams)
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error }
  const route = parseHuggingFaceModelPath(`/${parsed.value.model}`)
  if (!route) return { ok: false, status: 400, error: 'Invalid Hugging Face model path' }
  const modelResponse = await loadPublicModelResponse(route, env, ctx)
  if (!modelResponse.ok) {
    let error = modelResponse.status === 404 ? 'Model not found or private' : 'Model metadata is temporarily unavailable'
    try {
      const body = await modelResponse.json() as { error?: unknown }
      if (typeof body.error === 'string' && body.error.length <= 200) error = body.error
    } catch { /* retain the normalized status message */ }
    return { ok: false, status: modelResponse.status, error }
  }
  try {
    const model = await modelResponse.json() as HuggingFaceModel
    return {
      ok: true,
      value: buildPublicEstimate(model, parsed.value, { publicBaseUrl: publicHost(env.ENVIRONMENT) }),
    }
  } catch (error) {
    const isInvalidInput = error instanceof Error
      && (error.message.startsWith('Selected artifact') || error.message.startsWith('Serving scenario inputs'))
    return {
      ok: false,
      status: isInvalidInput ? 400 : 502,
      error: isInvalidInput && error instanceof Error
        ? error.message
        : 'Model metadata could not be converted into a safe estimate',
    }
  }
}

function escapeXml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function badgeSvg(result: PublicEstimateResponse | null, error?: string, requestedModel?: string) {
  const model = (result?.model.id ?? requestedModel ?? 'sizeof.ai').slice(0, 56)
  const state = result?.result.state === 'estimate'
    ? result.result.fit?.toUpperCase() ?? 'ESTIMATE'
    : result?.result.state === 'lower-bound' ? 'LOWER BOUND' : 'UNAVAILABLE'
  const total = result?.result.estimate?.totalGiB
  const capacity = result ? `${result.hardware.capacityGiB} GiB` : '—'
  const detail = result && Number.isFinite(total) ? `${total!.toFixed(2)} / ${capacity}` : error ? 'SAFE ERROR' : capacity
  const color = result?.result.state === 'estimate' && result.result.fit !== 'too-large'
    ? '#16845b' : result?.result.state === 'lower-bound' ? '#9a5b13' : '#5e6673'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="88" viewBox="0 0 520 88" role="img" aria-label="${escapeXml(`${model}: ${state}, ${detail}, ESTIMATE`)}"><rect width="520" height="88" rx="8" fill="#15181d"/><rect x="0" y="0" width="7" height="88" rx="4" fill="${color}"/><text x="22" y="28" fill="#f5f7fa" font-family="system-ui,sans-serif" font-size="15" font-weight="700">${escapeXml(model)}</text><text x="22" y="54" fill="#b8c0cc" font-family="system-ui,sans-serif" font-size="13">${escapeXml(`${state} · ${detail}`)}</text><text x="424" y="55" fill="#7ea5ff" font-family="monospace" font-size="12" font-weight="700">ESTIMATE</text></svg>`
}

function embedHtml(result: PublicEstimateResponse | null) {
  if (!result) {
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Estimate unavailable | sizeof.ai</title></head><body><main><h1>Estimate unavailable</h1><p>Unable to create this estimate safely.</p><p>Estimate only.</p></main></body></html>'
  }
  const state = result.result.state === 'estimate' ? `Estimate · ${result.result.fit}`
    : result.result.state === 'lower-bound' ? 'Lower bound' : 'Unavailable'
  const total = result.result.estimate ? `${result.result.estimate.totalGiB.toFixed(2)} GiB` : 'No safe total'
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(result.model.id)} estimate | sizeof.ai</title><style>html{color-scheme:dark}body{margin:0;padding:16px;background:#15181d;color:#f5f7fa;font:14px system-ui,sans-serif}.card{border:1px solid #3b4350;border-radius:10px;padding:16px;max-width:440px}h1{font-size:16px;margin:0 0 12px}strong{font-size:24px}p{color:#b8c0cc}a{color:#8eaeff}</style></head><body><main class="card"><h1>${escapeHtml(result.model.id)}</h1><div>${escapeHtml(state)}</div><strong>${escapeHtml(total)} / ${escapeHtml(String(result.hardware.capacityGiB))} GiB</strong><p>${escapeHtml(result.disclaimer)}</p><a href="${escapeHtml(result.detailUrl)}">Open detail calculator</a></main></body></html>`
}

const embedSecurityHeaders = {
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors *",
  'Referrer-Policy': 'no-referrer',
}

export async function handleWorkerRequest(
  request: Request,
  env: WorkerBindings,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url)
  const host = publicHost(env.ENVIRONMENT)
  const estimateApi = url.pathname === '/api/v1/estimate'
  const estimateBadge = url.pathname === '/badge/v1/estimate.svg'
  const estimateEmbed = url.pathname === '/embed/v1/estimate'
  if (estimateApi || estimateBadge || estimateEmbed) {
    if (estimateApi && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: publicEstimateCorsHeaders })
    }
    if (request.method !== 'GET') {
      if (estimateApi) {
        const response = publicEstimateJson({ error: 'Method not allowed' }, 405)
        response.headers.set('Allow', 'GET, OPTIONS')
        return response
      }
      const body = estimateBadge ? badgeSvg(null, 'Method not allowed') : embedHtml(null)
      return new Response(body, {
        status: 405,
        headers: {
          'Content-Type': estimateBadge ? 'image/svg+xml; charset=utf-8' : 'text/html; charset=utf-8',
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          ...(estimateEmbed ? embedSecurityHeaders : {}),
        },
      })
    }
    if (request.url.length > 4096) {
      if (estimateApi) return publicEstimateJson({ error: 'Request URL is too long' }, 414)
      const body = estimateBadge ? badgeSvg(null, 'Request URL is too long') : embedHtml(null)
      return new Response(body, {
        status: 414,
        headers: {
          'Content-Type': estimateBadge ? 'image/svg+xml; charset=utf-8' : 'text/html; charset=utf-8',
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          ...(estimateEmbed ? embedSecurityHeaders : {}),
        },
      })
    }
    const resolved = await resolvePublicEstimate(url, env, ctx)
    if (estimateApi) return resolved.ok
      ? publicEstimateJson(resolved.value)
      : publicEstimateJson({ error: resolved.error }, resolved.status)
    if (estimateBadge) {
      const requestedRoute = parseHuggingFaceModelPath(`/${url.searchParams.get('model') ?? ''}`)
      const requestedModel = requestedRoute ? `${requestedRoute.owner}/${requestedRoute.repo}` : undefined
      return new Response(resolved.ok ? badgeSvg(resolved.value) : badgeSvg(null, resolved.error, requestedModel), {
        status: resolved.ok ? 200 : resolved.status,
        headers: {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Cache-Control': resolved.ok ? 'public, max-age=300' : 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }
    return new Response(resolved.ok ? embedHtml(resolved.value) : embedHtml(null), {
      status: resolved.ok ? 200 : resolved.status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': resolved.ok ? 'public, max-age=300' : 'no-store',
        ...embedSecurityHeaders,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }
  if (url.pathname === '/share/card.svg') {
    const card = svgCardInput(url)
    return card
      ? staticResponse(renderShareCard(card), 'image/svg+xml; charset=utf-8', 'public, max-age=300, stale-while-revalidate=600')
      : staticResponse('Invalid share-card parameters', 'text/plain; charset=utf-8', 'no-store', 400)
  }
  if (url.pathname === '/robots.txt') {
    return staticResponse(`User-agent: *\nAllow: /\nSitemap: ${host}/sitemap.xml\n`, 'text/plain; charset=utf-8', 'public, max-age=3600')
  }
  if (url.pathname === '/sitemap.xml') {
    return staticResponse(sitemap(host), 'application/xml; charset=utf-8', 'public, max-age=3600')
  }
  if (url.pathname === '/api/search/models') {
    return handleModelSearchApi(request, fetch, env.HF_TOKEN)
  }
  if (!url.pathname.startsWith('/api/models/')) {
    const asset = await env.ASSETS.fetch(request)
    const metadata = pageMetadata(url.pathname, host)
    if (url.pathname === '/' && env.ENVIRONMENT === 'testnet' && asset.headers.get('Content-Type')?.includes('text/html')) {
      const headers = new Headers(asset.headers)
      headers.set('Cache-Control', 'no-cache')
      return new Response(rewriteHomepageCanonical(await asset.text(), host), { status: asset.status, statusText: asset.statusText, headers })
    }
    if (!metadata || !asset.headers.get('Content-Type')?.includes('text/html')) return applyAssetCachePolicy(asset)
    const headers = new Headers(asset.headers)
    headers.set('Cache-Control', 'no-cache')
    return new Response(injectMetadata(await asset.text(), metadata), { status: asset.status, statusText: asset.statusText, headers })
  }

  const route = apiRoute(url.pathname)
  let cachedModel: Awaited<ReturnType<typeof readModelResponse>> = null
  if (route) {
    cachedModel = await readModelResponse(
      env.MODEL_CACHE,
      createModelKvKey(route.owner, route.repo),
    )
    if (cachedModel?.state === 'fresh') return modelResponseFromCache(cachedModel)
  }

  const response = await handleModelApi(request, fetch, readGguf, env.HF_TOKEN)
  if (route && response.ok) {
    response.headers.set('X-Sizeof-Model-Source', 'huggingface')
    queueModelResponseWrite(
      env.MODEL_CACHE,
      createModelKvKey(route.owner, route.repo),
      response.clone(),
      ctx,
    )
  }
  if (cachedModel?.state === 'stale' && response.status >= 500) {
    return modelResponseFromCache(cachedModel)
  }
  return response
}

export default {
  fetch: handleWorkerRequest,
} satisfies ExportedHandler<Env>
