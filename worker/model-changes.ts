import { parseHuggingFaceModelPath } from '../src/lib/huggingface'
import { readBoundedBody, UpstreamError } from './upstream'

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type FileFact = { path: string; size: number | null; blob: string | null }
type Snapshot = { revision: string; files: FileFact[]; config: Record<string, unknown> | null; license: string | null; metadata: Record<string, unknown> }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value)
class LookupError extends Error { constructor(message: string, readonly status: number) { super(message) } }

async function getJson(url: string, fetcher: Fetcher): Promise<Record<string, unknown>> {
  const response = await fetcher(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    await response.body?.cancel()
    throw new LookupError([401, 403, 404].includes(response.status) ? 'Public model or revision is unavailable.' : 'Hugging Face could not supply this comparison. Retry later.', [401, 403, 404].includes(response.status) ? 404 : 502)
  }
  if (/rel\s*=\s*["']?next/i.test(response.headers.get('Link') ?? '')) { await response.body?.cancel(); throw new LookupError('A partial metadata response cannot establish a complete file comparison.', 502) }
  const raw: unknown = JSON.parse(new TextDecoder().decode(await readBoundedBody(response, 1024 * 1024)))
  if (!object(raw)) throw new LookupError('Invalid model metadata response.', 502)
  return raw
}

function publicIdentity(data: Record<string, unknown>, model: string, revision?: string) {
  if (data.private !== false) throw new LookupError('Public model or revision is unavailable.', 404)
  if (typeof data.id !== 'string' || data.id.toLowerCase() !== model.toLowerCase() || !hash(data.sha)
    || (revision && String(data.sha).toLowerCase() !== revision)) throw new LookupError('Model identity or revision does not match the requested comparison.', 502)
}

function files(value: unknown): FileFact[] {
  if (!Array.isArray(value) || value.length > 1000) throw new LookupError('A complete file list of at most 1,000 files is required; no partial comparison was returned.', 502)
  const seen = new Set<string>()
  return value.map(raw => {
    if (!object(raw) || typeof raw.rfilename !== 'string' || !raw.rfilename || raw.rfilename.length > 512
      || raw.rfilename.startsWith('/') || /[\x00-\x1f\x7f\\]/.test(raw.rfilename)
      || raw.rfilename.split('/').some(part => !part || part === '.' || part === '..') || seen.has(raw.rfilename)) throw new LookupError('Invalid or duplicated repository file entry.', 502)
    seen.add(raw.rfilename)
    if (raw.size !== undefined && (typeof raw.size !== 'number' || !Number.isSafeInteger(raw.size) || raw.size < 0)) throw new LookupError('Invalid repository file size.', 502)
    if (raw.blobId !== undefined && !hash(raw.blobId)) throw new LookupError('Invalid repository file identifier.', 502)
    return { path: raw.rfilename, size: typeof raw.size === 'number' ? raw.size : null, blob: typeof raw.blobId === 'string' ? raw.blobId.toLowerCase() : null }
  })
}

async function snapshot(model: string, revision: string, fetcher: Fetcher): Promise<Snapshot> {
  const encoded = model.split('/').map(encodeURIComponent).join('/')
  const metadata = await getJson(`https://huggingface.co/api/models/${encoded}/revision/${revision}?blobs=true`, fetcher)
  publicIdentity(metadata, model, revision)
  const entries = files(metadata.siblings)
  const config = entries.some(file => file.path === 'config.json') ? await getJson(`https://huggingface.co/${encoded}/resolve/${revision}/config.json`, fetcher) : null
  const card = object(metadata.cardData) ? metadata.cardData : {}
  const rawLicense = card.license ?? (Array.isArray(metadata.tags) ? metadata.tags.find(tag => typeof tag === 'string' && tag.startsWith('license:'))?.slice(8) : undefined)
  if (rawLicense != null && !(typeof rawLicense === 'string' && rawLicense.length <= 300)
    && !(Array.isArray(rawLicense) && rawLicense.every(item => typeof item === 'string') && JSON.stringify(rawLicense).length <= 300)) throw new LookupError('License declaration metadata is malformed or exceeds the safe comparison limit.', 502)
  const license = typeof rawLicense === 'string' ? rawLicense : Array.isArray(rawLicense) ? JSON.stringify(rawLicense) : null
  return { revision, files: entries, config, license, metadata }
}

function facts(s: Snapshot) {
  const output: Record<string, string | null> = { licenseDeclaration: s.license, configurationAvailable: String(s.config !== null) }
  const config = s.config ?? {}
  const value = (v: unknown): string | null => v === undefined || v === null ? null : JSON.stringify(v)
  const keys = ['model_type', 'architectures', 'num_hidden_layers', 'hidden_size', 'num_attention_heads', 'num_key_value_heads', 'head_dim', 'max_position_embeddings', 'sliding_window', 'kv_lora_rank', 'rope_scaling', 'quantization_config', 'layer_types', 'block_types', 'linear_attn_config', 'attn_layer_period', 'attn_layer_offset', 'mamba_d_state', 'state_size', 'num_experts', 'num_local_experts', 'num_experts_per_tok', 'n_routed_experts']
  for (const key of keys) output[key] = value(config[key])
  const text = object(config.text_config) ? config.text_config : {}
  for (const key of keys) output[`text_config.${key}`] = value(text[key])
  return output
}

export async function handleModelChanges(request: Request, fetcher: Fetcher): Promise<Response> {
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET', 'Cache-Control': 'no-store' } })
  const params = new URL(request.url).searchParams
  if (request.url.length > 2048 || [...params.keys()].some(key => !['model', 'before', 'after'].includes(key) || params.getAll(key).length !== 1)) return json({ error: 'Invalid comparison parameters.' }, 400)
  const model = params.get('model') ?? '', before = (params.get('before') ?? '').toLowerCase(), afterInput = params.get('after')?.toLowerCase()
  const route = parseHuggingFaceModelPath(`/${model}`)
  if (!route || `${route.owner}/${route.repo}` !== model || !hash(before) || (afterInput !== undefined && !hash(afterInput))) return json({ error: 'Provide a public owner/repository and full 40-character commit IDs.' }, 400)
  try {
    const current = await getJson(`https://huggingface.co/api/models/${model.split('/').map(encodeURIComponent).join('/')}`, fetcher)
    publicIdentity(current, model)
    const after = afterInput ?? String(current.sha).toLowerCase()
    const oldPromise = snapshot(model, before, fetcher)
    const [old, latest] = await Promise.all([oldPromise, before === after ? oldPromise : snapshot(model, after, fetcher)])
    const previous = new Map(old.files.map(file => [file.path, file])), next = new Map(latest.files.map(file => [file.path, file]))
    const changes: { path: string; change: 'added' | 'removed' | 'modified' | 'unknown'; beforeBytes: number | null; afterBytes: number | null }[] = []
    let unknownContentFiles = 0
    for (const path of [...new Set([...previous.keys(), ...next.keys()])].sort()) {
      const a = previous.get(path), b = next.get(path)
      const change = !a ? 'added' : !b ? 'removed' : a.size !== null && b.size !== null && a.size !== b.size ? 'modified'
        : a.blob && b.blob ? a.blob === b.blob ? null : 'modified' : before === after ? null : 'unknown'
      if (change === 'unknown') unknownContentFiles++
      if (change) changes.push({ path, change, beforeBytes: a?.size ?? null, afterBytes: b?.size ?? null })
    }
    const a = facts(old), b = facts(latest)
    return json({ modelId: String(current.id), checkedAt: new Date().toISOString(),
      before: { revision: before, files: old.files.length, configAvailable: old.config !== null, license: old.license },
      after: { revision: after, files: latest.files.length, configAvailable: latest.config !== null, license: latest.license },
      listingComplete: true, unknownContentFiles, files: changes,
      facts: Object.keys(a).filter(field => a[field] !== b[field]).map(field => ({ field,
        before: a[field] === null ? null : a[field].length > 500 ? a[field].slice(0, 500) + '… [abbreviated]' : a[field],
        after: b[field] === null ? null : b[field].length > 500 ? b[field].slice(0, 500) + '… [abbreviated]' : b[field] })),
      notes: ['File differences use complete Hub sibling lists and Git blob identifiers when supplied; missing identifiers are shown as unknown, not unchanged.', 'Architecture comparison covers selected published configuration fields, not every behavior or runtime requirement. Values longer than 500 characters are abbreviated.', 'License declarations are Hub metadata, not legal advice or a full license-text comparison. Inspect the corresponding model card and license files.', 'No model files were downloaded, upgraded, or executed. A changed file does not imply better quality, speed, or lower memory.'] })
  } catch (error) {
    const status = error instanceof LookupError ? error.status : 502
    console.warn(JSON.stringify({ message: 'Model revision comparison failed', model, status, errorType: error instanceof Error ? error.name : 'unknown' }))
    return json({ error: error instanceof LookupError ? error.message : error instanceof UpstreamError ? 'Model metadata exceeded the safe comparison size.' : 'Model comparison could not be completed. No partial result was returned.' }, status)
  }
}
