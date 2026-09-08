import { useState } from 'react'
import { ArrowUpRight, Check, Copy, Download, Terminal } from 'lucide-react'
import { buildDeploymentPlan, DEPLOYMENT_DEFAULTS, DEPLOYMENT_SOURCES, deploymentCompatibility, deploymentMarkdown, deploymentSearch, restoreDeployment, type DeploymentInput } from './deployment'
import './deploy.css'
import ArtifactPicker from './ArtifactPicker'
import type { DeploymentArtifact } from './artifact-picker'
import SaveRunForm from './SaveRunForm'

export default function DeployPage() {
  const [restored] = useState(() => {
    try { return { input: restoreDeployment(window.location.search), error: '' } }
    catch (error) { return { input: { ...DEPLOYMENT_DEFAULTS }, error: error instanceof Error ? error.message : 'Cannot read this deployment link.' } }
  })
  const [input, setInput] = useState(restored.input)
  const [linkError, setLinkError] = useState(restored.error)
  const [feedback, setFeedback] = useState({ error: false, text: '' })
  const [checked, setChecked] = useState<number[]>([])
  const [artifact, setArtifact] = useState<DeploymentArtifact | undefined>()
  const update = (key: keyof DeploymentInput, value: string) => {
    setInput(previous => ({ ...previous, [key]: value, ...((key === 'model' || key === 'file') ? { revision: undefined } : {}) }))
    setFeedback({ error: false, text: '' })
    setChecked([])
    if (key === 'model' || key === 'file' || key === 'engine' || key === 'revision') setArtifact(undefined)
  }
  let validation = ''
  let plan: ReturnType<typeof buildDeploymentPlan> | undefined
  try { plan = buildDeploymentPlan(input) }
  catch (error) { validation = error instanceof Error ? error.message : 'Unable to build this plan.' }
  const compatibility = deploymentCompatibility(input)
  async function copy(text: string, message: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
      setFeedback({ error: false, text: message })
    } catch { setFeedback({ error: true, text: 'Could not copy. Select the command or runbook text and copy it manually.' }) }
  }
  function download() {
    let url: string | undefined
    try {
      url = URL.createObjectURL(new Blob([deploymentMarkdown(input)], { type: 'text/markdown;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = 'sizeof-local-deployment.md'; anchor.click()
      setFeedback({ error: false, text: 'Runbook download requested. Check your browser’s downloads.' })
    } catch { setFeedback({ error: true, text: 'Could not prepare the download. Use Copy runbook instead.' }) }
    finally { if (url) { const objectUrl = url; window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000) } }
  }
  return <main className="deploy-workbench">
    <header className="deploy-heading"><div><p className="deploy-eyebrow">LOCAL DEPLOYMENT / WORKBENCH</p><h1>From model to first reply.</h1><p>Build a local-only launch plan. Understand each step before you run it.</p></div><span className="deploy-local"><span /> Nothing runs in your browser</span></header>
    {linkError && <div role="alert" className="deploy-error">{linkError} <button onClick={() => { window.history.replaceState(null, '', '/deploy'); setLinkError('') }}>Reset invalid link</button></div>}
    <div className="deploy-grid">
      <section className="deploy-panel deploy-inputs" aria-labelledby="deploy-config-title">
        <p className="deploy-eyebrow">01 / CONFIGURE</p><h2 id="deploy-config-title">Your machine. Your model.</h2>
        <label>Operating system<select value={input.os} onChange={event => update('os', event.target.value)}><option value="mac">macOS</option><option value="linux">Linux / configured WSL2</option><option value="windows">Windows (PowerShell)</option></select></label>
        <label>Hardware<select value={input.hardware} onChange={event => update('hardware', event.target.value)}><option value="apple">Apple Silicon · unified memory</option><option value="cuda">NVIDIA GPU · CUDA</option><option value="cpu">CPU · system memory</option></select></label>
        <label>Inference engine<select value={input.engine} onChange={event => update('engine', event.target.value)}><option value="llama-cpp">llama.cpp · GGUF</option><option value="mlx">MLX LM · Apple Silicon</option><option value="vllm">vLLM · Linux CUDA server</option></select></label>
        <label>Model ID or URL<input value={input.model} onChange={event => update('model', event.target.value)} placeholder="owner/model or Hugging Face URL" autoComplete="off" spellCheck={false} maxLength={500} /></label>
        <p className="deploy-hint">Choose a full-model repository supported by your engine. We do not infer compatibility from its name.</p>
        {input.engine === 'llama-cpp' && <label>Exact GGUF filename<input value={input.file} onChange={event => update('file', event.target.value)} placeholder="model-Q4_K_M.gguf" autoComplete="off" spellCheck={false} maxLength={240} /><span className="deploy-hint">Copy the filename from the repository’s Files tab. This is not a quantization estimate.</span></label>}
        {input.engine === 'llama-cpp' && <ArtifactPicker modelInput={input.model} onSelect={(selected) => {
          setInput(previous => ({ ...previous, model: selected.repositoryId, file: selected.path, revision: selected.revision.toLowerCase() }))
          setArtifact(selected); setChecked([]); setFeedback({ error: false, text: 'Actual repository and file selected. Review the observed revision and runtime requirements.' })
        }} />}
        {artifact && <div className="deploy-note"><strong>Selected file evidence</strong><p>{artifact.repositoryId} / {artifact.path}</p><p>{(artifact.sizeBytes / 2 ** 30).toFixed(2)} GiB · observed revision <code>{artifact.revision}</code></p><a href={`https://huggingface.co/${artifact.repositoryId}/blob/${artifact.revision}/${artifact.path}`} target="_blank" rel="noreferrer">Inspect this exact version ↗</a><p>The download step targets this model revision. Runtime versions and drivers still need to be recorded separately.</p></div>}
        <label>Model commit (optional)<input aria-label="Model commit" value={input.revision ?? ''} onChange={event => update('revision', event.target.value)} placeholder="40-character commit; blank follows default branch" maxLength={40} spellCheck={false} autoComplete="off" /><span className="deploy-hint">Select a published file to fill its commit automatically. A branch name or tag is not an immutable model version.</span></label>
        {input.revision && <button type="button" onClick={() => update('revision', '')}>Use unpinned model instead</button>}
        <div className="deploy-pair"><label>{input.engine === 'mlx' ? 'Planning context (tokens)' : 'Context limit (tokens)'}<input inputMode="numeric" value={input.context} onChange={event => update('context', event.target.value)} maxLength={7} /></label><label>Local port<input inputMode="numeric" value={input.port} onChange={event => update('port', event.target.value)} maxLength={5} /></label></div>
        <div className="deploy-note">Local address only: <code>127.0.0.1</code>. No account, key, or paid compute is needed to prepare a plan.</div>
        <p className="deploy-hint" style={{ marginTop: 14 }}><a href={`/docs/${input.engine}`}>Read the {input.engine === 'llama-cpp' ? 'llama.cpp' : input.engine === 'mlx' ? 'MLX' : 'vLLM'} setup guide →</a></p>
        {compatibility && <p role="alert" className="deploy-error">{compatibility}</p>}
      </section>
      <section className="deploy-panel deploy-output" aria-labelledby="deploy-plan-title">
        <div className="deploy-output-header"><div><p className="deploy-eyebrow">02 / REVIEW & RUN LOCALLY</p><h2 id="deploy-plan-title">Your deployment runbook</h2></div><Terminal size={24} aria-hidden="true" /></div>
        {!plan || linkError ? <div className="deploy-empty"><Terminal size={36} aria-hidden="true" /><h3>{linkError ? 'Reset the invalid link first' : 'Complete your launch settings'}</h3><p>{linkError || validation}</p><a href="/docs">New to local models? Start with the guides <ArrowUpRight size={14} /></a></div> : <>
          <div className="deploy-summary"><span>{plan.shell}</span><span>{input.engine}</span><span>One local server</span><span>Reviewed 08 Sep 2026</span></div>
          <p className="deploy-note">{plan.modelRevision ? <>Fixed model revision: <code>{plan.modelRevision}</code>. Run the download step first, then launch from <code>{plan.localModelPath}</code>.</> : 'Unpinned model: upstream files may change. Fill a full model commit for a repeatable download.'}</p>
          <details className="deploy-checklist" open><summary>Before you start · {checked.length}/{plan.checklist.length} checked</summary>{plan.checklist.map((item, index) => <label key={item}><input type="checkbox" checked={checked.includes(index)} onChange={() => setChecked(previous => previous.includes(index) ? previous.filter(value => value !== index) : [...previous, index])} /><span>{item}</span></label>)}</details>
          {[...(plan.download ? [['Download fixed model revision', plan.download]] : []), ['Start the server', plan.launch], ['Check the API · second terminal', plan.probe], ['Request a first reply · second terminal', plan.client]].map(([title, command], index) => <section className="deploy-command" key={title}><div><h3><span>0{index + 1}</span>{title}</h3><button aria-label={`Copy ${title.toLowerCase()}`} onClick={() => void copy(command, 'Command copied. Review it before running.')}><Copy size={15} aria-hidden="true" /> Copy</button></div><pre><code>{command}</code></pre></section>)}
          <div className="deploy-actions"><button onClick={() => void copy(deploymentMarkdown(input), 'Runbook copied.')}><Copy size={15} aria-hidden="true" /> Copy runbook</button><button onClick={download}><Download size={15} aria-hidden="true" /> Download .md</button><button onClick={() => void copy(`${window.location.origin}/deploy?${deploymentSearch(input)}`, 'Plan link copied. It contains settings, never API keys.')}><ArrowUpRight size={15} aria-hidden="true" /> Share plan</button></div>
          <div className="deploy-limits"><h3>Know the limits</h3>{plan.warnings.map(warning => <p key={warning}>{warning}</p>)}<p><a href="/docs/troubleshooting">Troubleshoot a failed launch →</a> · <a href="/docs/serving-security">Before exposing an API →</a></p></div>
          <p className="deploy-hint"><a href="/troubleshoot">Open interactive troubleshooting →</a></p>
          <p className="deploy-hint">Changing launch settings resets unsaved record notes and the reported outcome. Save the current record first if you want to keep it.</p>
          <SaveRunForm key={`${JSON.stringify(input)}:${artifact?.revision ?? ''}`} input={input} artifact={artifact} />
        </>}
        {feedback.text && <p role={feedback.error ? 'alert' : 'status'} className={feedback.error ? 'deploy-error' : 'deploy-success'}>{!feedback.error && <Check size={15} aria-hidden="true" />} {feedback.text}</p>}
      </section>
    </div>
    <section className="deploy-resources"><div><p className="deploy-eyebrow">LEARN / VERIFY / TROUBLESHOOT</p><h2>Keep the source of truth close.</h2><p>Install from official projects. Preserve the first error. Check actual inference before sharing access.</p><a href="/docs">Browse the learning center →</a></div><ul>{DEPLOYMENT_SOURCES.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}<ArrowUpRight size={15} aria-hidden="true" /></a></li>)}</ul></section>
  </main>
}
