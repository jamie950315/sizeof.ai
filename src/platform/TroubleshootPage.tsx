import { useState } from 'react'
import { DEFAULT_DIAGNOSTIC, diagnosticChecklist, diagnosticPath, diagnosticSearch, parseDiagnostic, PATHS, sanitizeDiagnosticNote, STAGES, SYSTEM_CHECKS, SYSTEMS, type DiagnosticSelection, type Stage, type System } from './troubleshooting'
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
  return <main className="platform-main troubleshoot-page">
    <header><p className="platform-eyebrow">LOCAL DEPLOYMENT · DIAGNOSTIC DESK</p><h1>Find the first failure.</h1><p className="platform-lead">Start where the workflow stopped. Gather evidence, inspect one cause at a time, and keep your original model and settings visible.</p></header>
    {error ? <section role="alert" className="platform-alert"><p>{error} No diagnostic advice is shown for this invalid link.</p><button onClick={() => { setError(''); choose({ ...DEFAULT_DIAGNOSTIC }); window.history.replaceState(null, '', '/troubleshoot') }}>Reset invalid link</button></section> : <>
      <aside className="trouble-boundary">This is a guided checklist, not an automatic diagnosis. Nothing runs on your computer, no logs are uploaded, and no AI service is called. Preserve the first error before retrying.</aside>
      <div className="trouble-workspace">
        <section className="trouble-controls" aria-label="Diagnostic selection">
          <h2><small>01</small> Locate the failure</h2>
          <label>Failure stage<select value={selection.stage} onChange={e => { const stage = e.target.value as Stage; choose({ ...selection, stage, symptom: PATHS[stage][0].id }) }}>{STAGES.map(([id, title]) => <option value={id} key={id}>{title}</option>)}</select></label>
          <label>Symptom<select value={selection.symptom} onChange={e => choose({ ...selection, symptom: e.target.value })}>{PATHS[selection.stage].map(p => <option value={p.id} key={p.id}>{p.title}</option>)}</select></label>
          <label>Operating system<select value={selection.os} onChange={e => choose({ ...selection, os: e.target.value as System })}>{SYSTEMS.map(s => <option key={s}>{s}</option>)}</select></label>
          <div className="trouble-baseline"><strong>Keep your baseline.</strong><p>Record the model revision, selected files, engine version, device, context, and precision in your own deployment record. Do not change several variables to hide the original failure.</p><a href="/deploy">Open deployment workbench →</a></div>
        </section>
        <section className="trouble-evidence" aria-label="Evidence questions">
          <h2><small>02</small> Inspect the evidence</h2><p>“Unknown” is useful evidence too. These answers organize your investigation; they do not prove a cause.</p>
          {path.questions.map((q, i) => <label key={`${selection.stage}-${selection.symptom}-${i}`}>{q}<select value={answers[i]} onChange={e => setAnswers(prev => prev.map((a, index) => index === i ? e.target.value : a))}><option value="">Choose an observation</option><option value="yes">Yes / confirmed</option><option value="no">No / not confirmed</option><option value="unknown">Unknown — needs checking</option></select></label>)}
          {ready ? <div className="trouble-next" aria-live="polite"><span className="platform-eyebrow">NEXT SAFE CHECK · NOT A VERIFIED FIX</span><h3>{path.title}</h3><p>{path.check}</p>{answers.includes('unknown') && <p className="trouble-unknown">Some evidence is still unknown. Start with the unanswered checks before attempting a change.</p>}{answers.includes('no') && <p className="trouble-unknown">At least one item is not confirmed. Verify that prerequisite before treating a suggested cause as likely.</p>}<h3>Possible causes</h3><p>{path.causes}</p><h3>On {selection.os}</h3><p>{SYSTEM_CHECKS[selection.os]}</p><div className="trouble-stop"><strong>When to stop</strong><p>{path.stop}</p></div><a href={`/docs/${path.doc}`}>Read the related guide →</a></div> : <p className="trouble-pending">Answer both questions, including “Unknown” when needed, to reveal the next check.</p>}
        </section>
      </div>
      <section className="trouble-notes"><h2><small>03</small> Keep a private scratchpad</h2><label>Private notes<textarea maxLength={4000} value={notes} onChange={e => setNotes(sanitizeDiagnosticNote(e.target.value))} placeholder="Keep the first error and observations. Do not enter credentials or private logs." /></label><p>{notes.length}/4,000 characters · Memory only: lost on reload or leaving this page. Never included in links, copied checklists, or exports. This is not a secret detector or secure vault.</p><button disabled={!notes} onClick={() => setNotes('')}>Clear private notes</button></section>
      <footer className="trouble-actions"><button onClick={() => void copy(true)}>Copy guide link</button><button onClick={() => void copy(false)}>Copy diagnostic checklist</button><button onClick={download}>Export diagnostic checklist</button></footer><p className="trouble-sharing">Sharing includes only the selected stage, symptom, and operating system. Checklists contain guidance, not a diagnosis or your answers.</p>
      {feedback && <p role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
    </>}
  </main>
}
