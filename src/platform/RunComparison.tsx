import { useId, useState } from 'react'
import type { DeploymentRun } from './run-history'
import { compareRuns, exportRunDiff, runDiffCaveat } from './run-diff'
import './run-diff.css'

export default function RunComparison({ left, right }: { left: DeploymentRun; right: DeploymentRun }) {
  const heading = useId(), [changesOnly, setChangesOnly] = useState(false)
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null)
  const rows = compareRuns(left, right)
  const changes = rows.filter(row => row.changed && row.category !== 'Record metadata').length
  async function copy() {
    setFeedback(null)
    try {
      const body = exportRunDiff(left, right)
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard is unavailable. Use Download comparison instead.')
      await navigator.clipboard.writeText(body)
      setFeedback({ error: false, text: 'Comparison copied, including private notes. Review before sharing.' })
    } catch (error) { setFeedback({ error: true, text: error instanceof Error ? error.message : 'Could not copy the comparison.' }) }
  }
  function download() {
    setFeedback(null)
    let url: string | undefined
    try {
      url = URL.createObjectURL(new Blob([exportRunDiff(left, right)], { type: 'text/plain;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url; link.download = 'sizeof-run-comparison.txt'; link.click()
      setFeedback({ error: false, text: 'Comparison download requested, including private notes. Check your browser downloads.' })
    } catch (error) { setFeedback({ error: true, text: error instanceof Error ? error.message : 'Could not download the comparison.' }) }
    finally { if (url) { const release = url; window.setTimeout(() => URL.revokeObjectURL(release), 1000) } }
  }
  return <section className="run-comparison" aria-labelledby={heading}>
    <div className="run-diff-heading"><div><p className="platform-eyebrow">CONFIGURATION / EVIDENCE</p><h2 id={heading}>Compare deployment records</h2></div><span className="run-diff-count">{changes} changed {changes === 1 ? 'field' : 'fields'}<small>Excludes record metadata</small></span></div>
    <p className="run-diff-caveat">{runDiffCaveat}</p>
    <p className="run-diff-caveat">A and B follow your selection order, not the save date. Missing facts mean “Not recorded”, never zero. Case and formatting differences are kept.</p>
    <label className="run-diff-toggle"><input type="checkbox" checked={changesOnly} onChange={e => setChangesOnly(e.target.checked)} /> Show changed fields only</label>
    {changesOnly && !rows.some(row => row.changed) ? <p>These records have no differences.</p> : <div className="run-diff-scroll" role="region" aria-label="Deployment comparison table" tabIndex={0}><table>
      <caption>Record A compared with record B</caption>
      <thead><tr><th scope="col">Field</th><th scope="col">A · {left.input.model}</th><th scope="col">B · {right.input.model}</th><th scope="col">Difference</th></tr></thead>
      <tbody>{rows.filter(row => !changesOnly || row.changed).map(row => <tr key={row.key} className={row.changed ? 'run-diff-changed' : ''}><th scope="row"><small>{row.category}</small>{row.label}</th><td>{row.before === null ? <span className="run-diff-missing">Not recorded</span> : row.before}</td><td>{row.after === null ? <span className="run-diff-missing">Not recorded</span> : row.after}</td><td>{row.changed ? 'Changed' : 'Same'}</td></tr>)}</tbody>
    </table></div>}
    <p className="run-diff-privacy">Exports include both records’ private notes and error summaries, including fields hidden by the filter. Review them before sharing. Nothing is uploaded.</p>
    <div className="platform-actions"><button onClick={() => void copy()}>Copy comparison</button><button onClick={download}>Download comparison</button></div>
    {feedback && <p role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
  </section>
}
