import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeActionResult } from './action-result.mjs'

const safeResponse = {
  schema: 'sizeof-estimate/v1',
  model: { id: 'Qwen/Qwen3.8-27B' },
  result: { state: 'estimate', estimate: { totalGiB: 18.25 } },
  disclaimer: 'Estimate only. Verify on the target runtime and hardware.',
}

const temporaryDirectories = []

async function fixture(value = safeResponse) {
  const directory = await mkdtemp(join(tmpdir(), 'sizeof-action-'))
  temporaryDirectories.push(directory)
  const resultFile = join(directory, 'result.json')
  const outputFile = join(directory, 'output')
  const summaryFile = join(directory, 'summary')
  await writeFile(resultFile, JSON.stringify(value))
  return { resultFile, outputFile, summaryFile }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('GitHub Action result boundary', () => {
  it('writes useful outputs and a summary for a valid API response', async () => {
    const files = await fixture()
    await writeActionResult({ ...files, expectedModel: 'Qwen/Qwen3.8-27B' })

    expect(await readFile(files.outputFile, 'utf8')).toBe('status=estimate\ntotal=18.25\n')
    expect(await readFile(files.summaryFile, 'utf8')).toContain('- Model: Qwen/Qwen3.8-27B')
  })

  it.each([
    [{ ...safeResponse, schema: 'attacker/v1' }, 'schema'],
    [{ ...safeResponse, result: { ...safeResponse.result, state: 'estimate\nadmin=true' } }, 'state'],
    [{ ...safeResponse, result: { state: 'estimate', estimate: { totalGiB: '18.25' } } }, 'total'],
    [{ ...safeResponse, result: { state: 'lower-bound', estimate: { totalGiB: Infinity } } }, 'total'],
    [{ ...safeResponse, model: { id: 'Qwen/Qwen3.8-27B\n## injected' } }, 'model'],
  ])('rejects an invalid or injectable response without writing outputs (%s)', async (value, expectedError) => {
    const files = await fixture(value)
    await expect(writeActionResult({ ...files, expectedModel: 'Qwen/Qwen3.8-27B' })).rejects.toThrow(expectedError)
    await expect(readFile(files.outputFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(files.summaryFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uses only validated local text and a local disclaimer in Step Summary', async () => {
    const files = await fixture({
      ...safeResponse,
      disclaimer: 'trusted?\n## injected heading\n[link](https://evil.example)\n<script>alert(1)</script>',
    })
    await writeActionResult({ ...files, expectedModel: 'Qwen/Qwen3.8-27B' })
    const summary = await readFile(files.summaryFile, 'utf8')

    expect(summary).toContain('Estimate only. Verify on the target runtime and hardware.')
    expect(summary).not.toMatch(/injected heading|evil\.example|<script>|trusted\?/)
  })

  it('accepts unavailable only without a claimed total', async () => {
    const files = await fixture({ ...safeResponse, result: { state: 'unavailable', estimate: null } })
    await writeActionResult({ ...files, expectedModel: 'Qwen/Qwen3.8-27B' })
    expect(await readFile(files.outputFile, 'utf8')).toBe('status=unavailable\ntotal=\n')
  })
})
