import { useState } from 'react'
import { DEFAULT_DIAGNOSTIC, diagnosticChecklist, diagnosticPath, diagnosticSearch, parseDiagnostic, PATHS, sanitizeDiagnosticNote, STAGES, SYSTEM_CHECKS, SYSTEMS, type DiagnosticSelection, type System } from './troubleshooting'
import { translate } from '../i18n/core'
import './troubleshooting.css'

export default function TroubleshootPage() {
  const [initial] = useState(() => {
    try { return { selection: parseDiagnostic(window.location.search), error: '' } }
    catch (error) { return { selection: DEFAULT_DIAGNOSTIC, error: error instanceof Error ? error.message : 'Invalid diagnostic link.' } }
  })
  const [selection, setSelection] = useState(initial.selection)
  const [error, setError] = useState(initial.error)
  const [answers, setAnswers] = useState<string[]>(['', ''])
  const [notes, setNotes] = useState('')
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null)
  const path = diagnosticPath(selection)
  const ready = answers.every(Boolean)
  function choose(next: DiagnosticSelection) { setSelection(next); setAnswers(['', '']); setFeedback(null) }
  async function copy(link: boolean) {
    try {
      await navigator.clipboard.writeText(link ? `${window.location.origin}/troubleshoot?${diagnosticSearch(selection)}` : diagnosticChecklist(selection))
      setFeedback({ error: false, text: link ? 'Guide link copied. Notes and evidence answers are excluded.' : 'Checklist copied. Notes and evidence answers are excluded.' })
    } catch { setFeedback({ error: true, text: 'Could not copy. Clipboard access is unavailable or denied; no success was recorded.' }) }
  }
  function download() {
    let url: string | undefined
    try {
      url = URL.createObjectURL(new Blob([diagnosticChecklist(selection)], { type: 'text/plain;charset=utf-8' }))
      const a = document.createElement('a'); a.href = url; a.download = 'sizeof-diagnostic-checklist.txt'; a.click()
      setFeedback({ error: false, text: 'Checklist download requested. Notes and evidence answers are excluded.' })
    } catch { setFeedback({ error: true, text: 'Could not export the checklist. Download creation failed.' }) }
    finally { if (url) { const old = url; window.setTimeout(() => URL.revokeObjectURL(old), 1000) } }
  }
  const stageIndex = STAGES.findIndex(([id]) => id === selection.stage)
  return <main className="page troubleshoot-page">
    <header className="page-head"><h1>Find the first failure.</h1><p className="lede">Start where the workflow stopped. Gather evidence, inspect one cause at a time, and keep your original model and settings visible.</p></header>
    {error ? <section role="alert" className="callout callout-error trouble-invalid"><p>{translate(error)} No diagnostic advice is shown for this invalid link.</p><button type="button" className="btn" onClick={() => { setError(''); choose({ ...DEFAULT_DIAGNOSTIC }); window.history.replaceState(null, '', '/troubleshoot') }}>Reset invalid link</button></section> : <>
      <aside className="trouble-boundary">This is a guided checklist, not an automatic diagnosis. Nothing runs on your computer, no logs are uploaded, and no AI service is called. Preserve the first error before retrying.</aside>
      <section className="trouble-locate" aria-labelledby="trouble-locate-title">
        <h2 id="trouble-locate-title">Locate the failure</h2>
        <p className="trouble-caption" id="trouble-stage-label">Failure stage</p>
        <div className="trouble-stages" role="group" aria-labelledby="trouble-stage-label">
          <ol>{STAGES.map(([id, title], index) => <li key={id} data-state={index < stageIndex ? 'passed' : index === stageIndex ? 'current' : 'ahead'}>
            <button type="button" aria-pressed={id === selection.stage} onClick={() => { if (id !== selection.stage) choose({ ...selection, stage: id, symptom: PATHS[id][0].id }) }}><span className="trouble-node" aria-hidden="true" /><span>{translate(title)}</span></button>
          </li>)}</ol>
        </div>
      </section>
      <div className="trouble-workspace">
        <div className="trouble-inputs">
          <fieldset className="trouble-symptoms">
            <legend className="trouble-caption">Symptom</legend>
            {PATHS[selection.stage].map(p => <label key={p.id} className="trouble-branch"><input type="radio" name="trouble-symptom" value={p.id} checked={selection.symptom === p.id} onChange={() => choose({ ...selection, symptom: p.id })} /><span>{translate(p.title)}</span></label>)}
          </fieldset>
          <div className="trouble-os">
            <p className="trouble-caption" id="trouble-os-label">Operating system</p>
            <div className="seg" role="group" aria-labelledby="trouble-os-label">{SYSTEMS.map(s => <button type="button" key={s} aria-pressed={selection.os === s} onClick={() => { if (selection.os !== s) choose({ ...selection, os: s as System }) }}>{s}</button>)}</div>
          </div>
          <section className="trouble-evidence" aria-label="Evidence questions">
            <h2>Inspect the evidence</h2>
            <p>“Unknown” is useful evidence too. These answers organize your investigation; they do not prove a cause.</p>
            <ol className="trouble-questions">{path.questions.map((q, i) => <li key={`${selection.stage}-${selection.symptom}-${i}`} data-answer={answers[i] || 'none'}>
              <label><span>{translate(q)}</span><select value={answers[i]} onChange={e => setAnswers(prev => prev.map((a, index) => index === i ? e.target.value : a))}><option value="">Choose an observation</option><option value="yes">Yes / confirmed</option><option value="no">No / not confirmed</option><option value="unknown">Unknown — needs checking</option></select></label>
            </li>)}</ol>
          </section>
          <div className="trouble-baseline"><strong>Keep your baseline.</strong><p>Record the model revision, selected files, engine version, device, context, and precision in your own deployment record. Do not change several variables to hide the original failure.</p><a href="/deploy">Open deployment workbench</a></div>
        </div>
        <div className={ready ? 'trouble-result' : 'trouble-result is-pending'} aria-live="polite">
          {ready ? <>
            <p className="trouble-result-kicker">Next safe check · not a verified fix</p>
            <h3>{translate(path.title)}</h3>
            <p className="trouble-check">{translate(path.check)}</p>
            {answers.includes('unknown') && <p className="trouble-flag">Some evidence is still unknown. Start with the unanswered checks before attempting a change.</p>}
            {answers.includes('no') && <p className="trouble-flag">At least one item is not confirmed. Verify that prerequisite before treating a suggested cause as likely.</p>}
            <dl className="trouble-sheet">
              <div><dt>Possible causes</dt><dd>{translate(path.causes)}</dd></div>
              <div><dt>On {selection.os}</dt><dd>{translate(SYSTEM_CHECKS[selection.os])}</dd></div>
            </dl>
            <div className="trouble-stop"><strong>When to stop</strong><p>{translate(path.stop)}</p></div>
            <a href={`/docs/${path.doc}`}>Read the related guide</a>
          </> : <>
            <h3>{translate(path.title)}</h3>
            <p className="trouble-pending">Answer both questions, including “Unknown” when needed, to reveal the next check.</p>
          </>}
        </div>
      </div>
      <section className="trouble-notes" aria-labelledby="trouble-notes-title">
        <h2 id="trouble-notes-title">Keep a private scratchpad</h2>
        <label className="field"><span>Private notes</span><textarea maxLength={4000} value={notes} onChange={e => setNotes(sanitizeDiagnosticNote(e.target.value))} placeholder="Keep the first error and observations. Do not enter credentials or private logs." /></label>
        <div className="trouble-notes-foot"><p>{notes.length}/4,000 characters · Memory only: lost on reload or leaving this page. Never included in links, copied checklists, or exports. This is not a secret detector or secure vault.</p><button type="button" className="btn btn-quiet" disabled={!notes} onClick={() => setNotes('')}>Clear private notes</button></div>
      </section>
      <footer className="trouble-actions">
        <div><button type="button" className="btn btn-primary" onClick={() => void copy(true)}>Copy guide link</button><button type="button" className="btn" onClick={() => void copy(false)}>Copy diagnostic checklist</button><button type="button" className="btn" onClick={download}>Export diagnostic checklist</button></div>
        <p className="trouble-sharing">Sharing includes only the selected stage, symptom, and operating system. Checklists contain guidance, not a diagnosis or your answers.</p>
        {feedback && <p role={feedback.error ? 'alert' : 'status'} className={feedback.error ? 'callout callout-error' : 'trouble-feedback'}>{translate(feedback.text)}</p>}
      </footer>
    </>}
  </main>
}
