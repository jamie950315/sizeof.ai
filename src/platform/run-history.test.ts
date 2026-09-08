import { beforeEach, expect, it } from 'vitest'
import { DEPLOYMENT_DEFAULTS } from './deployment'
import { createRun, mergeRuns, parseRuns, readRuns, removeRun, runStorageKey, writeRuns } from './run-history'
const input = { ...DEPLOYMENT_DEFAULTS, model: 'org/model', file: 'model.gguf' }
const details = { runtimeVersion: '1.0', hardwareLabel: 'Laptop', outcome: 'planned' as const, notes: '', firstError: '' }
const make = () => createRun(input, details)

it('preserves a complete shard manifest and rejects old wrappers or wrong totals', () => {
  localStorage.clear()
  const paths = ['model-00001-of-00002.gguf', 'model-00002-of-00002.gguf']
  const shardInput = { ...input, file: paths[0], revision: 'a'.repeat(40), shardFiles: paths }
  const run = createRun(shardInput, details, { repositoryId: input.model, path: paths[0], revision: 'a'.repeat(40), sizeBytes: 30,
    sourceModelId: input.model, checkedAt: new Date().toISOString(), files: paths.map((path, index) => ({ path, sizeBytes: (index + 1) * 10 })) })
  mergeRuns([run]); expect(readRuns()[0].input.shardFiles).toEqual(paths)
  expect(readRuns()[0].artifact?.files).toHaveLength(2)
  expect(() => parseRuns({ version: 2, items: [run] })).toThrow(/version 3/)
  expect(() => createRun(shardInput, details, { ...run.artifact!, sizeBytes: 31 })).toThrow(/total/)
})

it('preserves pinned revisions and upgrades backup format without discarding legacy records', () => {
  localStorage.clear()
  const old = make()
  localStorage.setItem(runStorageKey, JSON.stringify({ version: 1, items: [old] }))
  const pinned = createRun({ ...input, revision: 'a'.repeat(40) }, details)
  mergeRuns([pinned])
  expect(readRuns()).toEqual([old, pinned])
  expect(readRuns()[1].input.revision).toBe('a'.repeat(40))
  expect(JSON.parse(localStorage.getItem(runStorageKey)!).version).toBe(3)
  expect(() => parseRuns({ version: 1, items: [pinned] })).toThrow(/version 2/)
})

it('rejects conflicting requested and observed revisions', () => {
  expect(() => createRun({ ...input, revision: 'a'.repeat(40) }, details, {
    repositoryId: input.model, path: input.file, revision: 'b'.repeat(40), sizeBytes: 1024,
    sourceModelId: input.model, checkedAt: new Date().toISOString(),
  })).toThrow(/revisions do not match/)
})
beforeEach(() => localStorage.clear())
it('saves a detached validated configuration snapshot', () => {
  const copy = { ...input }, run = createRun(copy, details)
  copy.context = '9999'
  expect(run.input.context).toBe('4096')
  mergeRuns([run]); expect(readRuns()).toEqual([run])
})
it.each(['$(evil)', '8080;id', 'NaN'])('rejects unsafe imported command inputs %s', port => {
  const run = make(); run.input.port = port
  expect(() => parseRuns({ version: 1, items: [run] })).toThrow()
})
it('does not overwrite valid existing data on malformed imports or full storage', () => {
  const rows = Array.from({ length: 100 }, make)
  writeRuns(rows)
  expect(() => mergeRuns([make()])).toThrow(/100/)
  expect(readRuns()).toEqual(rows)
  expect(() => parseRuns({ version: 4, items: [] })).toThrow()
  expect(() => parseRuns({ version: 1, items: [{ ...make(), notes: 'a'.repeat(3001) }] })).toThrow()
})
it('preserves both different versions of an ID collision and deduplicates exact copies', () => {
  const run = make(); mergeRuns([run]); mergeRuns([run]); expect(readRuns()).toHaveLength(1)
  mergeRuns([{ ...run, notes: 'Other version' }])
  expect(readRuns()).toHaveLength(2); expect(readRuns()[0]).toEqual(run)
  expect(readRuns()[1].notes).toBe('Other version'); expect(readRuns()[1].id).not.toBe(run.id)
})
it('removes against current storage and undo preserves later additions', () => {
  const one = make(), two = make(); mergeRuns([one])
  const result = removeRun(one.id); mergeRuns([two]); mergeRuns([result.removed!])
  expect(readRuns()).toEqual([two, one])
})
it('refuses mutation of unreadable data', () => {
  localStorage.setItem(runStorageKey, 'broken')
  expect(() => mergeRuns([make()])).toThrow()
  expect(localStorage.getItem(runStorageKey)).toBe('broken')
})
it('checks artifact facts against the saved model and file', () => {
  const artifact = { repositoryId: input.model, path: input.file, revision: 'a'.repeat(40), sizeBytes: 1024, sourceModelId: 'org/base', checkedAt: new Date().toISOString() }
  expect(createRun(input, details, artifact).artifact).toEqual(artifact)
  expect(() => createRun(input, details, { ...artifact, repositoryId: 'wrong/model' })).toThrow(/match/)
  expect(() => createRun(input, details, { ...artifact, sizeBytes: Infinity })).toThrow()
  expect(() => createRun(input, details, { ...artifact, revision: 'main' })).toThrow()
})
