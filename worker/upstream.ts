/** Errors in upstream data are distinct from bugs in our own code. */
export class UpstreamError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'UpstreamError'
  }
}

/** HF artifact URLs redirect to signed CDN URLs. Never forward credentials there. */
export async function fetchWithSafeRedirects(
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  let current = input
  let options = { ...init, redirect: 'manual' as const }
  for (let hop = 0; hop <= 5; hop += 1) {
    const response = await fetcher(current, options)
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const from = new URL(current instanceof Request ? current.url : String(current))
    const location = response.headers.get('Location')
    await response.body?.cancel()
    if (!location || hop === 5) throw new UpstreamError('Invalid or excessive upstream redirects')
    const next = new URL(location, from)
    if (next.protocol !== 'https:' || next.username || next.password) throw new UpstreamError('Unsafe upstream redirect')
    const headers = new Headers(options.headers ?? (current instanceof Request ? current.headers : undefined))
    if (next.origin !== from.origin) {
      headers.delete('Authorization')
      headers.delete('Cookie')
      headers.delete('Proxy-Authorization')
    }
    current = next.toString()
    options = { ...options, headers }
  }
  throw new UpstreamError('Upstream redirect limit exceeded')
}

export async function readBoundedBody(response: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('Content-Length'))
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel()
    throw new UpstreamError('Upstream response exceeds the size limit')
  }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new UpstreamError('Upstream response exceeds the size limit')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

export async function readUpstreamJson(response: Response): Promise<unknown> {
  const bytes = await readBoundedBody(response, 4 * 1024 * 1024)
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    throw new UpstreamError('Upstream returned invalid JSON')
  }
}
