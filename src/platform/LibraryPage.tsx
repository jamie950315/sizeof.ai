import { useState, type CSSProperties } from 'react'
import { translate } from '../i18n/core'
import { serializeCompareState } from '../lib/compare-state'
import { addLibraryModel, libraryByteLimit, libraryLimit, mergeLibrary, parseLibrary, rawLibraryBackup, readLibrary, writeLibrary, type LibraryItem } from './library'
import './keep.css'
import './library.css'

function downloadLibrary(items: LibraryItem[] | string) {
  const url = URL.createObjectURL(new Blob([typeof items === 'string' ? items : JSON.stringify({ version: 1, items }, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = 'sizeof-model-library.json'; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function addedDate(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : value
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
  const fill = { '--fill': Math.min(1, items.length / libraryLimit) } as CSSProperties

  return <main className="page library-page">
    <header className="page-head">
      <h1>My model library</h1>
      <p className="lede">Keep a shortlist, add notes, and compare your next candidates. No login, no cloud sync. Export a backup before clearing browser data. Do not store API keys in notes.</p>
    </header>

    <div className="keep-messages">
      {error && <p className="callout callout-error" role="alert">{translate(error)}</p>}
      {notice && <p className="keep-status" role="status">{translate(notice)}</p>}
      {!readable && <div className="keep-recovery">
        <button type="button" className="keep-quiet" onClick={() => { try { downloadLibrary(rawLibraryBackup()) } catch { setError('Could not export raw browser data. Browser storage may be unavailable.') } }}>Download recovery copy</button>
        <button type="button" className="keep-danger keep-danger-solid" onClick={() => {
          if (!window.confirm('Reset this browser library? Download a recovery copy first. This replaces the stored library with an empty one.')) return
          try { writeLibrary([]); setItems([]); setReadable(true); setError(''); setNotice('Library reset. You can now import a valid backup.') } catch { setError('Could not reset browser storage.') }
        }}>Reset unreadable library</button>
      </div>}
    </div>

    <section className="library-intake">
      <form className="library-add" onSubmit={(event) => { event.preventDefault(); try { if (persist(addLibraryModel(items, input))) { setInput(''); setNotice('Model saved.') } } catch (e) { setError(e instanceof Error ? e.message : 'Could not add model.') } }}>
        <label className="field"><span>Model ID or URL</span><input aria-label="Save model ID or URL" value={input} maxLength={512} onChange={(e) => setInput(e.target.value)} placeholder="Qwen/Qwen3-0.6B" /></label>
        <button className="btn btn-primary" disabled={!readable}>Save model</button>
      </form>
      <div className="library-store">
        <span className="keep-count" style={fill}>{items.length} / 200 saved</span>
        <div className="keep-backup">
          <button type="button" className="keep-quiet" disabled={!readable} onClick={() => { try { downloadLibrary(readLibrary()) } catch { setError('Could not download the backup.') } }}>Export backup</button>
          <label className="keep-file">Import backup<input aria-label="Import library backup" type="file" accept="application/json,.json" disabled={!readable} onChange={async (e) => {
            const file = e.target.files?.[0]; e.target.value = ''; if (!file) return
            try { if (file.size > libraryByteLimit) throw new Error('Backup must be smaller than 4 MB.'); const imported = parseLibrary(JSON.parse(await file.text())); if (persist(mergeLibrary(readLibrary(), imported))) setNotice('Backup merged. Existing notes were preserved.') }
            catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not import backup.') }
          }} /></label>
        </div>
      </div>
    </section>

    <section className="library-shelf">
      <div className="library-toolbar">
        <label className="field library-filter"><span>Filter library</span><input type="search" aria-label="Filter library" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search models, tags or notes" /></label>
        {selected.length >= 2 && <a className="btn btn-tape" href={compare}>Compare {selected.length} selected</a>}
      </div>

      {removed && <p className="keep-status library-undo" role="status">Removed {removed.modelId}. <button type="button" onClick={() => {
        try { if (persist(mergeLibrary(readLibrary(), [removed]))) setRemoved(null) }
        catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not restore the removed model.') }
      }}>Undo removal</button></p>}

      {visible.length === 0 && <section className="keep-empty"><h2>{items.length ? 'No matching saved models' : 'Start your shortlist'}</h2><p>Save a model above or from its detail page. Select two to four saved models to compare using default settings.</p><a href="/">Explore the model index</a></section>}

      {visible.length > 0 && <ol className="library-ledger">{visible.map((item) => <li key={item.modelId} className="library-entry">
        <label className="library-pick"><input type="checkbox" aria-label={`Select ${item.modelId} for comparison`} checked={selected.includes(item.modelId)} disabled={!selected.includes(item.modelId) && selected.length >= 4} onChange={(e) => setSelected(e.target.checked ? [...selected, item.modelId] : selected.filter((id) => id !== item.modelId))} /><span>Compare</span></label>
        <time className="library-date" dateTime={item.addedAt}>{addedDate(item.addedAt)}</time>
        <div className="library-body">
          <h2><a href={`/${item.modelId}`}>{item.modelId}</a></h2>
          <div className="library-fields">
            <label className="field"><span>Tags</span><input aria-label={`Tags for ${item.modelId}`} maxLength={100} defaultValue={item.tags} onBlur={(e) => { if (e.target.value !== item.tags) persist(items.map((row) => row.modelId === item.modelId ? { ...row, tags: e.target.value } : row)) }} placeholder="coding, try next, laptop" /></label>
            <label className="field"><span>Notes</span><textarea aria-label={`Notes for ${item.modelId}`} maxLength={2000} rows={2} defaultValue={item.notes} onBlur={(e) => { if (e.target.value !== item.notes) persist(items.map((row) => row.modelId === item.modelId ? { ...row, notes: e.target.value } : row)) }} placeholder="What did you test? Which settings worked?" /></label>
          </div>
        </div>
        <div className="library-actions">
          <div className="keep-links"><a href={`/${item.modelId}`}>Inspect memory</a><a href={`/deploy?model=${encodeURIComponent(item.modelId)}`}>Prepare deployment</a></div>
          <button type="button" className="keep-danger" aria-label={`Remove ${item.modelId}`} onClick={() => { if (persist(items.filter((row) => row.modelId !== item.modelId))) { setRemoved(item); setSelected(selected.filter((id) => id !== item.modelId)) } }}>Remove</button>
        </div>
      </li>)}</ol>}
    </section>
  </main>
}
