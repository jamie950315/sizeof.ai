import { useEffect, useState, type CSSProperties } from 'react'
import { translate } from '../i18n/core'
import { deploymentSearch } from './deployment'
import { downloadRuns, mergeRuns, rawRuns, readRuns, removeRun, runByteLimit, runLimit, runStorageKey, parseRuns, writeRuns, type DeploymentRun, type RunOutcome } from './run-history'
import './keep.css'
import './run-history.css'
import RunComparison from './RunComparison'

const outcomeLabels: Record<RunOutcome, string> = { planned: 'Planned', succeeded: 'Succeeded', failed: 'Failed' }

function stamp(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? [date.toLocaleDateString(), date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })] : [value, '']
}

export default function RunHistoryPage() {
  const [items, setItems] = useState<DeploymentRun[]>([]), [error, setError] = useState(''), [readable, setReadable] = useState(false)
  const [query, setQuery] = useState(''), [outcome, setOutcome] = useState('all'), [removed, setRemoved] = useState<DeploymentRun>(), [notice, setNotice] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  function refresh() { try { const rows = readRuns(); setItems(rows); setSelected(ids => ids.filter(id => rows.some(row => row.id === id))); setReadable(true); setError('') } catch { setReadable(false); setError('Could not read deployment records. Storage is blocked or the saved data is invalid. Existing data has not been changed.') } }
  useEffect(() => { refresh(); const listener = (event: StorageEvent) => { if (event.key === runStorageKey || event.key === null) refresh() }; window.addEventListener('storage', listener); return () => window.removeEventListener('storage', listener) }, [])
  function fail(reason: unknown) { setError(reason instanceof Error ? reason.message : 'Browser storage is unavailable. Changes were not saved.') }
  const visible = items.filter(row => (outcome === 'all' || row.outcome === outcome) && `${row.input.model} ${row.notes} ${row.hardwareLabel} ${row.runtimeVersion} ${row.firstError}`.toLowerCase().includes(query.toLowerCase()))
  const left = items.find(row => row.id === selected[0]), right = items.find(row => row.id === selected[1])
  const fill = { '--fill': Math.min(1, items.length / runLimit) } as CSSProperties

  return <main className="page run-history">
    <header className="page-head">
      <h1>Deployment records</h1>
      <p className="lede">Keep the settings that worked—and the first error when they did not. These are user-reported observations, not verified benchmarks. Nothing here is uploaded. Export a backup before clearing browser data.</p>
    </header>

    <div className="keep-messages">
      {error && <p className="callout callout-error" role="alert">{translate(error)}</p>}
      {notice && <p className="keep-status" role="status">{translate(notice)}</p>}
      {!readable && <div className="keep-recovery">
        <button type="button" className="keep-quiet" onClick={() => { try { downloadRuns(rawRuns()) } catch (reason) { fail(reason) } }}>Download recovery copy</button>
        <button type="button" className="keep-danger keep-danger-solid" onClick={() => { if (!window.confirm('Reset unreadable deployment records? Download a recovery copy first. This replaces the stored records with an empty collection.')) return; try { setItems(writeRuns([])); setReadable(true); setError(''); setNotice('Deployment records reset.') } catch (reason) { fail(reason) } }}>Reset unreadable records</button>
      </div>}
    </div>

    <section className="run-intake">
      <a className="btn btn-primary" href="/deploy">Prepare a deployment</a>
      <div className="run-store">
        <span className="keep-count" style={fill}>{items.length} / 100 records</span>
        <div className="keep-backup">
          <button type="button" className="keep-quiet" disabled={!readable} onClick={() => { try { downloadRuns(JSON.stringify({ version: 3, items: readRuns() })) } catch (reason) { fail(reason) } }}>Export records</button>
          <label className="keep-file">Import records<input type="file" accept="application/json,.json" aria-label="Import deployment records" disabled={!readable} onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; try { if (file.size > runByteLimit) throw new Error('Backup must be smaller than 2 MB.'); const body = await file.text(); if (new TextEncoder().encode(body).length > runByteLimit) throw new Error('Backup exceeds 2 MB.'); setItems(mergeRuns(parseRuns(JSON.parse(body)))); setError(''); setNotice('Records merged. Existing records were preserved; conflicting versions were kept separately.') } catch (reason) { fail(reason) } }} /></label>
        </div>
      </div>
    </section>

    <section className="run-log">
      <div className="run-filters">
        <label className="field run-search"><span>Find a record</span><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Model, hardware, version or notes" /></label>
        <label className="field"><span>Filter outcome</span><select value={outcome} onChange={e => setOutcome(e.target.value)}><option value="all">All outcomes</option><option value="planned">Planned</option><option value="succeeded">Succeeded</option><option value="failed">Failed</option></select></label>
      </div>
      <p className="note run-select-hint">Select two records to compare their settings. The first selection is the baseline; selections remain when filtering. {selected.length > 0 && <button type="button" className="keep-quiet" onClick={() => setSelected([])}>Clear comparison</button>}</p>

      {readable && left && right && <RunComparison key={`${left.id}:${right.id}`} left={left} right={right} />}

      {removed && <p className="keep-status" role="status">Removed {removed.input.model}. <button type="button" disabled={!readable} onClick={() => { try { setItems(mergeRuns([removed])); setRemoved(undefined); setError('') } catch (reason) { fail(reason) } }}>Undo removal</button></p>}

      {readable && visible.length === 0 && <section className="keep-empty"><h2>{items.length ? 'No matching records' : 'Your next successful setup starts here'}</h2><p>Save a configuration from the deployment workbench, then keep another snapshot after your real test.</p><a href="/deploy">Prepare a deployment</a></section>}

      {readable && visible.length > 0 && <ol className="run-ledger">{[...visible].sort((a, b) => b.savedAt.localeCompare(a.savedAt)).map(row => {
        const [day, time] = stamp(row.savedAt)
        return <li className={`run-entry run-${row.outcome}`} key={row.id}>
          <label className="run-pick"><input type="checkbox" aria-label={`Compare record ${row.id}`} checked={selected.includes(row.id)} disabled={selected.length >= 2 && !selected.includes(row.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, row.id] : ids.filter(id => id !== row.id))} /><span>Compare</span>{selected.includes(row.id) && <b className="run-pick-slot" aria-hidden="true">{String.fromCharCode(65 + selected.indexOf(row.id))}</b>}</label>
          <time className="run-time" dateTime={row.savedAt}><span>{day}</span><span>{time}</span></time>
          <div className="run-body">
            <div className="run-heading">
              <h2><a href={`/${row.input.model}`}>{row.input.model}</a></h2>
              <span className="run-outcome">{translate(outcomeLabels[row.outcome])} · user reported</span>
            </div>
            <dl className="run-facts">
              <div><dt>Runtime</dt><dd>{row.input.engine} · {row.runtimeVersion || 'Version not recorded'}</dd></div>
              <div><dt>Hardware</dt><dd>{row.hardwareLabel || `${row.input.os} / ${row.input.hardware}`}</dd></div>
              <div><dt>Context / port</dt><dd>{row.input.context} tokens / {row.input.port}</dd></div>
              <div><dt>Model file</dt><dd>{row.input.file || 'Repository managed by runtime'}</dd></div>
            </dl>
            {row.artifact && <details className="disclosure run-artifact"><summary>Saved artifact facts</summary><ul className="run-artifact-facts"><li>Source model: {row.artifact.sourceModelId}</li><li>Revision: <code>{row.artifact.revision}</code></li><li>{(row.artifact.sizeBytes / 1024 ** 3).toFixed(2)} GiB · checked {new Date(row.artifact.checkedAt).toLocaleString()}</li></ul></details>}
            {row.notes && <p className="run-note">{row.notes}</p>}
            {row.firstError && <div className="run-error"><strong>First error summary</strong><p>{row.firstError}</p></div>}
            <p className="run-caveat">Requested model commit: <code>{row.input.revision || translate('Default branch (not pinned)')}</code>. Runtime version is user-recorded, not installed or fixed by this site.</p>
            <p className="run-caveat">Reopening regenerates commands using the current templates. Installed tools and unpinned upstream files can change; review the new plan before running anything.</p>
            <div className="keep-links run-links">
              <a href={`/deploy?${deploymentSearch(row.input)}`}>Reopen configuration</a>
              <a href={`/benchmarks?run=${encodeURIComponent(row.id)}`}>Record a measurement</a>
              <a href="/troubleshoot">Troubleshoot a failure</a>
              {(row.input.revision || row.artifact?.revision) && <a href={`/model-changes?model=${encodeURIComponent(row.input.model)}&before=${row.input.revision || row.artifact?.revision}`}>Check changes since this revision</a>}
            </div>
          </div>
          <button type="button" className="keep-danger run-remove" aria-label={`Remove record ${row.id}`} onClick={() => { try { const next = removeRun(row.id); setItems(next.items); setSelected(ids => ids.filter(id => id !== row.id)); setRemoved(next.removed); setError('') } catch (reason) { fail(reason) } }}>Remove</button>
        </li>
      })}</ol>}
    </section>
  </main>
}
