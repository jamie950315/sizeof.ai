import { describe, expect, it, vi } from 'vitest'
import { createModelKvKey, readFreshModelResponse, type ModelCacheNamespace } from './model-cache'

function namespaceWith(value: unknown) {
  return {
    get: async () => value,
    put: async () => undefined,
  } satisfies ModelCacheNamespace
}

describe('model KV cache', () => {
  it('uses the v4 namespace so older partial artifact data cannot shadow validated results', () => {
    expect(createModelKvKey('meta-models', 'Muse-Glimmer-30B')).toBe('model-response-v4:meta-models/Muse-Glimmer-30B')
  })
  it('ignores a cached body for a different model', async () => {
    const namespace = namespaceWith({
      version: 4,
      fetchedAt: Date.parse('2026-08-22T11:00:00Z'),
      body: JSON.stringify({ id: 'Other/Model' }),
    })

    await expect(readFreshModelResponse(
      namespace,
      'model-response-v4:Qwen/Qwen3.8-27B',
      Date.parse('2026-08-22T12:00:00Z'),
    )).resolves.toBeNull()
  })

  it.each([
    ['malformed JSON body', '{broken'],
    ['missing model id', JSON.stringify({ source: 'kv' })],
  ])('ignores a cache entry with a %s', async (_label, body) => {
    const namespace = namespaceWith({
      version: 4,
      fetchedAt: Date.parse('2026-08-22T11:00:00Z'),
      body,
    })

    await expect(readFreshModelResponse(
      namespace,
      'model-response-v4:Qwen/Qwen3.8-27B',
      Date.parse('2026-08-22T12:00:00Z'),
    )).resolves.toBeNull()
  })

  it('ignores a cache entry dated in the future', async () => {
    const namespace = namespaceWith({
      version: 4,
      fetchedAt: Date.parse('2026-08-22T12:00:01Z'),
      body: JSON.stringify({ id: 'Qwen/Qwen3.8-27B' }),
    })

    await expect(readFreshModelResponse(
      namespace,
      'model-response-v4:Qwen/Qwen3.8-27B',
      Date.parse('2026-08-22T12:00:00Z'),
    )).resolves.toBeNull()
  })

  it('treats a KV read failure as a cache miss', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const namespace = {
      get: async () => { throw new Error('KV quota unavailable') },
      put: async () => undefined,
    } satisfies ModelCacheNamespace

    try {
      await expect(readFreshModelResponse(
        namespace,
        'model-response-v4:Qwen/Qwen3.8-27B',
      )).resolves.toBeNull()
    } finally {
      errorLog.mockRestore()
    }
  })
})
