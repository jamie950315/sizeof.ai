import { deploymentModelId } from './deployment'

export interface DeploymentArtifact {
  repositoryId: string
  path: string
  revision: string
  sizeBytes: number
  label: string
  sourceModelId: string
  checkedAt: string
}
export interface ArtifactChoices { artifacts: DeploymentArtifact[]; omittedSplitFiles: number }
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export function parseArtifactChoices(value: unknown, requestedId: string, checkedAt = new Date().toISOString()): ArtifactChoices {
  if (!record(value) || typeof value.id !== 'string' || value.id.toLowerCase() !== requestedId.toLowerCase()) throw new Error('Model identity mismatch. Check the canonical model page before selecting files.')
  const sourceModelId = deploymentModelId(value.id)
  if (value.private === true) throw new Error('Private repositories cannot be selected here.')
  if (value.componentKind !== 'model' || !['language', 'vision-language'].includes(String(value.modelKind))) throw new Error('This is not an identified standalone language model. Review its component and runtime requirements directly.')
  if (!Array.isArray(value.variants) || value.variants.length > 2000) throw new Error('Invalid or oversized artifact list. No files were selected.')
  const artifacts: DeploymentArtifact[] = []
  let omittedSplitFiles = 0
  const seen = new Set<string>()
  for (const variant of value.variants) {
    if (!record(variant) || typeof variant.format !== 'string' || typeof variant.role !== 'string') throw new Error('Malformed artifact metadata. Retry the lookup.')
    if (variant.format !== 'gguf' || variant.role !== 'model') continue
    if (typeof variant.path !== 'string' || variant.path.length > 240 || !/^[A-Za-z0-9][A-Za-z0-9_./-]*\.gguf$/i.test(variant.path) || variant.path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe or unsupported artifact filename. Review the repository files directly.')
    if (typeof variant.revision !== 'string' || !/^[a-f0-9]{40}$/i.test(variant.revision) || typeof variant.weightSizeBytes !== 'number' || !Number.isSafeInteger(variant.weightSizeBytes) || variant.weightSizeBytes <= 0 || typeof variant.label !== 'string' || !variant.label.trim() || variant.label.length > 500) throw new Error('Incomplete artifact revision or size. Retry the lookup.')
    if (/(?:imatrix|calibration|mmproj|projector)/i.test(variant.path)) continue
    if (/-\d{5}-of-\d{5}\.gguf$/i.test(variant.path)) { omittedSplitFiles++; continue }
    if (variant.provenance === 'community' && typeof variant.repositoryId !== 'string') throw new Error('Community artifact publisher is missing. No file can be selected safely.')
    const repositoryId = variant.repositoryId === undefined ? sourceModelId : typeof variant.repositoryId === 'string' ? deploymentModelId(variant.repositoryId) : ''
    if (!repositoryId) throw new Error('Invalid artifact repository.')
    const key = `${repositoryId}/${variant.revision}/${variant.path}`
    if (seen.has(key)) continue
    seen.add(key)
    artifacts.push({ repositoryId, path: variant.path, revision: variant.revision, sizeBytes: variant.weightSizeBytes, label: variant.label, sourceModelId, checkedAt })
  }
  return { artifacts, omittedSplitFiles }
}

export async function fetchArtifactChoices(modelInput: string, signal: AbortSignal): Promise<ArtifactChoices> {
  const id = deploymentModelId(modelInput)
  const response = await fetch(`/api/models/${id.split('/').map(encodeURIComponent).join('/')}`, { signal })
  if (!response.ok) throw new Error(response.status === 404 ? 'This model is unavailable or private. Verify the public model ID.' : `Artifact lookup failed (HTTP ${response.status}). Retry; no previous files are being used.`)
  if (response.headers.get('X-Sizeof-Model-Source')?.includes('stale')) throw new Error('The model service returned stale metadata. Retry when fresh data is available.')
  const limit = 2 * 1024 * 1024
  if (Number(response.headers.get('Content-Length')) > limit) {
    await response.body?.cancel()
    throw new Error('Artifact response is too large. Review the repository directly.')
  }
  if (!response.body) throw new Error('Artifact response was empty.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw new Error('Artifact response is too large. Review the repository directly.')
      chunks.push(value)
    }
  } catch (error) { await reader.cancel(); throw error }
  finally { reader.releaseLock() }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  let payload: unknown
  try { payload = JSON.parse(new TextDecoder().decode(body)) }
  catch { throw new Error('Artifact service returned invalid JSON. Retry the lookup.') }
  return parseArtifactChoices(payload, id)
}
