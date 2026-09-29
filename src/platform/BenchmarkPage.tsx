import { useEffect, useId, useState, type CSSProperties } from 'react'
import { formatMessage, translate } from '../i18n/core'
import { readRuns } from './run-history'
import { benchmarkByteLimit, benchmarkStorageKey, decodeSpeed, downloadBenchmarks, mergeBenchmarks, parseBenchmark, parseBenchmarks, rawBenchmarks, readBenchmarks, summarizeBenchmarks, writeBenchmarks, type BenchmarkRow } from './benchmark'
import './keep.css'
import './benchmark.css'
import BenchmarkImportPanel from './BenchmarkImportPanel'

const initial = { modelId: '', runtime: 'llama.cpp', runtimeVersion: '', device: '', quantization: '', modelRevision: '', context: '4096', concurrency: '1', loadState: 'warm', workload: '', outcome: 'success', promptTokens: '', ttftMs: '', decodeTokens: '', decodeSeconds: '', totalSeconds: '', peakGiB: '' }
const numeric = ['context', 'concurrency', 'promptTokens', 'ttftMs', 'decodeTokens', 'decodeSeconds', 'totalSeconds', 'peakGiB'] as const
const labels: Partial<Record<keyof typeof initial, string>> = { modelId: 'Model ID', runtime: 'Runtime', runtimeVersion: 'Runtime version', device: 'Hardware and driver / OS', quantization: 'Quantization / exact file', modelRevision: 'Model revision (optional)', workload: 'Workload / prompt set / settings', context: 'Context tokens', concurrency: 'Concurrent requests', promptTokens: 'Actual prompt tokens', ttftMs: 'First token (ms)', decodeTokens: 'Tokens in decode interval', decodeSeconds: 'Decode time (seconds)', totalSeconds: 'Total time (seconds)', peakGiB: 'Peak memory (GiB)' }
const fmt = (n: number | null) => n === null ? translate('Not measured') : n.toLocaleString(undefined, { maximumFractionDigits: 2 })
const rawColumns = ['promptTokens', 'ttftMs', 'decodeTokens', 'decodeSeconds', 'totalSeconds', 'peakGiB'] as const
export default function BenchmarkPage() {
  const rawHeading = useId()
  const [rows, setRows] = useState<BenchmarkRow[]>([]), [form, setForm] = useState(initial), [error, setError] = useState(''), [notice, setNotice] = useState(''), [readable, setReadable] = useState(false), [query, setQuery] = useState(''), [outcome, setOutcome] = useState('all'), [removed, setRemoved] = useState<BenchmarkRow>()
  function fail(reason: unknown) { setNotice(''); setError(reason instanceof Error ? reason.message : 'Measurements could not be saved. Existing data was preserved.') }
  function refresh() { try { setRows(readBenchmarks()); setReadable(true); setError('') } catch (reason) { setReadable(false); fail(reason) } }
  useEffect(() => {
    refresh()
    const runId = new URLSearchParams(window.location.search).get('run')
    if (runId) { try { const run = readRuns().find(r => r.id === runId); if (!run) throw new Error('The deployment record is not available in this browser. Enter the setup manually.'); setForm(f => ({ ...f, modelId: run.input.model, runtime: run.input.engine, runtimeVersion: run.runtimeVersion, device: run.hardwareLabel || `${run.input.os} / ${run.input.hardware}`, quantization: run.input.file, context: run.input.context, modelRevision: run.input.revision ?? '' })); setNotice('Setup copied from a local record, not measured independently. Confirm the model revision actually used; an observed repository revision is not proof of the file you ran. Enter your real measurements below.') } catch (reason) { fail(reason) } }
    const listener = (e: StorageEvent) => { if (e.key === benchmarkStorageKey || e.key === null) refresh() }; window.addEventListener('storage', listener); return () => window.removeEventListener('storage', listener)
  }, [])
  const visible = rows.filter(r => (outcome === 'all' || r.outcome === outcome) && `${r.modelId} ${r.device} ${r.runtime} ${r.workload}`.toLowerCase().includes(query.toLowerCase()))
  const groups = summarizeBenchmarks(visible)
  const fill = { '--fill': Math.min(1, rows.length / 200) } as CSSProperties
  return <main className="page benchmark-page">
    <header className="page-head">
      <h1>Measurement notebook</h1>
      <p className="lede">What actually happened on your hardware? Keep measured results separate from estimates. These observations are user-reported, not independently verified. Nothing is uploaded or automatically measured.</p>
    </header>
    <div className="keep-messages">
      {error && <p className="callout callout-error" role="alert">{translate(error)} Existing measurements have not been replaced.</p>}
      {notice && <p className="keep-status" role="status">{translate(notice)}</p>}
      {!readable && <section className="keep-recovery"><button type="button" className="keep-quiet" onClick={() => { try { downloadBenchmarks(rawBenchmarks()) } catch (reason) { fail(reason) } }}>Download recovery copy</button><button type="button" className="keep-danger keep-danger-solid" onClick={() => { if (!window.confirm('Replace unreadable measurements with an empty notebook? Download a recovery copy first.')) return; try { setRows(writeBenchmarks([])); setReadable(true); setError('') } catch (reason) { fail(reason) } }}>Reset unreadable notebook</button></section>}
    </div>

    <div className="benchmark-layout">
      <section className="benchmark-form-panel">
        <header className="benchmark-panel-head"><h2>Record one attempt</h2><p>Use the same workload label only for identical prompts, output limits, sampling settings, and measurement method. This label is your own declaration, not an independently verified match. Cold means a fresh model load; warm means already loaded.</p></header>
        <form onSubmit={e => { e.preventDefault(); try { const candidate = { ...form, id: crypto.randomUUID(), date: new Date().toISOString(), ...Object.fromEntries(numeric.map(k => [k, form[k].trim() ? Number(form[k]) : null])) }; setRows(mergeBenchmarks([parseBenchmark(candidate)])); setError(''); setNotice('Measurement saved locally. Export a backup before clearing browser data.'); setForm(f => ({ ...f, promptTokens: '', ttftMs: '', decodeTokens: '', decodeSeconds: '', totalSeconds: '', peakGiB: '' })) } catch (reason) { fail(reason) } }}>
          <fieldset disabled={!readable}><legend>Setup and workload</legend><div className="benchmark-fields">{(['modelId', 'runtime', 'runtimeVersion', 'device', 'quantization', 'modelRevision', 'workload', 'context', 'concurrency'] as const).map(key => <label key={key} className="field" data-wide={key === 'workload' || undefined}><span>{translate(labels[key] ?? '')}</span><input value={form[key]} required={!['runtimeVersion', 'modelRevision'].includes(key)} maxLength={key === 'workload' ? 240 : key === 'modelId' ? 193 : key === 'modelRevision' ? 40 : 160} type={numeric.includes(key as typeof numeric[number]) ? 'number' : 'text'} min="1" step="1" onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} /></label>)}<label className="field"><span>Load state</span><select value={form.loadState} onChange={e => setForm(f => ({ ...f, loadState: e.target.value }))}><option value="warm">Warm / already loaded</option><option value="cold">Cold / fresh load</option></select></label><label className="field"><span>Attempt outcome</span><select value={form.outcome} onChange={e => setForm(f => ({ ...f, outcome: e.target.value }))}><option value="success">Success</option><option value="error">Error / failed attempt</option></select></label></div></fieldset>
          <fieldset disabled={!readable}><legend>Measured values · blanks mean unknown</legend><p className="benchmark-help">Use actual runtime token counts, not configured context capacity or text length. Decode time excludes prompt processing and first-token wait. Count only the tokens generated during that same interval: when timing first-to-last token, exclude the first token from the count. Matching runtime counters are also suitable. Do not substitute total request time. Limits: 100M tokens, 86,400 seconds, 86.4M ms, 1M GiB.</p><div className="benchmark-fields benchmark-measures">{(['promptTokens', 'ttftMs', 'decodeTokens', 'decodeSeconds', 'totalSeconds', 'peakGiB'] as const).map(key => <label key={key} className="field"><span>{translate(labels[key] ?? '')}</span><input type="number" min={(key === 'ttftMs' || key === 'promptTokens') ? '0' : key === 'decodeTokens' ? '1' : '0.000001'} step={(key === 'decodeTokens' || key === 'promptTokens') ? '1' : 'any'} value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} /></label>)}</div><p className="benchmark-help">Failed attempts remain in the error rate, but never contribute speed or successful-run summaries.</p><button className="btn btn-tape benchmark-save" type="submit">Save measurement</button></fieldset>
        </form>
      </section>

      <section className="benchmark-results">
        <header className="benchmark-results-head"><h2>Your evidence</h2><span className="keep-count" style={fill}>{rows.length} / 200 attempts · this browser only</span></header>
        <div className="keep-backup"><button type="button" className="keep-quiet" disabled={!readable} onClick={() => { try { downloadBenchmarks(JSON.stringify({ version: 1, items: readBenchmarks() })) } catch (reason) { fail(reason) } }}>Export measurements</button><label className="keep-file">Import measurements<input type="file" accept="application/json,.json" disabled={!readable} onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; try { if (file.size > benchmarkByteLimit) throw new Error('Backup exceeds 2 MB.'); const body = await file.text(); if (new TextEncoder().encode(body).length > benchmarkByteLimit) throw new Error('Backup exceeds 2 MB.'); setRows(mergeBenchmarks(parseBenchmarks(JSON.parse(body)))); setError(''); setNotice('Measurements merged. Conflicting records kept separately.') } catch (reason) { fail(reason) } }} /></label></div>
        <BenchmarkImportPanel disabled={!readable} onSaved={updated => { setRows(updated); setError(''); setNotice('Tool results saved locally. Their source format appears in each workload label.') }} />
        <div className="benchmark-filters"><label className="field"><span>Find measurements</span><input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label><label className="field"><span>Outcome filter</span><select value={outcome} onChange={e => setOutcome(e.target.value)}><option value="all">All attempts</option><option value="success">Success</option><option value="error">Error</option></select></label></div>
        <div className="benchmark-notes">
          <p>Summaries reflect the filters above. Only matching recorded settings are grouped; actual test conditions are not independently verified. Missing model revision, runtime version, or actual prompt tokens keeps attempts separate. Older backups without prompt counts import as unknown, never as context capacity. No percentile claims are made from these small, manually entered samples.</p>
          <p>Backups contain every recorded field, including hardware and workload labels. Review before sharing; do not enter credentials or private prompt content.</p>
        </div>
        {removed && <p className="keep-status" role="status">Measurement removed. <button type="button" disabled={!readable} onClick={() => { try { setRows(mergeBenchmarks([removed])); setRemoved(undefined); setError('') } catch (reason) { fail(reason) } }}>Undo removal</button></p>}
        {readable && !visible.length && <div className="keep-empty"><p>No measurements yet for this view. Record an attempt to start collecting evidence.</p></div>}
        {readable && groups.map(group => <article className="benchmark-group" key={group.key}>
          <header><h3>{group.sample.modelId}</h3><p>{group.sample.runtime} {group.sample.runtimeVersion || '(version unknown)'} · {group.sample.device}</p></header>
          <p className="benchmark-group-meta">{group.sample.quantization} · {group.sample.context.toLocaleString()} context · {fmt(group.sample.promptTokens)} prompt tokens · {group.sample.concurrency} concurrent · {group.sample.loadState}</p>
          <p className="benchmark-group-workload">{group.sample.workload}</p>
          <p className="benchmark-revision">{group.sample.modelRevision ? formatMessage('Revision: {0}', [group.sample.modelRevision]) : translate('Revision: not recorded; isolated sample')}</p>
          <dl className="benchmark-readout"><div><dt>Median decode</dt><dd>{fmt(group.speed)}{group.speed !== null && ' tok/s'}<small>{group.speedSamples} measured samples</small></dd></div><div><dt>Median first token</dt><dd>{fmt(group.ttft)}{group.ttft !== null && ' ms'}<small>{group.ttftSamples} measured samples</small></dd></div><div><dt>Median peak memory</dt><dd>{fmt(group.peak)}{group.peak !== null && ' GiB'}<small>{group.peakSamples} measured samples</small></dd></div><div data-errors={group.failures > 0 || undefined}><dt>Error rate</dt><dd>{fmt(group.errorRate * 100)}%<small>{group.failures} / {group.count} attempts</small></dd></div></dl>
        </article>)}
        {readable && visible.length > 0 && <details className="disclosure benchmark-raw"><summary id={rawHeading}>All raw attempts ({visible.length})</summary>
          <div className="benchmark-table" role="region" aria-labelledby={rawHeading} tabIndex={0}><table>
            <thead><tr><th scope="col">Recorded</th><th scope="col">Model</th><th scope="col">Attempt outcome</th><th scope="col">Decode speed (tok/s)</th>{rawColumns.map(key => <th scope="col" key={key}>{translate(labels[key] ?? '')}</th>)}<th scope="col"><span className="visually-hidden">Remove</span></th></tr></thead>
            <tbody>{[...visible].reverse().map(row => <tr key={row.id} data-outcome={row.outcome}>
              <td><time dateTime={row.date}>{new Date(row.date).toLocaleString()}</time></td>
              <th scope="row">{row.modelId}</th>
              <td>{translate(row.outcome === 'success' ? 'Success' : 'Error')}</td>
              <td>{fmt(decodeSpeed(row))}</td>
              {rawColumns.map(key => <td key={key}>{fmt(row[key])}</td>)}
              <td><button type="button" className="keep-danger" aria-label={`Remove measurement ${row.id}`} onClick={() => { try { const latest = readBenchmarks(); setRows(writeBenchmarks(latest.filter(r => r.id !== row.id))); setRemoved(latest.find(r => r.id === row.id)); setError('') } catch (reason) { fail(reason) } }}>Remove</button></td>
            </tr>)}</tbody>
          </table></div>
        </details>}
      </section>
    </div>
  </main>
}
