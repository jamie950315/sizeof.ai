type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface HfTokenPoolEnv {
  HF_TOKEN?: string
  HF_ENTERPRISE_KEYS_ENABLED?: string
  HF_TOKEN_ENTERPRISE_1?: string
  HF_TOKEN_ENTERPRISE_2?: string
  HF_TOKEN_ENTERPRISE_3?: string
  HF_TOKEN_ENTERPRISE_4?: string
}

export interface HfTokenPool {
  readonly size: number
  readonly enterpriseKeysEnabled: boolean
  next(): string | undefined
}

const ENTERPRISE_TOKEN_KEYS = [
  'HF_TOKEN_ENTERPRISE_1',
  'HF_TOKEN_ENTERPRISE_2',
  'HF_TOKEN_ENTERPRISE_3',
  'HF_TOKEN_ENTERPRISE_4',
] as const

let rotationCursor = 0

function normalizeToken(value: string | undefined) {
  const token = value?.trim()
  return token ? token : undefined
}

export function isHfEnterpriseKeysEnabled(env: HfTokenPoolEnv) {
  return env.HF_ENTERPRISE_KEYS_ENABLED?.trim().toLowerCase() === 'true'
}

export function resolveHfTokens(env: HfTokenPoolEnv) {
  const tokens: string[] = []
  const seen = new Set<string>()
  const add = (value: string | undefined) => {
    const token = normalizeToken(value)
    if (!token || seen.has(token)) return
    seen.add(token)
    tokens.push(token)
  }

  add(env.HF_TOKEN)
  if (isHfEnterpriseKeysEnabled(env)) {
    for (const key of ENTERPRISE_TOKEN_KEYS) add(env[key])
  }
  return tokens
}

export function createHfTokenPool(env: HfTokenPoolEnv): HfTokenPool {
  const tokens = resolveHfTokens(env)
  return {
    size: tokens.length,
    enterpriseKeysEnabled: isHfEnterpriseKeysEnabled(env),
    next() {
      if (tokens.length === 0) return undefined
      const token = tokens[rotationCursor % tokens.length]
      rotationCursor += 1
      if (rotationCursor >= Number.MAX_SAFE_INTEGER) rotationCursor = 0
      return token
    },
  }
}

export function resetHfTokenRotationForTests() {
  rotationCursor = 0
}

function huggingFaceRequestUrl(input: RequestInfo | URL) {
  try {
    if (typeof input === 'string') return new URL(input)
    if (input instanceof URL) return input
    return new URL(input.url)
  } catch {
    return null
  }
}

export function isHuggingFaceRequest(input: RequestInfo | URL) {
  const url = huggingFaceRequestUrl(input)
  return url?.hostname === 'huggingface.co' || Boolean(url?.hostname.endsWith('.huggingface.co'))
}

function hasAuthorization(headers: HeadersInit) {
  if (headers instanceof Headers) return headers.has('Authorization')
  if (Array.isArray(headers)) {
    return headers.some(([name]) => name.toLowerCase() === 'authorization')
  }
  return Object.keys(headers).some((name) => name.toLowerCase() === 'authorization')
}

function withAuthorization(headers: HeadersInit | undefined, token: string): HeadersInit {
  if (!headers) return { Authorization: `Bearer ${token}` }
  if (hasAuthorization(headers)) return headers
  if (headers instanceof Headers) {
    const next = new Headers(headers)
    next.set('Authorization', `Bearer ${token}`)
    return next
  }
  if (Array.isArray(headers)) return [...headers, ['Authorization', `Bearer ${token}`]]
  return { ...headers, Authorization: `Bearer ${token}` }
}

export function createRotatingHfFetcher(fetcher: Fetcher, pool: HfTokenPool): Fetcher {
  return (input, init) => {
    if (!isHuggingFaceRequest(input) || (init?.headers && hasAuthorization(init.headers))) {
      return fetcher(input, init)
    }
    const token = pool.next()
    if (!token) return fetcher(input, init)
    return fetcher(input, { ...init, headers: withAuthorization(init?.headers, token) })
  }
}
