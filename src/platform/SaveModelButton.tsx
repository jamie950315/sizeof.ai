import { useState } from 'react'
import { translate } from '../i18n/core'
import { addLibraryModel, readLibrary, writeLibrary } from './library'

export default function SaveModelButton({ modelId }: { modelId: string }) {
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  return <><button type="button" className="btn" onClick={() => {
    try { writeLibrary(addLibraryModel(readLibrary(), modelId)); setFailed(false); setMessage('Saved to My library.') }
    catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : 'Could not save to browser storage.') }
  }}>Save to library</button>{message && (failed ? <span role="status" className="note note-warn">{translate(message)}</span> : <span role="status" className="note">{translate(message)} <a href="/library">My model library</a></span>)}</>
}
