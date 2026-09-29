import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import LibraryPage from './LibraryPage'
import { readLibrary, writeLibrary } from './library'
beforeEach(() => { localStorage.clear(); history.replaceState(null, '', '/library') })
it('saves notes and allows recovering a removed model', () => {
  render(<LibraryPage />)
  fireEvent.change(screen.getByLabelText('Save model ID or URL'), {target:{value:'org/model'}})
  fireEvent.click(screen.getByRole('button', {name:'Save model'}))
  expect(screen.getByRole('link', {name:'org/model'})).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Notes for org/model'), {target:{value:'Useful on laptop'}})
  fireEvent.blur(screen.getByLabelText('Notes for org/model'))
  fireEvent.click(screen.getByRole('button', {name:'Remove org/model'}))
  expect(screen.queryByRole('link', {name:'org/model'})).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', {name:'Undo removal'}))
  expect(screen.getByLabelText('Notes for org/model')).toHaveValue('Useful on laptop')
})
it('preserves unreadable storage rather than silently replacing it', () => {
  localStorage.setItem('sizeof-model-library-v1', 'broken')
  render(<LibraryPage />)
  expect(screen.getByRole('alert')).toHaveTextContent('Existing data has not been changed')
  expect(screen.getByRole('button', {name:'Save model'})).toBeDisabled()
  expect(screen.getByRole('button', {name:'Export backup'})).toBeDisabled()
  expect(screen.getByRole('button', {name:'Download recovery copy'})).toBeEnabled()
  expect(localStorage.getItem('sizeof-model-library-v1')).toBe('broken')
})
it('merges an asynchronous import with edits made while the file is being read', async () => {
  const addedAt = '2026-09-08T00:00:00.000Z'
  writeLibrary([{ modelId: 'org/old', notes: 'Initial', tags: '', addedAt }])
  let finishRead!: (value: string) => void
  const text = vi.fn(() => new Promise<string>(resolve => { finishRead = resolve }))
  render(<LibraryPage />)
  fireEvent.change(screen.getByLabelText('Import library backup'), { target: { files: [{ size: 500, text }] } })
  expect(text).toHaveBeenCalledOnce()
  fireEvent.change(screen.getByLabelText('Notes for org/old'), { target: { value: 'Edited while importing' } })
  fireEvent.blur(screen.getByLabelText('Notes for org/old'))
  fireEvent.change(screen.getByLabelText('Save model ID or URL'), { target: { value: 'org/new' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save model' }))
  await act(async () => finishRead(JSON.stringify({ version: 1, items: [
    { modelId: 'org/old', notes: 'Do not overwrite current notes', tags: '', addedAt },
    { modelId: 'org/imported', notes: 'Imported notes', tags: '', addedAt },
  ] })))
  await waitFor(() => expect(screen.getByRole('link', { name: 'org/imported' })).toBeInTheDocument())
  expect(readLibrary().map(row => row.modelId)).toEqual(['org/old', 'org/new', 'org/imported'])
  expect(readLibrary()[0].notes).toBe('Edited while importing')
  expect(screen.getByLabelText('Notes for org/old')).toHaveValue('Edited while importing')
})
it('requires explicit confirmation before resetting unreadable stored data', () => {
  localStorage.setItem('sizeof-model-library-v1', 'broken')
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  render(<LibraryPage />)
  fireEvent.click(screen.getByRole('button', { name: 'Reset unreadable library' }))
  expect(confirm).toHaveBeenCalledOnce()
  expect(localStorage.getItem('sizeof-model-library-v1')).toBe('broken')
  expect(screen.getByRole('button', { name: 'Save model' })).toBeDisabled()
  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Reset unreadable library' }))
  expect(readLibrary()).toEqual([])
  expect(screen.getByRole('button', { name: 'Save model' })).toBeEnabled()
  expect(screen.getByRole('status')).toHaveTextContent('Library reset')
  confirm.mockRestore()
})
