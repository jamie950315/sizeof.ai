import { useState } from 'react'
import { type DeploymentInput } from './deployment'
import { createRun, mergeRuns, type RunArtifact, type RunOutcome } from './run-history'
import './run-history.css'

export default function SaveRunForm({ input, artifact }: { input: DeploymentInput; artifact?: RunArtifact }) {
  const [runtimeVersion, setRuntime] = useState(''), [hardwareLabel, setHardware] = useState('')
  const [outcome, setOutcome] = useState<RunOutcome>('planned'), [notes, setNotes] = useState(''), [firstError, setFirstError] = useState('')
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  return <section className="run-save"><h2>Save a deployment record</h2><p>Keep this configuration and your observations on this browser only. Outcomes are your reports, not independent verification. Never paste API keys, passwords, or private logs.</p>
    <form onSubmit={e => { e.preventDefault(); setNotice(''); try { mergeRuns([createRun(input, { runtimeVersion, hardwareLabel, outcome, notes, firstError }, artifact)]); setError(''); setNotice('Snapshot saved on this browser. Export a backup from deployment records.') } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save record.'); } }}>
      <div className="run-fields"><label>Runtime version<input value={runtimeVersion} onChange={e => setRuntime(e.target.value)} maxLength={120} placeholder="Version reported by your installed tool" /></label><label>Hardware label<input value={hardwareLabel} onChange={e => setHardware(e.target.value)} maxLength={160} placeholder="My laptop · 32 GB" /></label><label>Reported outcome<select value={outcome} onChange={e => setOutcome(e.target.value as RunOutcome)}><option value="planned">Planned / not tested</option><option value="succeeded">Succeeded on my machine</option><option value="failed">Failed on my machine</option></select></label></div>
      <label>Deployment notes<textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={3000} /></label><label>First error summary (optional)<textarea value={firstError} onChange={e => setFirstError(e.target.value)} maxLength={2000} placeholder="Summarize the first failure without secrets or full logs." /></label>
      {error && <p className="platform-alert" role="alert">{error} Existing records were not replaced. <a href="/runs">Open records for recovery or backup.</a></p>}{notice && <p role="status">{notice}</p>}
      <div className="platform-actions"><button className="platform-primary">Save configuration snapshot</button><a href="/runs">My deployment records →</a></div>
    </form>
  </section>
}
