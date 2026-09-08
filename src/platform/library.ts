import { normalizeCompareModelInput } from '../lib/compare-state'

export interface LibraryItem { modelId: string; notes: string; tags: string; addedAt: string }
const KEY = 'sizeof-model-library-v1'
export const libraryLimit = 200
export const libraryByteLimit = 4 * 1024 * 1024

export function parseLibrary(value: unknown): LibraryItem[] {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1
    || !('items' in value) || !Array.isArray(value.items) || value.items.length > libraryLimit) throw new Error('This is not a supported library backup (maximum 200 models).')
  const seen = new Set<string>()
  return value.items.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid library item.')
    const row = raw as Record<string, unknown>
    if (typeof row.modelId !== 'string' || normalizeCompareModelInput(row.modelId) !== row.modelId
      || typeof row.notes !== 'string' || row.notes.length > 2000 || typeof row.tags !== 'string' || row.tags.length > 100
      || typeof row.addedAt !== 'string' || !Number.isFinite(Date.parse(row.addedAt)) || seen.has(row.modelId.toLowerCase())) throw new Error('A library item is invalid or duplicated.')
    seen.add(row.modelId.toLowerCase())
    return { modelId: row.modelId, notes: row.notes, tags: row.tags, addedAt: row.addedAt }
  })
}

export function readLibrary(): LibraryItem[] {
  const raw = localStorage.getItem(KEY)
  if (raw === null) return []
  if (new TextEncoder().encode(raw).length > libraryByteLimit) throw new Error('Stored library is too large to read safely.')
  return parseLibrary(JSON.parse(raw))
}

export function writeLibrary(items: LibraryItem[]) {
  const validated = parseLibrary({ version: 1, items })
  const body = JSON.stringify({ version: 1, items: validated }, null, 2)
  if (new TextEncoder().encode(body).length > libraryByteLimit) throw new Error('Library backup exceeds 4 MB.')
  localStorage.setItem(KEY, body)
}

export function rawLibraryBackup() { return localStorage.getItem(KEY) ?? JSON.stringify({ version: 1, items: [] }) }

export function addLibraryModel(items: LibraryItem[], input: string): LibraryItem[] {
  const modelId = normalizeCompareModelInput(input)
  if (!modelId) throw new Error('Enter an owner/repository, Hugging Face URL, or sizeof.ai model URL.')
  if (items.some((item) => item.modelId.toLowerCase() === modelId.toLowerCase())) return items
  if (items.length >= libraryLimit) throw new Error('Your library is full. Export a backup and remove a model before adding more.')
  return [...items, { modelId, notes: '', tags: '', addedAt: new Date().toISOString() }]
}

export function mergeLibrary(existing: LibraryItem[], imported: LibraryItem[]) {
  const ids = new Set(existing.map((item) => item.modelId.toLowerCase()))
  const merged = [...existing, ...imported.filter((item) => !ids.has(item.modelId.toLowerCase()))]
  return parseLibrary({ version: 1, items: merged })
}
