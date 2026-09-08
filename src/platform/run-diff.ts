import type { DeploymentRun } from './run-history'

export type RunDiffCategory = 'Configuration' | 'Observed artifact' | 'User report' | 'Record metadata'
export interface RunDiffRow { key: string; label: string; category: RunDiffCategory; before: string | null; after: string | null; changed: boolean }
export const runDiffByteLimit = 64 * 1024
export const runDiffCaveat = 'A changed outcome does not prove a speed or memory improvement. These records contain user reports, not controlled performance measurements.'

/** Preserve case and formatting: filenames, versions and free-form notes may be case-sensitive. */
export function compareRuns(left: DeploymentRun, right: DeploymentRun): RunDiffRow[] {
  const rows: RunDiffRow[] = []
  const add = (key: string, label: string, category: RunDiffCategory, before: unknown, after: unknown) => {
    const value = (item: unknown): string | null => item === undefined || item === null || item === '' ? null : String(item)
    const a = value(before), b = value(after)
    rows.push({ key, label, category, before: a, after: b, changed: a !== b })
  }
  for (const [key, label] of [['model', 'Requested repository'], ['engine', 'Engine'], ['os', 'Operating system'], ['hardware', 'Hardware target'], ['file', 'Requested file'], ['context', 'Context target (tokens)'], ['port', 'Local port']] as const) add(`input.${key}`, label, 'Configuration', left.input[key], right.input[key])
  add('input.revision', 'Requested download revision', 'Configuration', (left.input as typeof left.input & { revision?: string }).revision, (right.input as typeof right.input & { revision?: string }).revision)
  for (const [key, label] of [['repositoryId', 'Observed repository'], ['sourceModelId', 'Source model'], ['path', 'Observed file'], ['revision', 'Observed revision'], ['sizeBytes', 'Observed file size (bytes)']] as const) add(`artifact.${key}`, label, 'Observed artifact', left.artifact?.[key], right.artifact?.[key])
  for (const [key, label] of [['runtimeVersion', 'Reported runtime version'], ['hardwareLabel', 'Reported hardware'], ['outcome', 'Reported outcome'], ['notes', 'Private notes'], ['firstError', 'First error summary']] as const) add(key, label, 'User report', left[key], right[key])
  add('id', 'Record ID', 'Record metadata', left.id, right.id)
  add('savedAt', 'Saved at', 'Record metadata', left.savedAt, right.savedAt)
  add('artifact.checkedAt', 'Artifact checked at', 'Record metadata', left.artifact?.checkedAt, right.artifact?.checkedAt)
  return rows
}

export function exportRunDiff(left: DeploymentRun, right: DeploymentRun): string {
  // Plain text, not CSV/HTML/Markdown. JSON string escaping keeps newlines and control characters inside their field.
  const value = (text: string | null) => text === null ? '[Not recorded]' : JSON.stringify(text)
  const lines = ['sizeof.ai deployment record comparison', 'PRIVATE: includes notes and error summaries. Review before sharing.', runDiffCaveat, 'Values are quoted as JSON strings. All comparisons preserve the original case and formatting.', '']
  for (const row of compareRuns(left, right)) lines.push(`[${row.category}] ${row.label} — ${row.changed ? 'different' : 'same'}`, `  A: ${value(row.before)}`, `  B: ${value(row.after)}`)
  const body = lines.join('\n')
  if (new TextEncoder().encode(body).length > runDiffByteLimit) throw new Error('Comparison exceeds the 64 KB export limit. Nothing was exported.')
  return body
}
