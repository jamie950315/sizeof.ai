import { useState } from 'react'
import { addLibraryModel, readLibrary, writeLibrary } from './library'

export default function SaveModelButton({ modelId }: { modelId: string }) {
  const [message, setMessage] = useState('')
  return <><button type="button" onClick={() => {
    try { writeLibrary(addLibraryModel(readLibrary(), modelId)); setMessage('Saved to My library.') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save to browser storage.') }
  }}>SAVE MODEL</button>{message && <span role="status">{message}</span>}</>
}
