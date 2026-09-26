import { useState } from 'react'
import { translate } from '../i18n/core'
import { CONTEXT_FIELDS, CONTEXT_LABELS, DEFAULT_CONTEXT_PLAN, contextBudget, contextSearch, contextSummary, parseContextPlan, type ContextPlan } from './context-budget'
import './context-budget.css'

function read(search: string) { try { return { plan: parseContextPlan(search), error: '' } } catch (error) { return { plan: { ...DEFAULT_CONTEXT_PLAN }, error: String(error instanceof Error ? error.message : error) } } }
export default function ContextBudgetPage() {
  const [initial] = useState(() => read(window.location.search))
  const [plan, setPlan] = useState(initial.plan), [linkError, setLinkError] = useState(initial.error), [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null)
  let result: ReturnType<typeof contextBudget> | undefined, error = ''
  try { result = contextBudget(plan) } catch (e) { error = e instanceof Error ? e.message : 'Invalid budget.' }
  const update = (key: keyof ContextPlan, value: string) => { setPlan(p => ({ ...p, [key]: value })); setFeedback(null) }
  async function copy(link: boolean) { try { await navigator.clipboard.writeText(link ? `${window.location.origin}/context?${contextSearch(plan)}` : contextSummary(plan)); setFeedback({ text: link ? 'Budget link copied.' : 'Worksheet copied.', error: false }) } catch (e) { setFeedback({ text: `Could not copy. ${e instanceof Error ? e.message : 'Clipboard unavailable.'}`, error: true }) } }
  function download() {
    let url: string | undefined
    try { url = URL.createObjectURL(new Blob([contextSummary(plan)], { type: 'text/plain;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'sizeof-context-budget.txt'; a.click(); setFeedback({ text: 'Worksheet download requested.', error: false }) } catch (e) { setFeedback({ text: `Could not export. ${e instanceof Error ? e.message : 'Download unavailable.'}`, error: true }) } finally { if (url) { const downloadUrl = url; window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000) } }
  }
  const scale = result ? Math.max(result.total, result.values.capacity, 1) : 1
  const percent = (value: number) => `${Math.min(100, value / scale * 100)}%`
  return <main className="page context-page">
    <header className="page-head"><h1>Context budget</h1><p className="lede">Allocate the whole request, not just your latest message. Everything stays in this page; no prompts are uploaded.</p></header>
    {linkError ? <div role="alert" className="platform-alert">{translate(linkError)} No results are shown for this link. <button type="button" onClick={() => { setPlan({ ...DEFAULT_CONTEXT_PLAN }); setLinkError(''); window.history.replaceState(null, '', '/context') }}>Reset budget</button></div> : <>
    <div className="context-grid">
      <section className="context-inputs" aria-labelledby="context-inputs-title">
        <h2 id="context-inputs-title">Token counts & reservations</h2>
        <p className="context-intro">Enter token counts from your runtime, or explicit planning allocations. Blank is unknown and blocks calculation; zero means none. These are not character counts.</p>
        <div className="context-rows">
          {(['capacity', ...CONTEXT_FIELDS] as const).map(key => <label key={key} className={`context-row context-row-${key}`}>
            <i className={`context-swatch ctx-${key}`} aria-hidden="true" />
            <span>{translate(CONTEXT_LABELS[key])}</span>
            <input inputMode="numeric" maxLength={8} value={plan[key]} aria-invalid={!/^\d{1,8}$/.test(plan[key])} onChange={e => update(key, e.target.value)} />
          </label>)}
        </div>
      </section>
      <section className="context-result" aria-live="polite">
        <p className="context-readout-label">Allocation · not a fit guarantee</p>
        {error ? <p role="alert" className="platform-alert">{translate(error)}</p> : result && <>
          <h2 className={result.overflow ? 'context-state over' : 'context-state'}>{result.overflow ? 'Over budget' : 'Remaining capacity'}</h2>
          <div className={`total-number${result.overflow ? ' context-over' : ''}`}><span>{(result.overflow || result.remaining).toLocaleString()}</span><small>tokens</small></div>
          <div className="context-meter" role="img" aria-label={`${result.total} allocated of ${result.values.capacity} tokens`}>
            <div className="context-meter-scale" aria-hidden="true"><span>0</span><span>{scale.toLocaleString()}</span></div>
            <div className={`context-meter-track${result.overflow ? ' has-overflow' : ''}`} aria-hidden="true">
              <div className="context-meter-used" style={{ width: percent(result.total) }}>
                {CONTEXT_FIELDS.map(key => result!.values[key] > 0 && <span key={key} className={`ctx-${key}`} style={{ flexGrow: result!.values[key] }} />)}
              </div>
              {result.overflow > 0 && <span className="context-meter-overflow" style={{ insetInlineStart: percent(result.values.capacity), width: percent(result.overflow) }} />}
              <span className="context-meter-cap" style={{ insetInlineStart: percent(result.values.capacity) }} />
            </div>
          </div>
          <dl className="spec"><div><dt>Input allocation</dt><dd>{result.input.toLocaleString()}</dd></div><div><dt>Output reservation</dt><dd>{result.values.output.toLocaleString()}</dd></div><div><dt>Total allocated</dt><dd>{result.total.toLocaleString()}</dd></div><div className="context-limit-row"><dt>Configured limit</dt><dd>{result.values.capacity.toLocaleString()}</dd></div></dl>
          {result.overflow > 0 && <p role="alert" className="platform-alert">Reduce input or output by at least {result.overflow.toLocaleString()} tokens. Increasing the limit also requires model and runtime support, plus enough memory.</p>}
          <div className="context-scenarios-block">
            <h3>What if the context limit changes?</h3>
            <p>Same allocations, different limits. These are arithmetic scenarios, not supported model limits.</p>
            <dl className="context-scenarios">{[8192, 32768, 131072].map(capacity => <div key={capacity} className={capacity >= result!.total ? 'fits' : 'over'}><dt>{capacity.toLocaleString()}</dt><dd>{capacity >= result!.total ? `${(capacity - result!.total).toLocaleString()} left` : `${(result!.total - capacity).toLocaleString()} over`}</dd></div>)}</dl>
          </div>
        </>}
      </section>
    </div>
    <div className="context-actions"><button type="button" className="btn" disabled={!!error} onClick={() => void copy(true)}>Copy budget link</button><button type="button" className="btn" disabled={!!error} onClick={() => void copy(false)}>Copy worksheet</button><button type="button" className="btn" disabled={!!error} onClick={download}>Export worksheet</button><a className="btn btn-primary" href="/">Check model memory</a></div>
    {feedback && <p className={`context-feedback${feedback.error ? ' platform-alert' : ''}`} role={feedback.error ? 'alert' : 'status'}>{translate(feedback.text)}</p>}</>}
    <aside className="context-note"><h2>Count the final prompt</h2><p>Use the exact model tokenizer and chat template. Include special tokens, tool schemas, and runtime-reported image/audio tokens. Separately tokenized parts can differ from their concatenation; reconcile this worksheet with the final rendered prompt count. Reserved output includes reasoning tokens when the runtime counts them toward generation. A context allocation does not predict quality, speed, or VRAM.</p><a href="/docs/kv-cache">Read the context guide</a></aside>
  </main>
}
