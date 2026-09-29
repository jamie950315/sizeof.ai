import { appendFile, readFile, stat } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/
const STATES = new Set(['estimate', 'lower-bound', 'unavailable'])
const LOCAL_DISCLAIMER = 'Estimate only. Verify on the target runtime and hardware.'

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function validateResponse(value, expectedModel) {
  if (!object(value) || value.schema !== 'sizeof-estimate/v1') throw new Error('schema is invalid')
  if (!MODEL_PATTERN.test(expectedModel ?? '')) throw new Error('expected model is invalid')
  if (!object(value.model) || !MODEL_PATTERN.test(value.model.id ?? '')
    || value.model.id.toLowerCase() !== expectedModel.toLowerCase()) throw new Error('model is invalid')
  if (!object(value.result) || !STATES.has(value.result.state)) throw new Error('state is invalid')
  if (typeof value.disclaimer !== 'string' || value.disclaimer.length > 2048) throw new Error('disclaimer is invalid')
  if (value.result.state === 'unavailable') {
    if (value.result.estimate !== null) throw new Error('total must be unavailable')
    return { status: value.result.state, total: null }
  }
  const total = object(value.result.estimate) ? value.result.estimate.totalGiB : null
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) throw new Error('total is invalid')
  return { status: value.result.state, total }
}

export async function writeActionResult({ resultFile, outputFile, summaryFile, expectedModel }) {
  const metadata = await stat(resultFile)
  if (metadata.size > 1024 * 1024) throw new Error('response is too large')
  const value = JSON.parse(await readFile(resultFile, 'utf8'))
  const { status, total } = validateResponse(value, expectedModel)
  await appendFile(outputFile, `status=${status}\ntotal=${total ?? ''}\n`)
  await appendFile(summaryFile, `### sizeof.ai testnet estimate\n\n- Model: ${expectedModel}\n- Status: ${status}\n- Total: ${total === null ? 'unavailable' : `${total.toFixed(2)} GiB`}\n\n${LOCAL_DISCLAIMER}\n`)
}

async function main() {
  await writeActionResult({
    resultFile: process.env.RESULT_FILE,
    outputFile: process.env.GITHUB_OUTPUT,
    summaryFile: process.env.GITHUB_STEP_SUMMARY,
    expectedModel: process.env.INPUT_MODEL,
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`Invalid sizeof.ai API response: ${error instanceof Error ? error.message : 'unknown error'}\n`)
    process.exitCode = 1
  })
}
