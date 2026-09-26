import { useState } from 'react'
import { translate } from '../i18n/core'
import { Check, Copy, Download, ExternalLink, Link2 } from 'lucide-react'
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
    setInput(previous => ({ ...previous, [key]: value, ...((key === 'model' || key === 'file') ? { revision: undefined } : {}), ...(['model', 'file', 'revision', 'engine'].includes(key) ? { shardFiles: undefined } : {}) }))
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
  async function sharePlan() {
    try { await copy(`${window.location.origin}/deploy?${deploymentSearch(input)}`, 'Plan link copied. It contains settings, never API keys.') }
    catch (reason) { setFeedback({ error: true, text: reason instanceof Error ? reason.message : 'This plan could not be shared.' }) }
  }
  const engineName = input.engine === 'llama-cpp' ? 'llama.cpp' : input.engine === 'mlx' ? 'MLX' : 'vLLM'
  const commands = plan ? [...(plan.download ? [['Download fixed model revision', plan.download]] : []), ['Start the server', plan.launch], ['Check the API · second terminal', plan.probe], ['Request a first reply · second terminal', plan.client]] : []
  return <main className="page deploy-page">
    <header className="page-head deploy-head">
      <h1>Deployment workbench</h1>
      <p className="lede">Build a local-only launch plan. Understand each step before you run it.</p>
      <p className="deploy-local"><span aria-hidden="true" /> Nothing runs in your browser</p>
    </header>
    {linkError && <div role="alert" className="callout callout-error deploy-alert"><p>{translate(linkError)}</p><button type="button" className="btn" onClick={() => { window.history.replaceState(null, '', '/deploy'); setLinkError('') }}>Reset invalid link</button></div>}
    <div className="deploy-grid">
      <section className="deploy-form" aria-labelledby="deploy-config-title">
        <h2 id="deploy-config-title" className="deploy-column-title">Launch settings</h2>
        <ol className="deploy-steps">
          <li className="deploy-step">
            <h3>Machine and engine</h3>
            <label className="field"><span>Operating system</span><select value={input.os} onChange={event => update('os', event.target.value)}><option value="mac">macOS</option><option value="linux">Linux / configured WSL2</option><option value="windows">Windows (PowerShell)</option></select></label>
            <label className="field"><span>Hardware</span><select value={input.hardware} onChange={event => update('hardware', event.target.value)}><option value="apple">Apple Silicon · unified memory</option><option value="cuda">NVIDIA GPU · CUDA</option><option value="cpu">CPU · system memory</option></select></label>
            <label className="field"><span>Inference engine</span><select value={input.engine} onChange={event => update('engine', event.target.value)}><option value="llama-cpp">llama.cpp · GGUF</option><option value="mlx">MLX LM · Apple Silicon</option><option value="vllm">vLLM · Linux CUDA server</option></select></label>
            {compatibility && <p role="alert" className="callout callout-error">{translate(compatibility)}</p>}
          </li>
          <li className="deploy-step">
            <h3>Model</h3>
            <label className="field"><span>Model ID or URL</span><input className="deploy-mono-input" value={input.model} onChange={event => update('model', event.target.value)} placeholder="owner/model or Hugging Face URL" autoComplete="off" spellCheck={false} maxLength={500} /></label>
            <p className="deploy-hint">Choose a full-model repository supported by your engine. We do not infer compatibility from its name.</p>
            {input.engine === 'llama-cpp' && <label className="field"><span>Exact GGUF filename</span><input className="deploy-mono-input" value={input.file} onChange={event => update('file', event.target.value)} placeholder="model-Q4_K_M.gguf" autoComplete="off" spellCheck={false} maxLength={240} /><small className="deploy-hint">Copy the filename from the repository’s Files tab. This is not a quantization estimate.</small></label>}
            {input.engine === 'llama-cpp' && <ArtifactPicker modelInput={input.model} onSelect={(selected) => {
              setInput(previous => ({ ...previous, model: selected.repositoryId, file: selected.path, revision: selected.revision.toLowerCase(), shardFiles: selected.files?.map(file => file.path) }))
              setArtifact(selected); setChecked([]); setFeedback({ error: false, text: 'Actual repository and file selected. Review the observed revision and runtime requirements.' })
            }} />}
            {artifact && <div className="deploy-evidence">
              <strong>Selected file evidence</strong>
              <p className="deploy-evidence-path">{artifact.repositoryId} / {artifact.path}</p>
              <p>{(artifact.sizeBytes / 2 ** 30).toFixed(2)} GiB · observed revision <code>{artifact.revision}</code></p>
              <a href={`https://huggingface.co/${artifact.repositoryId}/blob/${artifact.revision}/${artifact.path}`} target="_blank" rel="noreferrer">Inspect this exact version <ExternalLink size={13} aria-hidden="true" /></a>
              <p>The download step targets this model revision. Runtime versions and drivers still need to be recorded separately.</p>
            </div>}
            <label className="field"><span>Model commit (optional)</span><input className="deploy-mono-input" aria-label="Model commit" value={input.revision ?? ''} onChange={event => update('revision', event.target.value)} placeholder="40-character commit; blank follows default branch" maxLength={40} spellCheck={false} autoComplete="off" /><small className="deploy-hint">Select a published file to fill its commit automatically. A branch name or tag is not an immutable model version.</small></label>
            {input.revision && <button type="button" className="btn btn-quiet deploy-unpin" onClick={() => update('revision', '')}>Use unpinned model instead</button>}
            {input.shardFiles && <details className="disclosure deploy-manifest" open><summary>Complete download manifest · {input.shardFiles.length} files</summary><ol>{input.shardFiles.map(path => <li key={path}><code>{path}</code></li>)}</ol><p>Every listed file must download successfully at the fixed revision. The engine opens the first shard and reads the remaining set.</p></details>}
          </li>
          <li className="deploy-step">
            <h3>Local server</h3>
            <div className="deploy-pair">
              <label className="field"><span>{input.engine === 'mlx' ? 'Planning context (tokens)' : 'Context limit (tokens)'}</span><input className="deploy-mono-input" inputMode="numeric" value={input.context} onChange={event => update('context', event.target.value)} maxLength={7} /></label>
              <label className="field"><span>Local port</span><input className="deploy-mono-input" inputMode="numeric" value={input.port} onChange={event => update('port', event.target.value)} maxLength={5} /></label>
            </div>
            <p className="deploy-hint">Local address only: <code>127.0.0.1</code>. No account, key, or paid compute is needed to prepare a plan.</p>
          </li>
        </ol>
        <ul className="deploy-links">
          <li><a href={`/docs/${input.engine}`}>Read the {engineName} setup guide</a></li>
          <li><a href="/compatibility">Review compatibility evidence</a></li>
          <li><a href="/context">Budget the whole request</a></li>
        </ul>
      </section>
      <section className="deploy-runbook" aria-labelledby="deploy-plan-title">
        <header className="deploy-runbook-head">
          <h2 id="deploy-plan-title">Your deployment runbook</h2>
          {plan && !linkError && <p className="deploy-meta"><span>{plan.shell}</span><span>{input.engine}</span><span>One local server</span><span>Reviewed 08 Sep 2026</span></p>}
        </header>
        {!plan || linkError ? <div className="deploy-empty">
          <h3>{linkError ? 'Reset the invalid link first' : 'Complete your launch settings'}</h3>
          <p>{translate(linkError || validation)}</p>
          <a href="/docs">New to local models? Start with the guides</a>
        </div> : <>
          {plan.modelRevision
            ? <p className="deploy-pin deploy-pin-fixed">Fixed model revision: <code>{plan.modelRevision}</code>. Run the download step first, then launch from <code>{plan.localModelPath}</code>.</p>
            : <p className="deploy-pin">Unpinned model: upstream files may change. Fill a full model commit for a repeatable download.</p>}
          <details className="disclosure deploy-checklist" open>
            <summary>Before you start · {checked.length}/{plan.checklist.length} checked</summary>
            <ul>{plan.checklist.map((item, index) => <li key={item}><label><input type="checkbox" checked={checked.includes(index)} onChange={() => setChecked(previous => previous.includes(index) ? previous.filter(value => value !== index) : [...previous, index])} /><span>{translate(item)}</span></label></li>)}</ul>
          </details>
          <ol className="deploy-listings">
            {commands.map(([title, command]) => <li className="deploy-listing" key={title}>
              <div className="deploy-listing-head">
                <h3>{translate(title)}</h3>
                <button type="button" className="icon-btn" aria-label={`Copy ${translate(title).toLowerCase()}`} onClick={() => void copy(command, 'Command copied. Review it before running.')}><Copy size={15} aria-hidden="true" /> Copy</button>
              </div>
              <pre><code>{command}</code></pre>
            </li>)}
          </ol>
          <div className="deploy-actions">
            <button type="button" className="btn btn-tape" onClick={() => void copy(deploymentMarkdown(input), 'Runbook copied.')}><Copy size={15} aria-hidden="true" /> Copy runbook</button>
            <button type="button" className="btn" onClick={download}><Download size={15} aria-hidden="true" /> Download .md</button>
            <button type="button" className="btn" onClick={() => void sharePlan()}><Link2 size={15} aria-hidden="true" /> Share plan</button>
          </div>
          <section className="deploy-limits" aria-labelledby="deploy-limits-title">
            <h3 id="deploy-limits-title">Know the limits</h3>
            <ul>{plan.warnings.map(warning => <li key={warning}>{translate(warning)}</li>)}</ul>
            <ul className="deploy-links">
              <li><a href="/troubleshoot">Open interactive troubleshooting</a></li>
              <li><a href="/docs/troubleshooting">Troubleshoot a failed launch</a></li>
              <li><a href="/docs/serving-security">Before exposing an API</a></li>
            </ul>
          </section>
          <p className="deploy-hint deploy-record-hint">Changing launch settings resets unsaved record notes and the reported outcome. Save the current record first if you want to keep it.</p>
          <SaveRunForm key={`${JSON.stringify(input)}:${artifact?.revision ?? ''}`} input={input} artifact={artifact} />
        </>}
        {feedback.text && <p role={feedback.error ? 'alert' : 'status'} className={feedback.error ? 'deploy-feedback deploy-feedback-error' : 'deploy-feedback'}>{!feedback.error && <Check size={15} aria-hidden="true" />} {translate(feedback.text)}</p>}
      </section>
    </div>
    <section className="deploy-resources" aria-labelledby="deploy-resources-title">
      <div>
        <h2 id="deploy-resources-title">Keep the source of truth close.</h2>
        <p>Install from official projects. Preserve the first error. Check actual inference before sharing access.</p>
        <a href="/docs">Browse the learning center</a>
      </div>
      <ul>{DEPLOYMENT_SOURCES.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer"><span>{translate(source.title)}</span><span className="deploy-host">{new URL(source.url).hostname}<ExternalLink size={13} aria-hidden="true" /></span></a></li>)}</ul>
    </section>
  </main>
}
