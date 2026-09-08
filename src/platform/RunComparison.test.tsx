import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DEPLOYMENT_DEFAULTS } from './deployment'
import type { DeploymentRun } from './run-history'
import RunComparison from './RunComparison'

const make = (): DeploymentRun => ({ id: 'one', savedAt: '2026-09-08T00:00:00.000Z', input: { ...DEPLOYMENT_DEFAULTS, model: 'org/model', file: 'model.gguf' }, runtimeVersion: '', hardwareLabel: '', outcome: 'planned', notes: '', firstError: '' })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('shows absent facts, changed fields, separate metadata and no performance inference', () => {
  const a = make(), b = make(); b.id = 'two'; b.input.context = '8192'; b.outcome = 'succeeded'
  render(<RunComparison left={a} right={b} />)
  expect(screen.getByText('2 changed fields')).toBeInTheDocument()
  expect(screen.getByText(/does not prove a speed/)).toBeInTheDocument()
  const sizeRow = screen.getByRole('row', { name: /Observed file size/ })
  expect(within(sizeRow).getAllByText('Not recorded')).toHaveLength(2)
  fireEvent.click(screen.getByRole('checkbox', { name: 'Show changed fields only' }))
  expect(screen.queryByRole('row', { name: /Observed file size/ })).not.toBeInTheDocument()
  expect(screen.getByRole('row', { name: /Record ID/ })).toBeInTheDocument()
})
it('copies only on request and includes an explicit private-note warning', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  const a = make(); a.notes = '<img src=x onerror=alert(1)>'
  render(<RunComparison left={a} right={make()} />)
  expect(writeText).not.toHaveBeenCalled()
  expect(screen.getByText(/Exports include both records/)).toBeInTheDocument()
  expect(screen.getByText(a.notes)).toBeInTheDocument()
  expect(document.querySelector('img')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Copy comparison' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Comparison copied'))
  expect(writeText).toHaveBeenCalledOnce()
})
it('reports copy rejection without claiming success', async () => {
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Clipboard permission denied')) } })
  render(<RunComparison left={make()} right={make()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Copy comparison' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Clipboard permission denied'))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})
it('reports unavailable clipboard with a download alternative', async () => {
  vi.stubGlobal('navigator', {})
  render(<RunComparison left={make()} right={make()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Copy comparison' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Use Download comparison'))
})
it('downloads plain text only on request and releases the object URL', () => {
  vi.useFakeTimers()
  const createObjectURL = vi.fn().mockReturnValue('blob:comparison'), revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }))
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  render(<RunComparison left={make()} right={make()} />)
  expect(createObjectURL).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Download comparison' }))
  expect(createObjectURL.mock.calls[0][0].type).toBe('text/plain;charset=utf-8')
  expect(click).toHaveBeenCalledOnce()
  expect(screen.getByRole('status')).toHaveTextContent('download requested')
  vi.runAllTimers()
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:comparison')
})
it('shows download failure and still releases an allocated URL', () => {
  vi.useFakeTimers()
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: vi.fn().mockReturnValue('blob:comparison'), revokeObjectURL }))
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('Download blocked') })
  render(<RunComparison left={make()} right={make()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Download comparison' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Download blocked')
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  vi.runAllTimers()
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:comparison')
})
