import { useEffect, useRef, useState } from 'react'
import './status.css'

interface RegionStatus {
  id: 'jp' | 'us'; label: string; reachable: boolean; ready: boolean | null; syncHealthy: boolean | null
  models: number | null; updatedAt: string | null; generation: string | null; stale: boolean | null
  lastSyncAt: string | null; initialBackfillComplete: boolean | null; lastFullBackfillAt: string | null; error: string | null
}
interface DataStatus { checkedAt: string; regions: RegionStatus[]; alignment: 'aligned' | 'different' | 'unknown'; completeness: 'not-guaranteed'; coverageNote: string }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const date = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))
const nullableDate = (value: unknown) => value === null || date(value)
const nullableBool = (value: unknown) => value === null || typeof value === 'boolean'

export function parseDataStatus(value: unknown): DataStatus {
  const invalid = () => new Error('The status service returned invalid or inconsistent data. No current status can be confirmed.')
  if (!record(value) || !date(value.checkedAt) || !Array.isArray(value.regions) || value.regions.length !== 2 || !['aligned', 'different', 'unknown'].includes(String(value.alignment)) || value.completeness !== 'not-guaranteed' || typeof value.coverageNote !== 'string' || !value.coverageNote.trim() || value.coverageNote.length > 2000) throw invalid()
  const ids = new Set<string>()
  for (const region of value.regions) {
    if (!record(region) || !['jp', 'us'].includes(String(region.id)) || ids.has(String(region.id)) || typeof region.label !== 'string' || !region.label.trim() || region.label.length > 80 || typeof region.reachable !== 'boolean' || !nullableBool(region.ready) || !nullableBool(region.syncHealthy) || !nullableBool(region.stale) || !nullableBool(region.initialBackfillComplete) || !(region.models === null || typeof region.models === 'number' && Number.isSafeInteger(region.models) && region.models >= 0) || !nullableDate(region.updatedAt) || !nullableDate(region.lastSyncAt) || !nullableDate(region.lastFullBackfillAt) || !(region.generation === null || typeof region.generation === 'string' && /^[a-f0-9]{64}$/i.test(region.generation)) || !(region.error === null || typeof region.error === 'string' && region.error.length <= 500)) throw invalid()
    ids.add(String(region.id))
  }
  const result = value as unknown as DataStatus
  const comparable = result.regions.every(region => region.reachable && region.ready && region.generation)
  const equal = result.regions[0].generation === result.regions[1].generation && result.regions[0].models === result.regions[1].models
  if (result.alignment !== 'unknown' && (!comparable || (result.alignment === 'aligned') !== equal)) throw invalid()
  return result
}

async function fetchStatus(signal: AbortSignal): Promise<DataStatus> {
  const response = await fetch('/api/status', { signal, cache: 'no-store' })
  if (!response.ok) throw new Error(`Status check failed (HTTP ${response.status}). This does not prove either search machine is down.`)
  if (!response.body) throw new Error('Status response was empty.')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 32768) throw new Error('Status response exceeds the expected size.')
      chunks.push(value)
    }
  } catch (error) { await reader.cancel(); throw error }
  finally { reader.releaseLock() }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length }
  let value: unknown
  try { value = JSON.parse(new TextDecoder().decode(body)) } catch { throw new Error('The status service returned invalid JSON.') }
  return parseDataStatus(value)
}
const shownDate = (value: string | null) => value ? new Date(value).toLocaleString() : 'Unknown'
const yesNo = (value: boolean | null, yes: string, no: string) => value === null ? 'Unknown' : value ? yes : no

export default function StatusPage() {
  const [data, setData] = useState<DataStatus | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  async function refresh() {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setError(''); setData(null)
    const timer = window.setTimeout(() => controller.abort(), 15000)
    try {
      const result = await fetchStatus(controller.signal)
      if (request.current === controller && !controller.signal.aborted) setData(result)
    } catch (failure) {
      if (request.current === controller) setError(controller.signal.aborted ? 'Status check timed out. No current status can be confirmed; try again.' : failure instanceof Error ? failure.message : 'Status check failed. Try again.')
    } finally {
      window.clearTimeout(timer)
      if (request.current === controller) setBusy(false)
    }
  }
  useEffect(() => { void refresh(); return () => { request.current?.abort(); request.current = null } }, [])
  return <main className="status-page">
    <header className="status-intro"><span>DATA TRANSPARENCY</span><h1>What is up to date?</h1><p>Check the model-name lists used by search. Matching copies mean the two regions share a published list—not that every Hugging Face model is present.</p><button onClick={() => void refresh()} disabled={busy}>{busy ? 'Checking…' : 'Refresh status'}</button></header>
    {busy && <p role="status">Checking both regional search routes…</p>}
    {error && <p role="alert" className="status-warning">{error}</p>}
    {data && <>
      <section className="status-alignment" aria-label="Regional agreement"><h2>{data.alignment === 'aligned' ? 'Both regions share the same list' : data.alignment === 'different' ? 'Regional lists currently differ' : 'Regional agreement is unknown'}</h2><p>{data.alignment === 'different' ? 'An update may still be transferring or loading. A difference alone does not identify the cause.' : data.alignment === 'unknown' ? 'At least one route or list could not be compared. An unreachable route is not proof that its machine has stopped.' : 'The published generation and model count match at this check.'}</p><small>Checked {shownDate(data.checkedAt)} · times shown in your local time zone · refresh is manual</small></section>
      <div className="status-regions">{data.regions.map(region => <section className="status-region" key={region.id} aria-label={region.label}>
        <h2>{region.label}</h2><p className={region.reachable && region.ready ? 'status-good' : 'status-warning'}>{!region.reachable ? 'Search route could not be reached' : yesNo(region.ready, 'Search list ready', 'Search list not ready')}</p>
        {region.error && <p className="status-warning">{region.error}</p>}
        <div className="status-count">{region.models === null ? 'Unknown' : region.models.toLocaleString()}<small>model names</small></div>
        <dl><div><dt>List updated</dt><dd>{shownDate(region.updatedAt)}</dd></div><div><dt>Update age</dt><dd>{yesNo(region.stale, 'Older than 8 hours', 'Within 8 hours')}</dd></div><div><dt>Synchronization</dt><dd>{yesNo(region.syncHealthy, 'Latest check healthy', 'Needs attention')}</dd></div><div><dt>Latest successful synchronization</dt><dd>{shownDate(region.lastSyncAt)}</dd></div><div><dt>Initial backfill finished</dt><dd>{yesNo(region.initialBackfillComplete, 'Yes — not a live completeness guarantee', 'Not yet confirmed complete')}</dd></div><div><dt>Last complete backfill</dt><dd>{shownDate(region.lastFullBackfillAt)}</dd></div></dl>
        <details><summary>Published list identifier</summary><code>{region.generation ?? 'Unknown'}</code></details>
      </section>)}</div>
      <section className="status-explanation"><h2>Coverage has limits</h2><p>{data.coverageNote}</p><p>The eight-hour age marker is an attention threshold, not an update-time promise. A completed backfill is a historical crawl result, not proof of zero missing, renamed, deleted, or newly public models today.</p></section>
    </>}
    <section className="status-explanation"><h2>Three different update clocks</h2><ul><li><strong>Search names:</strong> the regional lists above contain model names and ranking facts, not downloaded model weights.</li><li><strong>Model details:</strong> architecture and artifact information load separately through the model service and its cache. Search freshness does not establish detail freshness.</li><li><strong>Documentation:</strong> guides are reviewed and published separately. They do not automatically change when a model repository changes.</li></ul><a href="/start">Back to the platform</a></section>
  </main>
}
