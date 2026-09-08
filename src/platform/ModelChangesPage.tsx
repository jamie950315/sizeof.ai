import { useEffect, useRef, useState } from 'react'
import { normalizeCompareModelInput } from '../lib/compare-state'
import './model-changes.css'

interface Snapshot { revision: string; files: number; configAvailable: boolean; license: string | null }
interface FileChange { path: string; change: 'added' | 'removed' | 'modified' | 'unknown'; beforeBytes: number | null; afterBytes: number | null }
interface ModelChanges { modelId: string; checkedAt: string; before: Snapshot; after: Snapshot; listingComplete: true; unknownContentFiles: number; files: FileChange[]; facts: { field: string; before: string | null; after: string | null }[]; notes: string[] }
const sha = /^[a-f0-9]{40}$/i
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max
const nullableText = (v: unknown) => v === null || text(v, 10000)
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
function parseResult(value: unknown, model: string, before: string, after: string): ModelChanges {
  const invalid = () => new Error('The service returned incomplete or mismatched comparison data. No comparison is shown.')
  if (!obj(value) || typeof value.modelId !== 'string' || value.modelId.toLowerCase() !== model.toLowerCase() || normalizeCompareModelInput(value.modelId) !== value.modelId || !text(value.checkedAt, 40) || !Number.isFinite(Date.parse(value.checkedAt)) || value.listingComplete !== true || !count(value.unknownContentFiles)) throw invalid()
  for (const key of ['before', 'after'] as const) {
    const snapshot = value[key]
    if (!obj(snapshot) || typeof snapshot.revision !== 'string' || !sha.test(snapshot.revision) || !count(snapshot.files) || typeof snapshot.configAvailable !== 'boolean' || !nullableText(snapshot.license)) throw invalid()
    if ((key === 'before' && snapshot.revision.toLowerCase() !== before.toLowerCase()) || (key === 'after' && after && snapshot.revision.toLowerCase() !== after.toLowerCase())) throw invalid()
  }
  if (!Array.isArray(value.files) || value.files.length > 20000 || !Array.isArray(value.facts) || value.facts.length > 200 || !Array.isArray(value.notes) || value.notes.length > 100 || value.notes.some(n => !text(n, 10000))) throw invalid()
  const paths = new Set<string>()
  for (const file of value.files) {
    if (!obj(file) || !text(file.path, 2000) || !file.path || paths.has(file.path) || !['added', 'removed', 'modified', 'unknown'].includes(String(file.change)) || !(file.beforeBytes === null || count(file.beforeBytes)) || !(file.afterBytes === null || count(file.afterBytes))) throw invalid()
    if ((file.change === 'added' && file.beforeBytes !== null) || (file.change === 'removed' && file.afterBytes !== null)) throw invalid()
    paths.add(file.path)
  }
  if (value.facts.some(f => !obj(f) || !text(f.field, 200) || !f.field || !nullableText(f.before) || !nullableText(f.after))) throw invalid()
  return value as unknown as ModelChanges
}
async function readResult(response: Response): Promise<unknown> {
  const limit = 2 * 1024 * 1024
  if (Number(response.headers.get('Content-Length')) > limit) { await response.body?.cancel(); throw new Error('Comparison is too large to display. Inspect the repository revisions directly.') }
  if (!response.body) throw new Error('Comparison response was empty.')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0
  try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) throw new Error('Comparison is too large to display.'); chunks.push(value) } }
  catch (error) { await reader.cancel(); throw error } finally { reader.releaseLock() }
  const body = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder().decode(body)) } catch { throw new Error('Comparison service returned invalid JSON.') }
}
function bytes(value: number | null) { if (value === null) return 'Unknown / not present'; if (value < 1024) return `${value} B`; const exponent = Math.min(4, Math.floor(Math.log(value) / Math.log(1024))); return `${(value / 1024 ** exponent).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${['B', 'KiB', 'MiB', 'GiB', 'TiB'][exponent]}` }
export default function ModelChangesPage() {
  const [input, setInput] = useState(() => { const p = new URLSearchParams(window.location.search); return { model: p.get('model') ?? '', before: p.get('before') ?? '', after: p.get('after') ?? '' } })
  const [result, setResult] = useState<ModelChanges>(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [filter, setFilter] = useState('all'), [query, setQuery] = useState(''), [shown, setShown] = useState(100)
  const active = useRef<AbortController | null>(null), generation = useRef(0)
  useEffect(() => () => { generation.current++; active.current?.abort() }, [])
  function update(key: keyof typeof input, value: string) { generation.current++; active.current?.abort(); setBusy(false); setResult(undefined); setError(''); setInput(s => ({ ...s, [key]: value })) }
  async function compare() {
    const model = normalizeCompareModelInput(input.model), before = input.before.trim(), after = input.after.trim()
    setResult(undefined); setError('')
    if (!model || !sha.test(before) || (after && !sha.test(after))) { setError('Enter a public model ID or supported model URL, a complete 40-character earlier revision, and an optional complete later revision.'); return }
    active.current?.abort(); const controller = new AbortController(), token = ++generation.current; active.current = controller; setBusy(true)
    let timedOut = false
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); if (token === generation.current) { generation.current++; setBusy(false); setError('Comparison timed out after 45 seconds. No previous result is substituted. Retry when the source is available.') } }, 45000)
    try {
      const params = new URLSearchParams({ model, before: before.toLowerCase(), ...(after ? { after: after.toLowerCase() } : {}) })
      const response = await fetch(`/api/model-changes?${params}`, { signal: controller.signal, cache: 'no-store' })
      if (!response.ok) throw new Error(`Comparison failed (HTTP ${response.status}). The repository or revision may be unavailable, private, or too large. Nothing was upgraded.`)
      if (response.headers.get('X-Sizeof-Model-Source')?.includes('stale')) throw new Error('Stale metadata cannot establish a fresh comparison. Please retry.')
      const data = parseResult(await readResult(response), model, before, after)
      if (token !== generation.current || controller.signal.aborted) return
      setResult(data); setShown(100); setFilter('all'); setQuery('')
    } catch (reason) { if (token === generation.current && !timedOut) setError(reason instanceof Error ? reason.message : 'Comparison could not be completed.') }
    finally { window.clearTimeout(timer); if (token === generation.current) setBusy(false) }
  }
  const files = result?.files.filter(file => (filter === 'all' || file.change === filter) && file.path.toLowerCase().includes(query.toLowerCase())) ?? []
  return <main className="platform-main model-changes-page"><p className="platform-eyebrow">INSPECT BEFORE YOU UPGRADE</p><h1>Model version changes</h1><p className="platform-lead">Compare public repository files and selected published configuration facts. No model weights are downloaded, no saved settings are replaced, and no upgrade runs automatically.</p>
    <form className="model-changes-inputs" onSubmit={e => { e.preventDefault(); void compare() }}><label>Model ID or model URL<input required maxLength={500} value={input.model} onChange={e => update('model', e.target.value)} placeholder="owner/model" /></label><label>Earlier revision<input required maxLength={40} value={input.before} onChange={e => update('before', e.target.value)} placeholder="Complete 40-character commit" /></label><label>Later revision (optional)<input maxLength={40} value={input.after} onChange={e => update('after', e.target.value)} placeholder="Blank: resolve current revision when checked" /></label><button className="platform-primary" disabled={busy} type="submit">{busy ? 'Checking revisions…' : 'Compare revisions'}</button></form>
    <p>Links only fill the form; checking starts when you press Compare. Leaving the later revision blank resolves the current revision once, then compares that fixed version. This does not bypass repository access restrictions.</p>{busy && <p role="status">Reading revision metadata. Large repositories may take longer; the request stops after 45 seconds.</p>}{error && <p className="platform-alert" role="alert">{error}</p>}
    {result && <section aria-label="Revision comparison"><header><h2>{result.modelId}</h2><p>Checked {new Date(result.checkedAt).toLocaleString()} · file listings completed for both revisions.</p></header><div className="model-changes-snapshots">{(['before', 'after'] as const).map((side, i) => <article key={side}><h3>{i ? 'Later revision' : 'Earlier revision'}</h3><code>{result[side].revision}</code><p>{result[side].files.toLocaleString()} files · configuration {result[side].configAvailable ? 'available' : 'unavailable'}</p><p>License metadata: {result[side].license ?? 'Unknown / not published'}</p><a target="_blank" rel="noreferrer" href={`https://huggingface.co/${result.modelId}/tree/${result[side].revision}`}>Inspect {i ? 'later' : 'earlier'} repository files ↗</a></article>)}</div>
      <p className="model-changes-caution">{result.unknownContentFiles.toLocaleString()} files have content that cannot be compared reliably. Unknown does not mean unchanged. License labels are metadata, not a legal-text review. Architecture changes do not prove quality, speed or runtime compatibility.</p>
      {result.notes.length > 0 && <ul>{result.notes.map((note, i) => <li key={i}>{note}</li>)}</ul>}
      <h3>Published fact changes</h3>{!result.facts.length ? <p>No differences detected in the selected available facts. Missing configuration or untracked fields can still hide changes.</p> : <div className="model-changes-facts">{result.facts.map((fact, i) => <article key={i}><h4>{fact.field}</h4><dl><div><dt>Earlier</dt><dd>{fact.before ?? 'Unknown / not published'}</dd></div><div><dt>Later</dt><dd>{fact.after ?? 'Unknown / not published'}</dd></div></dl></article>)}</div>}
      <h3>File differences and unresolved content</h3><div className="model-changes-filters"><label>Find file<input type="search" value={query} onChange={e => { setQuery(e.target.value); setShown(100) }} /></label><label>Change type<select value={filter} onChange={e => { setFilter(e.target.value); setShown(100) }}>{['all', 'added', 'removed', 'modified', 'unknown'].map(kind => <option value={kind} key={kind}>{kind === 'unknown' ? 'Unknown content' : kind === 'all' ? 'All differences' : kind}</option>)}</select></label></div><p>{files.length.toLocaleString()} matching entries. Sizes use binary units; blank sides can mean absent or unavailable, never zero bytes.</p>
      {!files.length ? <p>No matching file differences. This is not proof of identical behavior or completeness beyond the listed comparison.</p> : <div className="model-changes-files">{files.slice(0, shown).map(file => <article key={file.path}><div><strong>{file.path}</strong><span className={`model-change-kind model-change-${file.change}`}>{file.change === 'unknown' ? 'Content unknown' : file.change}</span></div><p>Earlier: {bytes(file.beforeBytes)} → Later: {bytes(file.afterBytes)}</p></article>)}</div>}
      {files.length > shown && <button onClick={() => setShown(n => n + 100)}>Show next {Math.min(100, files.length - shown)} entries</button>}
    </section>}
  </main>
}
