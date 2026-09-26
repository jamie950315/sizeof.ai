import { useState } from 'react'
import { translate } from '../i18n/core'
import { type DeploymentInput } from './deployment'
import { createRun, mergeRuns, type RunArtifact, type RunOutcome } from './run-history'
import './run-history.css'

export default function SaveRunForm({ input, artifact }: { input: DeploymentInput; artifact?: RunArtifact }) {
  const [runtimeVersion, setRuntime] = useState(''), [hardwareLabel, setHardware] = useState('')
  const [outcome, setOutcome] = useState<RunOutcome>('planned'), [notes, setNotes] = useState(''), [firstError, setFirstError] = useState('')
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  return <section className="run-save">
    <header className="run-save-head"><h2>Save a deployment record</h2><p>Keep this configuration and your observations on this browser only. Outcomes are your reports, not independent verification. Never paste API keys, passwords, or private logs.</p></header>
    <form onSubmit={e => { e.preventDefault(); setNotice(''); try { mergeRuns([createRun(input, { runtimeVersion, hardwareLabel, outcome, notes, firstError }, artifact)]); setError(''); setNotice('Snapshot saved on this browser. Export a backup from deployment records.') } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save record.'); } }}>
      <div className="run-save-fields">
        <label className="field"><span>Runtime version</span><input value={runtimeVersion} onChange={e => setRuntime(e.target.value)} maxLength={120} placeholder="Version reported by your installed tool" /></label>
        <label className="field"><span>Hardware label</span><input value={hardwareLabel} onChange={e => setHardware(e.target.value)} maxLength={160} placeholder="My laptop · 32 GB" /></label>
        <label className="field"><span>Reported outcome</span><select value={outcome} onChange={e => setOutcome(e.target.value as RunOutcome)}><option value="planned">Planned / not tested</option><option value="succeeded">Succeeded on my machine</option><option value="failed">Failed on my machine</option></select></label>
      </div>
      <div className="run-save-notes">
        <label className="field"><span>Deployment notes</span><textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={3000} rows={3} /></label>
        <label className="field"><span>First error summary (optional)</span><textarea value={firstError} onChange={e => setFirstError(e.target.value)} maxLength={2000} rows={3} placeholder="Summarize the first failure without secrets or full logs." /></label>
      </div>
      {error && <p className="callout callout-error" role="alert">{translate(error)} Existing records were not replaced. <a href="/runs">Open records for recovery or backup.</a></p>}
      {notice && <p className="run-save-status" role="status">{translate(notice)}</p>}
      <div className="run-save-actions"><button className="btn btn-primary">Save configuration snapshot</button><a href="/runs">My deployment records</a></div>
    </form>
  </section>
}
