import { expect, it } from 'vitest'
import { DEPLOYMENT_DEFAULTS } from './deployment'
import type { DeploymentRun } from './run-history'
import { compareRuns, exportRunDiff, runDiffByteLimit } from './run-diff'

const make = (): DeploymentRun => ({ id: 'one', savedAt: '2026-09-08T00:00:00.000Z', input: { ...DEPLOYMENT_DEFAULTS, model: 'org/model', file: 'model.gguf' }, runtimeVersion: '', hardwareLabel: '', outcome: 'planned', notes: '', firstError: '' })
it('isolates configuration changes from timestamps and identity', () => {
  const a = make(), b = make(); b.id = 'two'; b.savedAt = '2026-09-09T00:00:00.000Z'; b.input.context = '8192'
  const changed = compareRuns(a, b).filter(row => row.changed)
  expect(changed.filter(row => row.category !== 'Record metadata').map(row => row.key)).toEqual(['input.context'])
  expect(changed.filter(row => row.category === 'Record metadata').map(row => row.key)).toEqual(['id', 'savedAt'])
})
it('separates requested revisions from observed facts and keeps absent facts unknown', () => {
  const a = make(), b = make()
  b.artifact = { repositoryId: 'org/model', sourceModelId: 'org/base', path: 'model.gguf', sizeBytes: 1024, revision: 'a'.repeat(40), checkedAt: b.savedAt }
  Object.assign(b.input, { revision: 'b'.repeat(40) })
  const rows = compareRuns(a, b)
  expect(rows.find(row => row.key === 'input.revision')?.after).toBe('b'.repeat(40))
  expect(rows.find(row => row.key === 'artifact.revision')?.after).toBe('a'.repeat(40))
  expect(rows.find(row => row.key === 'artifact.sizeBytes')).toMatchObject({ before: null, after: '1024' })
})
it('keeps case and whitespace differences rather than silently normalizing user evidence', () => {
  const a = make(), b = make(); a.hardwareLabel = 'GPU'; b.hardwareLabel = 'gpu'; b.notes = ' '
  expect(compareRuns(a, b).filter(row => row.changed).map(row => row.key)).toEqual(['hardwareLabel', 'notes'])
})
it('exports bounded inert text with no fabricated improvement and escaped note boundaries', () => {
  const a = make(), b = make(); b.outcome = 'succeeded'; b.notes = '=SUM(1,2)\n<script>alert(1)</script>'
  const result = exportRunDiff(a, b)
  expect(result).toContain('does not prove a speed or memory improvement')
  expect(result).toContain('B: "=SUM(1,2)\\n<script>alert(1)</script>"')
  expect(result).toContain('[Not recorded]')
  b.notes = 'x'.repeat(runDiffByteLimit)
  expect(() => exportRunDiff(a, b)).toThrow(/64 KB/)
})
