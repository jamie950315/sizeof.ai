import { afterEach, describe, expect, it } from 'vitest'
import {
  clearSearchCacheForTests,
  createSearchCacheKey,
  readSearchCache,
  writeSearchCache,
} from './model-search-cache'

const sample = {
  query: 'QWEN',
  nextCursor: null,
  models: [{
    id: 'Qwen/Qwen3.8-27B', owner: 'Qwen', name: 'Qwen3.8-27B',
    downloads: 1, likes: 1, task: 'text-generation', trendingScore: 1, gated: false,
  }],
}

afterEach(() => {
  clearSearchCacheForTests()
})

describe('model search cache', () => {
  it('stores names and links without keeping architecture fields', () => {
    const key = createSearchCacheKey({ query: 'QWEN' })
    writeSearchCache(key, sample)
    expect(readSearchCache(key)).toEqual(sample)
    expect(JSON.stringify(readSearchCache(key))).not.toMatch(/layers|kvHeads|parametersB|HF_TOKEN/)
  })

  it('reuses the same key for identical query and filters', () => {
    expect(createSearchCacheKey({ query: 'QWEN', author: 'Qwen', modelType: 'text-generation' }))
      .toBe(createSearchCacheKey({ query: 'QWEN', author: ' Qwen ', modelType: 'text-generation' }))
    expect(createSearchCacheKey({ query: 'QWEN', author: 'Qwen' }))
      .not.toBe(createSearchCacheKey({ query: 'QWEN' }))
  })
})
