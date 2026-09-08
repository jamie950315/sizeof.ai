import { useState } from 'react'
import { serializeCompareState } from '../lib/compare-state'
import { addLibraryModel, libraryByteLimit, mergeLibrary, parseLibrary, rawLibraryBackup, readLibrary, writeLibrary, type LibraryItem } from './library'

function downloadLibrary(items: LibraryItem[] | string) {
  const url = URL.createObjectURL(new Blob([typeof items === 'string' ? items : JSON.stringify({ version: 1, items }, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = 'sizeof-model-library.json'; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function LibraryPage() {
  const [initial] = useState(() => { try { return { items: readLibrary(), error: '' } } catch { return { items: [] as LibraryItem[], error: 'Could not read the stored library. Browser storage may be blocked or the saved data is invalid. Existing data has not been changed.' } } })
  const [items, setItems] = useState(initial.items)
  const [error, setError] = useState(initial.error)
  const [input, setInput] = useState(new URLSearchParams(window.location.search).get('model') ?? '')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [removed, setRemoved] = useState<LibraryItem | null>(null)
  const [notice, setNotice] = useState('')
  const [readable, setReadable] = useState(!initial.error)
  function persist(next: LibraryItem[]) {
    if (!readable) { setError(initial.error); return false }
    try { writeLibrary(next); setItems(next); setError(''); return true }
    catch { setError('Could not save your changes. Browser storage may be blocked or full.'); return false }
  }
  const visible = items.filter((item) => `${item.modelId} ${item.notes} ${item.tags}`.toLowerCase().includes(query.toLowerCase()))
  const compare = `/compare?${serializeCompareState({ items: selected.map((modelId) => ({ modelId, quantization: 'q4_k_m', context: 8192, kvPrecision: 'fp16', mlaCacheMode: 'expanded', vramGiB: 32, source: 'estimated', variantId: null })) })}`
  return <main className="platform-main"><p className="platform-eyebrow">YOUR RESEARCH / SAVED ON THIS BROWSER</p><h1>My model library</h1><p className="platform-lead">Keep a shortlist, add notes, and compare your next candidates. No login, no cloud sync. Export a backup before clearing browser data. Do not store API keys in notes.</p>
    {error && <p className="platform-alert" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!readable && <div className="platform-actions"><button onClick={() => { try { downloadLibrary(rawLibraryBackup()) } catch { setError('Could not export raw browser data. Browser storage may be unavailable.') } }}>Download recovery copy</button><button onClick={() => {
      if (!window.confirm('Reset this browser library? Download a recovery copy first. This replaces the stored library with an empty one.')) return
      try { writeLibrary([]); setItems([]); setReadable(true); setError(''); setNotice('Library reset. You can now import a valid backup.') } catch { setError('Could not reset browser storage.') }
    }}>Reset unreadable library</button></div>}
    <div className="library-toolbar"><form onSubmit={(event) => { event.preventDefault(); try { if (persist(addLibraryModel(items, input))) { setInput(''); setNotice('Model saved.') } } catch (e) { setError(e instanceof Error ? e.message : 'Could not add model.') } }}><label>Model ID or URL<input aria-label="Save model ID or URL" value={input} maxLength={512} onChange={(e) => setInput(e.target.value)} placeholder="Qwen/Qwen3-0.6B" /></label><button className="platform-primary" disabled={!readable}>Save model</button></form>
      <button disabled={!readable} onClick={() => { try { downloadLibrary(readLibrary()) } catch { setError('Could not download the backup.') } }}>Export backup</button>
      <label className="library-import">Import backup<input aria-label="Import library backup" type="file" accept="application/json,.json" disabled={!readable} onChange={async (e) => {
        const file = e.target.files?.[0]; e.target.value = ''; if (!file) return
        try { if (file.size > libraryByteLimit) throw new Error('Backup must be smaller than 4 MB.'); const imported = parseLibrary(JSON.parse(await file.text())); if (persist(mergeLibrary(readLibrary(), imported))) setNotice('Backup merged. Existing notes were preserved.') }
        catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not import backup.') }
      }} /></label></div>
    <div className="library-filter"><label>Filter library<input type="search" aria-label="Filter library" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search models, tags or notes" /></label><span>{items.length} / 200 saved</span>{selected.length >= 2 && <a className="platform-primary" href={compare}>Compare {selected.length} selected ↗</a>}</div>
    {removed && <p role="status">Removed {removed.modelId}. <button onClick={() => {
      try { if (persist(mergeLibrary(readLibrary(), [removed]))) setRemoved(null) }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not restore the removed model.') }
    }}>Undo removal</button></p>}
    {visible.length === 0 && <section className="platform-empty"><h2>{items.length ? 'No matching saved models' : 'Start your shortlist'}</h2><p>Save a model above or from its detail page. Select two to four saved models to compare using default settings.</p><a href="/">Explore the model index →</a></section>}
    <div className="library-list">{visible.map((item) => <article key={item.modelId} className="library-item"><div className="library-item-title"><label><input type="checkbox" aria-label={`Select ${item.modelId} for comparison`} checked={selected.includes(item.modelId)} disabled={!selected.includes(item.modelId) && selected.length >= 4} onChange={(e) => setSelected(e.target.checked ? [...selected, item.modelId] : selected.filter((id) => id !== item.modelId))} />Compare</label><h2><a href={`/${item.modelId}`}>{item.modelId}</a></h2><button aria-label={`Remove ${item.modelId}`} onClick={() => { if (persist(items.filter((row) => row.modelId !== item.modelId))) { setRemoved(item); setSelected(selected.filter((id) => id !== item.modelId)) } }}>Remove</button></div>
      <label>Tags<input aria-label={`Tags for ${item.modelId}`} maxLength={100} defaultValue={item.tags} onBlur={(e) => { if (e.target.value !== item.tags) persist(items.map((row) => row.modelId === item.modelId ? { ...row, tags: e.target.value } : row)) }} placeholder="coding, try next, laptop" /></label>
      <label>Notes<textarea aria-label={`Notes for ${item.modelId}`} maxLength={2000} defaultValue={item.notes} onBlur={(e) => { if (e.target.value !== item.notes) persist(items.map((row) => row.modelId === item.modelId ? { ...row, notes: e.target.value } : row)) }} placeholder="What did you test? Which settings worked?" /></label><div className="platform-actions"><a href={`/deploy?model=${encodeURIComponent(item.modelId)}`}>Prepare deployment →</a><a href={`/${item.modelId}`}>Inspect memory →</a></div></article>)}</div>
  </main>
}
