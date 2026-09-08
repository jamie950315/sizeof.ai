import { useRef, useState } from 'react'
import { benchmarkByteLimit, mergeBenchmarks, type BenchmarkRow } from './benchmark'
import { benchmarkImportSource, llamaBenchImportSource, materializeBenchmarkImport, parseBenchmarkResult, type BenchmarkImportPreview } from './benchmark-import'

const emptySetup = { modelId: '', runtimeVersion: '', modelRevision: '', device: '', quantization: '', context: '', concurrency: '', loadState: '', workload: '', date: '' }
const labels: Record<keyof typeof emptySetup, string> = { modelId: 'Imported model ID', runtimeVersion: 'Imported runtime version (optional)', modelRevision: 'Imported model revision (optional)', device: 'Imported hardware / driver / OS', quantization: 'Imported quantization / exact file', context: 'Imported context capacity', concurrency: 'Imported concurrency', loadState: 'Imported load state', workload: 'Imported workload / settings', date: 'Measurement date (ISO 8601 with timezone)' }

export default function BenchmarkImportPanel({ disabled, onSaved }: { disabled: boolean; onSaved: (rows: BenchmarkRow[]) => void }) {
  const [preview, setPreview] = useState<BenchmarkImportPreview>(), [setup, setSetup] = useState(emptySetup), [error, setError] = useState(''), [notice, setNotice] = useState(''), [confirmed, setConfirmed] = useState(false), [loading, setLoading] = useState(false)
  const selection = useRef(0)
  return <details className="benchmark-group" id="tool-result-import"><summary>Import benchmark tool results</summary><p>Read raw vLLM detailed JSON or one llama-bench generation-only JSON test. Files stay in this browser; nothing is uploaded or executed. Maximum 2 MB and 200 observations, including existing notebook capacity.</p>
    <p><a href={benchmarkImportSource} target="_blank" rel="noreferrer">vLLM field definitions</a> · <a href={llamaBenchImportSource} target="_blank" rel="noreferrer">llama-bench field definitions</a> · Schema reviewed 2026-09-08. Other versions may be rejected.</p>
    <p>vLLM: use <code>--save-result --save-detailed</code>. llama-bench: one generation configuration with <code>-p 0 -d 0 -o json</code>. Summary averages, console logs, prefill/mixed tests and JSONL are not accepted.</p>
    <label>Benchmark tool JSON<input type="file" accept="application/json,.json" disabled={disabled} onChange={async e => {
      const file = e.target.files?.[0]; e.target.value = ''; const token = ++selection.current
      setPreview(undefined); setConfirmed(false); setError(''); setNotice(''); setLoading(false)
      if (!file) return
      setLoading(true)
      try { if (file.size > benchmarkByteLimit) throw new Error('Result file exceeds 2 MB.'); const result = parseBenchmarkResult(await file.text()); if (token === selection.current) setPreview(result) }
      catch (reason) { if (token === selection.current) setError(reason instanceof Error ? reason.message : 'Result could not be read.') }
      finally { if (token === selection.current) setLoading(false) }
    }} /></label>
    {loading && <p role="status">Reading local result…</p>}{error && <p role="alert" className="platform-alert">{error} Nothing was imported.</p>}{notice && <p role="status">{notice}</p>}
    {preview && <><h3>Preview · {preview.format}</h3><p>{preview.samples.length} observations · {preview.samples.filter(s => s.outcome === 'error').length} reported failures · {preview.samples.filter(s => s.decodeSeconds !== null).length} decode intervals. Missing measurements remain unknown.</p><ul>{preview.warnings.map(w => <li key={w}>{w}</li>)}</ul>
      <details><summary>Inspect parsed observations</summary><ol>{preview.samples.map((s, i) => <li key={i}>{s.outcome} · prompt {s.promptTokens ?? 'unknown'} · first token {s.ttftMs ?? 'unknown'} ms · decode {s.decodeTokens ?? 'unknown'} tokens / {s.decodeSeconds ?? 'unknown'} s · total {s.totalSeconds ?? 'unknown'} s</li>)}</ol></details>
      <form onSubmit={e => { e.preventDefault(); if (!confirmed || disabled) return; try {
        if (!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(setup.date)) throw new Error('Enter the actual measurement date with a timezone, for example 2026-09-08T10:30:00+08:00.')
        if (setup.loadState !== 'cold' && setup.loadState !== 'warm') throw new Error('Confirm whether the model was cold or warm.')
        const rows = materializeBenchmarkImport(preview, { ...setup, loadState: setup.loadState, context: Number(setup.context), concurrency: Number(setup.concurrency) })
        onSaved(mergeBenchmarks(rows)); setPreview(undefined); setConfirmed(false); setError(''); setNotice(`${rows.length} observations merged locally. Existing records were preserved. Export a backup before clearing browser data.`)
      } catch (reason) { setError(reason instanceof Error ? reason.message : 'Import could not be saved.'); setNotice('') } }}>
        <fieldset disabled={disabled}><legend>Confirm the setup actually measured</legend><p>Do not substitute the settings you planned to run. Leave unknown runtime/model versions blank; all other setup fields are required. Distinct imports remain separate because their conditions cannot be independently verified.</p><div className="benchmark-fields">{(Object.keys(emptySetup) as (keyof typeof emptySetup)[]).map(key => <label key={key}>{labels[key]}{key === 'loadState' ? <select required value={setup[key]} onChange={e => { setSetup(s => ({ ...s, [key]: e.target.value })); setConfirmed(false) }}><option value="">Select actual load state</option><option value="cold">Cold / fresh model load</option><option value="warm">Warm / already loaded</option></select> : <input required={key !== 'runtimeVersion' && key !== 'modelRevision'} value={setup[key]} maxLength={key === 'workload' ? 170 : key === 'modelId' ? 193 : key === 'runtimeVersion' ? 120 : key === 'modelRevision' || key === 'date' ? 40 : 160} type={key === 'context' || key === 'concurrency' ? 'number' : 'text'} min="1" step="1" onChange={e => { setSetup(s => ({ ...s, [key]: e.target.value })); setConfirmed(false) }} />}</label>)}</div>
        <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I confirmed the actual setup, measurement date and format limitations above. For vLLM, these are streaming text results using its output-minus-one timing convention.</label><button type="submit" disabled={!confirmed} className="platform-primary">Import confirmed observations</button></fieldset>
      </form></>}
  </details>
}
