import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import RunHistoryPage from './RunHistoryPage'
import SaveRunForm from './SaveRunForm'
import { DEPLOYMENT_DEFAULTS, restoreDeployment } from './deployment'
import { createRun, mergeRuns, readRuns, runStorageKey } from './run-history'
const input = { ...DEPLOYMENT_DEFAULTS, model: 'org/model', file: 'model.gguf' }
const make = (model = input.model) => createRun({ ...input, model }, { runtimeVersion: '1', hardwareLabel: 'Laptop', outcome: 'planned', notes: '', firstError: '' })
beforeEach(() => localStorage.clear())
it('saves a user-reported record without claiming verified deployment', () => {
  render(<SaveRunForm input={input} />)
  fireEvent.change(screen.getByLabelText('Deployment notes'), { target: { value: 'Testing locally' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save configuration snapshot' }))
  expect(screen.getByRole('status')).toHaveTextContent('Snapshot saved')
  expect(readRuns()[0].notes).toBe('Testing locally')
  expect(readRuns()[0].outcome).toBe('planned')
})
it('reopens complete configuration and supports filtering, remove, and undo', () => {
  const row = make(); mergeRuns([row]); render(<RunHistoryPage />)
  const link = screen.getByRole('link', { name: 'Reopen configuration →' })
  expect(restoreDeployment(new URL(link.getAttribute('href')!, 'https://testnet.sizeof.ai').search)).toEqual(input)
  fireEvent.change(screen.getByLabelText('Filter outcome'), { target: { value: 'failed' } })
  expect(screen.getByText('No matching records')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Filter outcome'), { target: { value: 'all' } })
  fireEvent.click(screen.getByRole('button', { name: `Remove record ${row.id}` }))
  expect(readRuns()).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'Undo removal' }))
  expect(readRuns()).toEqual([row])
})
it('keeps unreadable data and requires confirmation to reset', () => {
  localStorage.setItem(runStorageKey, 'broken'); render(<RunHistoryPage />)
  expect(screen.getByRole('alert')).toHaveTextContent('Existing data has not been changed')
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(screen.getByRole('button', { name: 'Reset unreadable records' }))
  expect(localStorage.getItem(runStorageKey)).toBe('broken')
  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Reset unreadable records' }))
  expect(readRuns()).toEqual([]); confirm.mockRestore()
})
it('imports against latest writes, not the list shown before asynchronous file reading', async () => {
  const initial = make(); mergeRuns([initial]); render(<RunHistoryPage />)
  let finish!: (value: string) => void
  const text = () => new Promise<string>(resolve => { finish = resolve })
  fireEvent.change(screen.getByLabelText('Import deployment records'), { target: { files: [{ size: 1000, text }] } })
  const newer = make('org/new'); mergeRuns([newer])
  const imported = make('org/imported')
  await act(async () => finish(JSON.stringify({ version: 1, items: [imported] })))
  await waitFor(() => expect(screen.getByRole('link', { name: 'org/imported' })).toBeInTheDocument())
  expect(readRuns()).toEqual([initial, newer, imported])
})
it('shows quota errors without claiming success', () => {
  render(<SaveRunForm input={input} />)
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage quota exceeded') })
  fireEvent.click(screen.getByRole('button', { name: 'Save configuration snapshot' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Storage quota exceeded')
  expect(screen.queryByRole('status')).not.toBeInTheDocument(); spy.mockRestore()
})
