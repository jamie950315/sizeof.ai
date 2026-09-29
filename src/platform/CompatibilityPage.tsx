import { useState } from 'react'
import { COMPAT_OPTIONS, DEFAULT_COMPATIBILITY, REVIEWED, compatibilityEvidence, compatibilitySearch, parseCompatibility, type CompatibilityPlan, type EvidenceStatus } from './compatibility'
import { translate } from '../i18n/core'
import './compatibility.css'
const labels: Record<keyof CompatibilityPlan, string> = { engine: 'Execution engine', os: 'Operating system', hardware: 'Hardware class', format: 'Model packaging', family: 'Model family' }
const names: Record<string, string> = { linux: 'Linux', macos: 'macOS', windows: 'Windows (native)', wsl2: 'WSL2 Linux', nvidia: 'NVIDIA GPU', amd: 'AMD GPU', 'apple-silicon': 'Apple silicon', cpu: 'CPU only', other: 'Other / not sure', gguf: 'GGUF', 'hf-safetensors': 'Hugging Face safetensors repository', mlx: 'MLX-compatible repository', 'mlx-lm': 'MLX LM', vllm: 'vLLM (standard engine)', llama: 'Llama', qwen: 'Qwen', mistral: 'Mistral' }
const stamps: Record<EvidenceStatus, string> = { documented: 'comfortable', unsupported: 'too-large', unknown: 'unverified' }
function initialPlan() { try { return { plan: parseCompatibility(window.location.search), error: '' } } catch (error) { return { plan: { ...DEFAULT_COMPATIBILITY }, error: error instanceof Error ? error.message : 'Invalid link.' } } }
export default function CompatibilityPage() {
  const [initial] = useState(initialPlan), [plan, setPlan] = useState(initial.plan), [error, setError] = useState(initial.error), [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null)
  const evidence = compatibilityEvidence(plan)
  const blocked = evidence.some(row => row.status === 'unsupported')
  async function copy() { try { await navigator.clipboard.writeText(`${window.location.origin}/compatibility?${compatibilitySearch(plan)}`); setFeedback({ text: 'Check link copied.', error: false }) } catch (e) { setFeedback({ text: `Could not copy. ${e instanceof Error ? e.message : 'Clipboard unavailable.'}`, error: true }) } }
  return <main className="page compatibility-page">
    <header className="page-head"><h1>Compatibility desk</h1><p className="lede">Separate documented capabilities from open questions. This is a small, manually reviewed reference—not a universal model support database.</p></header>
    {error ? <div role="alert" className="platform-alert">{translate(error)} No check is shown for this link. <button type="button" onClick={() => { setError(''); setPlan({ ...DEFAULT_COMPATIBILITY }); window.history.replaceState(null, '', '/compatibility') }}>Reset check</button></div> : <>
    <section className="compat-selectors" aria-label="Compatibility selection">{(Object.keys(COMPAT_OPTIONS) as (keyof CompatibilityPlan)[]).map(key => <label className="field" key={key}><span>{translate(labels[key])}</span><select value={plan[key]} onChange={e => { setPlan(p => ({ ...p, [key]: e.target.value })); setFeedback(null) }}>{COMPAT_OPTIONS[key].map(value => <option value={value} key={value}>{translate(names[value] ?? value)}</option>)}</select></label>)}</section>
    <section className={`compat-verdict${blocked ? ' blocked' : ''}`} aria-live="polite">
      <span className={`fit-pill ${blocked ? 'too-large' : 'unverified'}`}>{blocked ? 'Documented blocker' : 'Verification still required'}</span>
      <h2>{blocked ? 'Change the unsupported component.' : 'Documented pieces are not a tested combination.'}</h2>
      <p>No runtime inference was performed. Model family, file format, operating system and hardware need to work together. A successful load still does not guarantee enough memory or acceptable speed.</p>
    </section>
    <ol className="compat-evidence">{evidence.map(row => <li key={row.dimension}>
      <div className="compat-evidence-head"><h3>{translate(row.dimension)}</h3><span className={`fit-pill ${stamps[row.status]}`} data-status={row.status}>{row.status === 'documented' ? 'Officially documented' : row.status === 'unsupported' ? 'Documented unsupported' : 'Not yet verified'}</span></div>
      <p>{translate(row.explanation)}</p>
      <div className="compat-evidence-source"><a href={row.source} target="_blank" rel="noreferrer">Official source</a><time dateTime={row.reviewed}>Reviewed {row.reviewed}</time></div>
    </li>)}</ol>
    <div className="compat-actions"><button type="button" className="btn" onClick={() => void copy()}>Copy check link</button><a href="/deploy">Open deployment workbench</a><a href="/benchmarks">Keep your own measurements</a></div>
    {feedback && <p className={`compat-feedback${feedback.error ? ' platform-alert' : ''}`} role={feedback.error ? 'alert' : 'status'}>{translate(feedback.text)}</p>}</>}
    <aside className="compat-footnote"><h2>How to read the evidence</h2><p>“Officially documented” refers only to the capability stated in that row. “Documented unsupported” requires an explicit upstream restriction. “Not yet verified” includes missing evidence, extensions and configurations outside this reviewed scope—not a claim of incompatibility.</p><p>There are no verified user-test badges in this registry. Your notebook records are personal observations, not independently validated results. Sources were checked on {REVIEWED}; their latest pages can change. Record exact engine, driver and model revisions when testing.</p></aside>
  </main>
}
