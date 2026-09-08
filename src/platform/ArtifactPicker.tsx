import { useEffect, useRef, useState } from 'react'
import { fetchArtifactChoices, type ArtifactChoices, type DeploymentArtifact } from './artifact-picker'
import './artifact-picker.css'

export default function ArtifactPicker({ modelInput, onSelect }: { modelInput: string; onSelect: (artifact: DeploymentArtifact) => void }) {
  const [result, setResult] = useState<{ input: string; choices: ArtifactChoices } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => {
    request.current?.abort(); request.current = null
    setResult(null); setBusy(false); setError(''); setFilter(''); setSelected('')
    return () => { request.current?.abort(); request.current = null }
  }, [modelInput])
  async function lookup() {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setError(''); setResult(null); setSelected('')
    const timeout = window.setTimeout(() => controller.abort(new Error('Artifact lookup timed out. Retry the lookup.')), 30000)
    try {
      const choices = await fetchArtifactChoices(modelInput, controller.signal)
      if (request.current === controller && !controller.signal.aborted) setResult({ input: modelInput, choices })
    } catch (failure) {
      if (request.current === controller) setError(controller.signal.aborted ? 'Artifact lookup timed out. Retry the lookup.' : failure instanceof Error ? failure.message : 'Artifact lookup failed. Retry the lookup.')
    } finally {
      window.clearTimeout(timeout)
      if (request.current === controller) setBusy(false)
    }
  }
  const choices = result?.input === modelInput ? result.choices : null
  const matches = choices?.artifacts.filter(artifact => `${artifact.repositoryId} ${artifact.path} ${artifact.label}`.toLowerCase().includes(filter.toLowerCase().trim())) ?? []
  return <section className="artifact-picker" aria-label="Published GGUF file picker">
    <div className="artifact-picker-heading"><h3>Choose a published file</h3><button type="button" disabled={busy || !modelInput.trim()} onClick={() => void lookup()}>{busy ? 'Checking files…' : 'Find GGUF files'}</button></div>
    <p>Checks public model metadata only. No weights are downloaded. Selecting a community file uses its publisher’s repository.</p>
    {busy && <p role="status">Checking model files…</p>}
    {error && <p role="alert" className="deploy-error">{error}</p>}
    {choices && <>
      <p>{choices.artifacts.length} selectable single-file GGUF artifacts. Architecture support still depends on your llama.cpp version.</p>
      {choices.omittedSplitFiles > 0 && <p className="artifact-picker-warning">{choices.omittedSplitFiles} split-file variants omitted. Those require every shard; use the repository’s download instructions.</p>}
      {choices.artifacts.length === 0 ? <p>No supported single-file GGUF artifacts were found in this response. This is not a complete search of every community publisher. Review the repository or enter another GGUF model ID.</p> : <>
        <label>Filter published files<input value={filter} onChange={event => setFilter(event.target.value)} maxLength={200} placeholder="Publisher or quantization, e.g. Q4_K_M" /></label>
        <ul className="artifact-picker-list">{matches.slice(0, 60).map(artifact => <li key={`${artifact.repositoryId}/${artifact.path}`}><strong>{artifact.label}</strong><code>{artifact.path}</code><span>{artifact.repositoryId} · {(artifact.sizeBytes / 1024 ** 3).toFixed(2)} GiB</span><span>Revision {artifact.revision.slice(0, 12)}</span><button type="button" aria-label={`Use ${artifact.repositoryId}/${artifact.path}`} onClick={() => { if (result?.input !== modelInput) return; onSelect(artifact); setSelected(artifact.path) }}>Use this file</button></li>)}</ul>
        {matches.length === 0 && <p>No files match this filter.</p>}
        {matches.length > 60 && <p>Showing 60 of {matches.length} matches. Narrow the filter to see other files.</p>}
      </>}
    </>}
    {selected && <p role="status">Selected {selected}. Review the generated runbook before running it.</p>}
  </section>
}
