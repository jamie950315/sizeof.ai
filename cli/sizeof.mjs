#!/usr/bin/env node

import { pathToFileURL } from 'node:url'

const DEFAULT_BASE_URL = 'https://testnet.sizeof.ai'
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/
const QUANTIZATIONS = new Set(['fp16', 'q8_0', 'q6_k', 'q5_k_m', 'q4_k_m', 'q3_k_m', 'q2_k', 'q1'])
const KV_PRECISIONS = new Set(['fp16', 'q8_0', 'q4_0'])
const ENGINES = new Set(['llama.cpp', 'mlx', 'vllm'])

function integer(value, name, minimum, maximum) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return number
}

function finite(value, name, maximum) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0 || number > maximum) {
    throw new Error(`${name} must be a finite value between 0 and ${maximum}`)
  }
  return number
}

function baseUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Base URL must be an absolute HTTP or HTTPS URL')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Base URL must be an HTTP or HTTPS origin without credentials, query, or fragment')
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

export function parseArgs(argv, env = process.env) {
  const args = [...argv]
  const model = args.shift()
  if (!model || !MODEL_PATTERN.test(model)) throw new Error('model must be an owner/repository path')
  const parsed = {
    model,
    quantization: null,
    context: null,
    kvPrecision: null,
    capacityGiB: null,
    engine: null,
    concurrency: null,
    json: false,
    baseUrl: baseUrl(env.SIZEOF_API_BASE || DEFAULT_BASE_URL),
  }
  while (args.length) {
    const option = args.shift()
    if (option === '--json') {
      parsed.json = true
      continue
    }
    const value = args.shift()
    if (!value) throw new Error(`${option} requires a value`)
    if (option === '--quant') {
      if (!QUANTIZATIONS.has(value)) throw new Error('quant is not supported')
      parsed.quantization = value
    } else if (option === '--context') {
      parsed.context = integer(value, 'context', 1024, 16_777_216)
      if (parsed.context % 1024 !== 0) throw new Error('context must use 1024-token steps')
    } else if (option === '--kv') {
      if (!KV_PRECISIONS.has(value)) throw new Error('kv is not supported')
      parsed.kvPrecision = value
    } else if (option === '--vram') {
      parsed.capacityGiB = finite(value, 'vram', 4096)
    } else if (option === '--engine') {
      if (!ENGINES.has(value)) throw new Error('engine is not supported')
      parsed.engine = value
    } else if (option === '--concurrency') {
      parsed.concurrency = integer(value, 'concurrency', 1, 256)
    } else if (option === '--base-url') {
      parsed.baseUrl = baseUrl(value)
    } else {
      throw new Error(`Unknown option: ${option}`)
    }
  }
  return parsed
}

export function buildEstimateUrl(options) {
  const url = new URL('api/v1/estimate', `${options.baseUrl}/`)
  url.searchParams.set('model', options.model)
  if (options.quantization) url.searchParams.set('quant', options.quantization)
  if (options.context) url.searchParams.set('context', String(options.context))
  if (options.kvPrecision) url.searchParams.set('kv', options.kvPrecision)
  if (options.capacityGiB) url.searchParams.set('vram', String(options.capacityGiB))
  if (options.engine) url.searchParams.set('engine', options.engine)
  if (options.concurrency) url.searchParams.set('concurrency', String(options.concurrency))
  return url
}

export function sanitizeRemoteError(value, maximumLength = 160) {
  if (typeof value !== 'string') return ''
  const printable = value
    .replace(/(?:\u001B\]|\u009D)[^\u0007\u001B\u009C]*(?:\u0007|\u001B\\|\u009C)?/g, '')
    .replace(/(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return Array.from(printable).slice(0, maximumLength).join('')
}

function humanOutput(result) {
  const state = String(result?.result?.state ?? 'unavailable').toUpperCase().replace('-', ' ')
  const fit = result?.result?.fit ? ` · ${result.result.fit}` : ''
  const total = Number.isFinite(result?.result?.estimate?.totalGiB)
    ? ` · ${result.result.estimate.totalGiB.toFixed(2)} GiB`
    : ''
  const evidence = Array.isArray(result?.evidence)
    ? result.evidence.slice(0, 3).map((item) => `${item.label} (${item.kind})`).join('; ')
    : 'Unavailable'
  return [
    `${result?.model?.id ?? 'Unknown model'}`,
    `${state}${fit}${total}`,
    `Evidence: ${evidence}`,
    result?.disclaimer ?? 'Estimate only.',
    '',
  ].join('\n')
}

export async function runCli(argv, dependencies = {}) {
  const stdout = dependencies.stdout ?? ((value) => process.stdout.write(value))
  const stderr = dependencies.stderr ?? ((value) => process.stderr.write(value))
  let options
  try {
    options = parseArgs(argv, dependencies.env ?? process.env)
  } catch (error) {
    stderr(`sizeof: ${error instanceof Error ? error.message : 'Invalid arguments'}\n`)
    return 2
  }
  let response
  try {
    response = await (dependencies.fetch ?? fetch)(buildEstimateUrl(options), {
      headers: { Accept: 'application/json' },
    })
  } catch {
    stderr('sizeof: Request failed (network error)\n')
    return 1
  }
  if (!response.ok) {
    let message = ''
    if (response.headers.get('Content-Type')?.includes('application/json')) {
      try {
        const body = await response.json()
        const safeError = sanitizeRemoteError(body?.error)
        if (safeError) message = `: ${safeError}`
      } catch { /* keep normalized status-only error */ }
    }
    stderr(`sizeof: Request failed (${response.status})${message}\n`)
    return 1
  }
  try {
    const result = await response.json()
    stdout(options.json ? `${JSON.stringify(result, null, 2)}\n` : humanOutput(result))
    return 0
  } catch {
    stderr('sizeof: The API returned an unreadable response\n')
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli(process.argv.slice(2))
}
