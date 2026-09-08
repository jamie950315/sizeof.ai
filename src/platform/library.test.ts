import { beforeEach, describe, expect, it } from 'vitest'
import { addLibraryModel, libraryByteLimit, mergeLibrary, parseLibrary, readLibrary, writeLibrary } from './library'
beforeEach(() => localStorage.clear())
describe('local model library', () => {
  it('normalizes trusted URLs, deduplicates case, and round-trips notes', () => {
    let items = addLibraryModel([], 'https://huggingface.co/Qwen/Qwen3-0.6B')
    items = addLibraryModel(items, 'qwen/qwen3-0.6b')
    expect(items).toHaveLength(1)
    items[0].notes = 'Tested at 4K'; writeLibrary(items)
    expect(readLibrary()[0].notes).toBe('Tested at 4K')
  })
  it('rejects malformed and excessive imports without changing stored data', () => {
    const initial = addLibraryModel([], 'org/model'); writeLibrary(initial)
    expect(() => parseLibrary({version:1,items:[{modelId:'bad'}]})).toThrow()
    expect(() => addLibraryModel(initial, 'https://evil.test/org/model')).toThrow()
    expect(() => parseLibrary({version:1,items:Array(201).fill(initial[0])})).toThrow()
    expect(readLibrary()).toEqual(initial)
  })
  it('merges new items without overwriting existing notes', () => {
    const initial = addLibraryModel([], 'org/model'); initial[0].notes = 'Keep this'
    const imported = addLibraryModel(addLibraryModel([], 'org/model'), 'org/second')
    expect(mergeLibrary(initial, imported)).toHaveLength(2)
    expect(mergeLibrary(initial, imported)[0].notes).toBe('Keep this')
  })
  it('round-trips the largest valid Unicode notes without creating an unimportable backup', () => {
    const items = Array.from({length:200}, (_, i) => ({modelId:`org/model${i}`,notes:'漢'.repeat(2000),tags:'x'.repeat(100),addedAt:new Date().toISOString()}))
    writeLibrary(items)
    const exported = JSON.stringify({version:1,items:readLibrary()}, null, 2)
    expect(new TextEncoder().encode(exported).length).toBeLessThan(libraryByteLimit)
    expect(parseLibrary(JSON.parse(exported))).toEqual(items)
  })
})
