import { describe, expect, it, vi, afterEach } from 'vitest'
import { fetchArtifactChoices, parseArtifactChoices } from './artifact-picker'

const revision = 'a'.repeat(40)
const variant = { format: 'gguf', role: 'model', path: 'model-Q4_K_M.gguf', revision, weightSizeBytes: 1024, label: 'Q4_K_M' }
const payload = (variants: unknown[] = [variant]) => ({ id: 'Owner/Model', componentKind: 'model', modelKind: 'language', variants })
afterEach(() => vi.unstubAllGlobals())
describe('published artifact validation', () => {
  it('accepts complete exact shard manifests and rejects incomplete, misordered, duplicate or invalid-size groups', () => {
    const files = [{ path: 'model-00001-of-00002.gguf', sizeBytes: 600 }, { path: 'model-00002-of-00002.gguf', sizeBytes: 424 }]
    const split = { ...variant, path: files[0].path, files }
    expect(parseArtifactChoices(payload([split]), 'Owner/Model').artifacts[0].files).toEqual(files)
    for (const invalid of [files.slice(0, 1), [...files].reverse(), [files[0], files[0]], [files[0], { ...files[1], sizeBytes: 425 }], [files[0], { ...files[1], sizeBytes: 0 }], [files[0], { ...files[1], path: 'other-00002-of-00002.gguf' }]]) {
      expect(() => parseArtifactChoices(payload([{ ...split, files: invalid }]), 'Owner/Model')).toThrow()
    }
  })
  it('accepts canonical casing and pins actual community repository, not base model', () => {
    const result = parseArtifactChoices(payload([{ ...variant, provenance: 'community', repositoryId: 'publisher/model-GGUF' }]), 'owner/model', '2026-09-08T00:00:00.000Z')
    expect(result.artifacts[0]).toEqual({ repositoryId: 'publisher/model-GGUF', path: variant.path, revision, sizeBytes: 1024, label: 'Q4_K_M', sourceModelId: 'Owner/Model', checkedAt: '2026-09-08T00:00:00.000Z' })
  })
  it('deduplicates artifacts and excludes support files, other formats, and split groups', () => {
    const result = parseArtifactChoices(payload([variant, variant, { ...variant, path: 'model-00001-of-00003.gguf' }, { ...variant, path: 'imatrix.gguf' }, { ...variant, role: 'projector' }, { ...variant, format: 'mlx' }]), 'Owner/Model')
    expect(result.artifacts).toHaveLength(1)
    expect(result.omittedSplitFiles).toBe(1)
  })
  it.each(['../bad.gguf', 'a/../bad.gguf', 'a//bad.gguf', 'bad;echo.gguf', '/bad.gguf', 'a\\bad.gguf', 'bad%20.gguf'])('rejects unsafe path %s', path => {
    expect(() => parseArtifactChoices(payload([{ ...variant, path }]), 'Owner/Model')).toThrow('filename')
  })
  it.each([{ revision: 'main' }, { weightSizeBytes: Infinity }, { weightSizeBytes: -1 }, { label: '' }, { provenance: 'community' }, { repositoryId: null }])('rejects malformed provenance or artifact data %j', change => {
    expect(() => parseArtifactChoices(payload([{ ...variant, ...change }]), 'Owner/Model')).toThrow()
  })
  it('fails visibly on wrong/private/component models and missing lists', () => {
    expect(() => parseArtifactChoices(payload(), 'Different/model')).toThrow('identity')
    expect(() => parseArtifactChoices({ ...payload(), private: true }, 'Owner/Model')).toThrow('Private')
    expect(() => parseArtifactChoices({ ...payload(), componentKind: 'adapter' }, 'Owner/Model')).toThrow('standalone')
    expect(() => parseArtifactChoices({ ...payload(), variants: null }, 'Owner/Model')).toThrow('Invalid')
    expect(() => parseArtifactChoices(payload(Array(2001).fill(variant)), 'Owner/Model')).toThrow('oversized')
  })
  it('fetches public API only, passes cancellation and rejects stale, private, malformed and oversized responses', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload())))
    vi.stubGlobal('fetch', fetcher)
    const signal = new AbortController().signal
    expect((await fetchArtifactChoices('https://huggingface.co/Owner/Model', signal)).artifacts).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledWith('/api/models/Owner/Model', { signal })
    for (const [response, message] of [
      [new Response('{}', { headers: { 'X-Sizeof-Model-Source': 'kv-stale' } }), 'stale'],
      [new Response('{}', { status: 404 }), 'private'],
      [new Response('{}', { status: 503 }), '503'],
      [new Response('not json'), 'invalid JSON'],
      [new Response('x'.repeat(2 * 1024 * 1024 + 1)), 'too large'],
    ] as const) {
      fetcher.mockResolvedValueOnce(response)
      await expect(fetchArtifactChoices('Owner/Model', signal)).rejects.toThrow(message)
    }
  })
})
