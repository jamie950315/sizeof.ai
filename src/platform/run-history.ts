import { buildDeploymentPlan, deploymentModelId, restoreDeployment, validateShardFiles, type DeploymentInput } from './deployment'

export const runStorageKey = 'sizeof-deployment-runs-v1'
export const runLimit = 100
export const runByteLimit = 2 * 1024 * 1024
export type RunOutcome = 'planned' | 'succeeded' | 'failed'
export interface RunArtifact { repositoryId: string; path: string; revision: string; sizeBytes: number; sourceModelId: string; checkedAt: string; files?: Array<{path:string;sizeBytes:number}> }
export interface DeploymentRun { id: string; savedAt: string; input: DeploymentInput; artifact?: RunArtifact; runtimeVersion: string; hardwareLabel: string; outcome: RunOutcome; notes: string; firstError: string }
type RunDetails = Pick<DeploymentRun, 'runtimeVersion' | 'hardwareLabel' | 'outcome' | 'notes' | 'firstError'>
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid deployment record.')
  return value as Record<string, unknown>
}
function text(value: unknown, limit: number): string {
  if (typeof value !== 'string' || value.length > limit) throw new Error('A record field is missing or too long.')
  return value
}
function date(value: unknown): string {
  const result = text(value, 40)
  if (!/^\d{4}-\d\d-\d\dT/.test(result) || !Number.isFinite(Date.parse(result))) throw new Error('Invalid record date.')
  return new Date(result).toISOString()
}
function parseRun(value: unknown): DeploymentRun {
  const row = object(value), raw = object(row.input)
  const id = text(row.id, 80)
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error('Invalid record ID.')
  // Validate types before the command builder, then discard unrecognized fields.
  const fields = Object.fromEntries(['os', 'hardware', 'engine', 'model', 'file', 'context', 'port'].map(key => [key, text(raw[key], 512)]))
  if (raw.revision !== undefined) { const revision = text(raw.revision, 80).trim(); if (revision) fields.revision = revision }
  if (raw.shardFiles !== undefined) fields.shardFiles = JSON.stringify(validateShardFiles(raw.shardFiles, fields.file))
  const input = restoreDeployment(new URLSearchParams({ ...fields, v: fields.shardFiles ? '3' : fields.revision ? '2' : '1' }).toString())
  const outcome = row.outcome
  if (outcome !== 'planned' && outcome !== 'succeeded' && outcome !== 'failed') throw new Error('Invalid reported outcome.')
  const result: DeploymentRun = { id, savedAt: date(row.savedAt), input, outcome, runtimeVersion: text(row.runtimeVersion, 120), hardwareLabel: text(row.hardwareLabel, 160), notes: text(row.notes, 3000), firstError: text(row.firstError, 2000) }
  if (row.artifact !== undefined) {
    const a = object(row.artifact)
    const repositoryId = deploymentModelId(text(a.repositoryId, 193)), sourceModelId = deploymentModelId(text(a.sourceModelId, 193))
    const path = text(a.path, 240), revision = text(a.revision, 40)
    if (!/^[a-f0-9]{40}$/i.test(revision) || !Number.isSafeInteger(a.sizeBytes) || Number(a.sizeBytes) <= 0 || !/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Invalid saved artifact facts.')
    if (repositoryId !== input.model || path !== input.file || input.engine !== 'llama-cpp') throw new Error('Saved artifact does not match the deployment configuration.')
    if (input.revision && input.revision.toLowerCase() !== revision.toLowerCase()) throw new Error('Requested and observed model revisions do not match.')
    result.artifact = { repositoryId, sourceModelId, path, revision, sizeBytes: Number(a.sizeBytes), checkedAt: date(a.checkedAt) }
    if (a.files !== undefined) {
      if (!Array.isArray(a.files)) throw new Error('Invalid artifact shard facts.')
      const members = a.files.map(raw => { const f = object(raw); if (!Number.isSafeInteger(f.sizeBytes) || Number(f.sizeBytes) <= 0) throw new Error('Invalid shard size.'); return { path: text(f.path, 240), sizeBytes: Number(f.sizeBytes) } })
      const paths = validateShardFiles(members.map(file => file.path), path)
      if (JSON.stringify(paths) !== JSON.stringify(input.shardFiles) || members.reduce((sum, file) => sum + file.sizeBytes, 0) !== result.artifact.sizeBytes) throw new Error('Artifact shard facts do not match the requested manifest or total.')
      result.artifact.files = members
    }
  }
  return result
}
export function parseRuns(value: unknown): DeploymentRun[] {
  const data = object(value)
  if (![1, 2, 3].includes(data.version as number) || !Array.isArray(data.items) || data.items.length > runLimit) throw new Error('Unsupported deployment backup. Maximum 100 records.')
  if (data.version === 1 && data.items.some(value => object(object(value).input).revision !== undefined)) throw new Error('Fixed-revision records require backup format version 2. No records were imported.')
  if (data.version !== 3 && data.items.some(value => object(object(value).input).shardFiles !== undefined || (object(value).artifact !== undefined && object(object(value).artifact).files !== undefined))) throw new Error('Shard records require backup format version 3.')
  const rows = data.items.map(parseRun)
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Duplicate record IDs in backup.')
  if (new TextEncoder().encode(JSON.stringify({ version: 3, items: rows })).length > runByteLimit) throw new Error('Deployment backup exceeds 2 MB.')
  return rows
}
export function rawRuns(): string { return localStorage.getItem(runStorageKey) ?? '{"version":3,"items":[]}' }
export function readRuns(): DeploymentRun[] {
  const body = rawRuns()
  if (new TextEncoder().encode(body).length > runByteLimit) throw new Error('Deployment backup exceeds 2 MB.')
  return parseRuns(JSON.parse(body))
}
export function writeRuns(items: DeploymentRun[]): DeploymentRun[] {
  const valid = parseRuns({ version: 3, items })
  localStorage.setItem(runStorageKey, JSON.stringify({ version: 3, items: valid }))
  return valid
}
export function createRun(input: DeploymentInput, details: RunDetails, artifact?: RunArtifact): DeploymentRun {
  buildDeploymentPlan(input)
  return parseRun({ ...details, input, artifact, id: crypto.randomUUID(), savedAt: new Date().toISOString() })
}
// Read storage immediately before each synchronous mutation, never a stale React snapshot.
// On ID collision retain current data; different imported content gets its own ID.
export function mergeRuns(imported: DeploymentRun[]): DeploymentRun[] {
  const current = readRuns()
  for (const row of parseRuns({ version: 3, items: imported })) {
    const collision = current.find(item => item.id === row.id)
    if (collision && JSON.stringify(collision) === JSON.stringify(row)) continue
    current.push(collision ? { ...row, id: crypto.randomUUID() } : row)
  }
  return writeRuns(current)
}
export function removeRun(id: string): { items: DeploymentRun[]; removed?: DeploymentRun } {
  const current = readRuns(), removed = current.find(row => row.id === id)
  return { items: writeRuns(current.filter(row => row.id !== id)), removed }
}
export function downloadRuns(body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = 'sizeof-deployment-records.json'; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
