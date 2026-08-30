#!/usr/bin/env node

import { pathToFileURL } from 'node:url'
import { Server } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'

const DEFAULT_BASE_URL = 'https://testnet.sizeof.ai'
const MODEL_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,95}/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$'
const MODEL_REGEX = new RegExp(MODEL_PATTERN)
const QUANTIZATIONS = ['fp16', 'q8_0', 'q6_k', 'q5_k_m', 'q4_k_m', 'q3_k_m', 'q2_k', 'q1']
const KV_PRECISIONS = ['fp16', 'q8_0', 'q4_0']
const ENGINES = ['llama.cpp', 'mlx', 'vllm']

const commonProperties = {
  quant: { type: 'string', enum: QUANTIZATIONS, default: 'q4_k_m' },
  context: { type: 'integer', minimum: 1024, maximum: 16_777_216, multipleOf: 1024, default: 4096 },
  kv: { type: 'string', enum: KV_PRECISIONS, default: 'fp16' },
  vram: { type: 'number', exclusiveMinimum: 0, maximum: 4096, default: 32 },
  engine: { type: 'string', enum: ENGINES },
  concurrency: { type: 'integer', minimum: 1, maximum: 256, default: 1 },
}

export const TOOL_DEFINITIONS = [
  {
    name: 'estimate',
    description: 'Estimate conservative model memory from public repository facts.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['model'],
      properties: { model: { type: 'string', pattern: MODEL_PATTERN, maxLength: 193 }, ...commonProperties },
    },
  },
  {
    name: 'compare',
    description: 'Compare two to four public models with the same bounded configuration.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['models'],
      properties: {
        models: { type: 'array', minItems: 2, maxItems: 4, uniqueItems: true, items: { type: 'string', pattern: MODEL_PATTERN, maxLength: 193 } },
        ...commonProperties,
      },
    },
  },
  {
    name: 'find_fit',
    description: 'Return inverse-planner fit options for one model and memory capacity.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['model', 'vram'],
      properties: { model: { type: 'string', pattern: MODEL_PATTERN, maxLength: 193 }, ...commonProperties },
    },
  },
]

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null
}

function validateBaseUrl(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('SIZEOF_API_BASE must be an absolute HTTP or HTTPS URL') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('SIZEOF_API_BASE must not contain credentials, query, or fragment')
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

function validateCommon(args, allowed) {
  const value = record(args)
  if (!value) throw new Error('arguments must be an object')
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`Unknown argument: ${key}`)
  if (value.quant !== undefined && !QUANTIZATIONS.includes(value.quant)) throw new Error('quant is not supported')
  if (value.kv !== undefined && !KV_PRECISIONS.includes(value.kv)) throw new Error('kv is not supported')
  if (value.engine !== undefined && !ENGINES.includes(value.engine)) throw new Error('engine is not supported')
  if (value.context !== undefined && (!Number.isSafeInteger(value.context) || value.context < 1024 || value.context > 16_777_216 || value.context % 1024 !== 0)) throw new Error('context is outside the supported 1024-token steps')
  if (value.vram !== undefined && (!Number.isFinite(value.vram) || value.vram <= 0 || value.vram > 4096)) throw new Error('vram is outside the supported range')
  if (value.concurrency !== undefined && (!Number.isSafeInteger(value.concurrency) || value.concurrency < 1 || value.concurrency > 256)) throw new Error('concurrency is outside the supported range')
  return value
}

function validateModel(value) {
  if (typeof value !== 'string' || !MODEL_REGEX.test(value)) throw new Error('model must be an owner/repository path')
  return value
}

function validateArguments(name, args) {
  if (name === 'compare') {
    const value = validateCommon(args, new Set(['models', 'quant', 'context', 'kv', 'vram', 'engine', 'concurrency']))
    if (!Array.isArray(value.models) || value.models.length < 2 || value.models.length > 4) throw new Error('compare requires 2 to 4 models')
    const models = value.models.map(validateModel)
    if (new Set(models.map((model) => model.toLowerCase())).size !== models.length) throw new Error('compare models must be unique')
    return { ...value, models }
  }
  if (name === 'estimate' || name === 'find_fit') {
    const allowed = new Set(['model', 'quant', 'context', 'kv', 'vram', 'engine', 'concurrency'])
    const value = validateCommon(args, allowed)
    if (name === 'find_fit' && value.vram === undefined) throw new Error('find_fit requires vram')
    return { ...value, model: validateModel(value.model) }
  }
  throw new Error(`Unknown tool: ${name}`)
}

function estimateUrl(baseUrl, model, args) {
  const url = new URL('api/v1/estimate', `${baseUrl}/`)
  url.searchParams.set('model', model)
  for (const [argument, parameter] of [['quant', 'quant'], ['context', 'context'], ['kv', 'kv'], ['vram', 'vram'], ['engine', 'engine'], ['concurrency', 'concurrency']]) {
    if (args[argument] !== undefined) url.searchParams.set(parameter, String(args[argument]))
  }
  return url
}

async function requestEstimate(model, args, runtime) {
  let response
  try {
    response = await runtime.fetch(estimateUrl(runtime.baseUrl, model, args), { headers: { Accept: 'application/json' } })
  } catch {
    return { ok: false, model, status: 502, error: 'Estimate service is temporarily unavailable' }
  }
  let body = null
  if (response.headers.get('Content-Type')?.includes('application/json')) {
    try { body = await response.json() } catch { /* normalized below */ }
  }
  if (!response.ok) {
    const error = typeof body?.error === 'string' && body.error.length <= 200 ? body.error : `Request failed (${response.status})`
    return { ok: false, model, status: response.status, error }
  }
  if (!record(body) || body.schema !== 'sizeof-estimate/v1') return { ok: false, model, status: 502, error: 'The estimate API returned an unreadable response' }
  return { ok: true, value: body }
}

function summary(value) {
  const state = String(value.result?.state ?? 'unavailable').replace('-', ' ')
  const total = Number.isFinite(value.result?.estimate?.totalGiB) ? `, ${value.result.estimate.totalGiB.toFixed(2)} GiB` : ''
  return `${value.model?.id ?? 'Unknown model'}: ${state}${total}. ${value.disclaimer}`
}

export async function callTool(name, args, dependencies = {}) {
  const validated = validateArguments(name, args)
  const runtime = {
    fetch: dependencies.fetch ?? fetch,
    baseUrl: validateBaseUrl(dependencies.baseUrl ?? process.env.SIZEOF_API_BASE ?? DEFAULT_BASE_URL),
  }
  if (name === 'estimate') {
    const result = await requestEstimate(validated.model, validated, runtime)
    if (!result.ok) throw new Error(result.error)
    return { content: [{ type: 'text', text: summary(result.value) }], structuredContent: result.value }
  }
  if (name === 'find_fit') {
    const result = await requestEstimate(validated.model, validated, runtime)
    if (!result.ok) throw new Error(result.error)
    const value = {
      schema: 'sizeof-fit/v1', model: result.value.model, configuration: result.value.configuration,
      hardware: result.value.hardware, planner: result.value.planner,
      evidence: result.value.evidence, disclaimer: result.value.disclaimer,
    }
    return { content: [{ type: 'text', text: `${summary(result.value)} Inverse planner results are included.` }], structuredContent: value }
  }
  const results = await Promise.all(validated.models.map((model) => requestEstimate(model, validated, runtime)))
  const structuredContent = {
    schema: 'sizeof-compare/v1',
    results: results.filter((result) => result.ok).map((result) => result.value),
    failures: results.filter((result) => !result.ok).map(({ model, status, error }) => ({ model, status, error })),
    disclaimer: results.find((result) => result.ok)?.value.disclaimer ?? 'Estimate only. Verify on the target runtime and hardware.',
  }
  return {
    content: [{ type: 'text', text: `Compared ${structuredContent.results.length} model(s); ${structuredContent.failures.length} unavailable. ${structuredContent.disclaimer}` }],
    structuredContent,
  }
}

export function createMcpServer(dependencies = {}) {
  const server = new Server({ name: 'sizeof-ai-testnet', version: '0.1.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler('tools/list', async () => ({ tools: TOOL_DEFINITIONS }))
  server.setRequestHandler('tools/call', async (request) => {
    try {
      return await callTool(request.params.name, request.params.arguments ?? {}, dependencies)
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: error instanceof Error ? error.message : 'Tool call failed' }],
      }
    }
  })
  return server
}

export async function runStdioServer(dependencies = {}) {
  const server = createMcpServer(dependencies)
  await server.connect(new StdioServerTransport())
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runStdioServer()
}
