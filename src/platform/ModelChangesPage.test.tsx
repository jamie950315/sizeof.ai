import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ModelChangesPage from './ModelChangesPage'
const before = 'a'.repeat(40), after = 'b'.repeat(40)
const fixture = () => ({ modelId: 'owner/model', checkedAt: '2026-09-08T00:00:00Z', before: { revision: before, files: 2, configAvailable: true, license: 'apache-2.0' }, after: { revision: after, files: 3, configAvailable: true, license: null }, listingComplete: true, unknownContentFiles: 1, files: [{ path: 'weights.gguf', change: 'modified', beforeBytes: 1024, afterBytes: 2048 }, { path: 'unknown.txt', change: 'unknown', beforeBytes: 10, afterBytes: 10 }, { path: 'new.json', change: 'added', beforeBytes: null, afterBytes: 0 }], facts: [{ field: 'architectures', before: 'Old', after: 'New' }], notes: ['Not a performance measurement.'] })
function setup() { fireEvent.change(screen.getByLabelText('Model ID or model URL'), { target: { value: 'https://huggingface.co/owner/model' } }); fireEvent.change(screen.getByLabelText('Earlier revision'), { target: { value: before } }) }
function submit() { fireEvent.click(screen.getByRole('button', { name: 'Compare revisions' })) }
beforeEach(() => window.history.replaceState(null, '', '/model-changes'))
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
it('seeds link inputs without fetching, then compares locked revisions with unknowns visible', async () => {
  window.history.replaceState(null, '', `/model-changes?model=owner/model&before=${before}`)
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture()))); vi.stubGlobal('fetch', fetcher)
  render(<ModelChangesPage />); expect(fetcher).not.toHaveBeenCalled(); submit()
  await screen.findByRole('region', { name: 'Revision comparison' })
  expect(fetcher.mock.calls[0][0]).toBe(`/api/model-changes?model=owner%2Fmodel&before=${before}`)
  expect(screen.getByText('Content unknown')).toBeVisible(); expect(screen.getByText(/Unknown does not mean unchanged/)).toBeVisible()
  expect(screen.getByText('Earlier: 1 KiB → Later: 2 KiB')).toBeVisible()
  expect(screen.getByRole('link', { name: /Inspect later/ })).toHaveAttribute('href', `https://huggingface.co/owner/model/tree/${after}`)
  fireEvent.change(screen.getByLabelText('Change type'), { target: { value: 'added' } }); expect(screen.queryByText('weights.gguf')).not.toBeInTheDocument(); expect(screen.getByText('new.json')).toBeVisible()
  expect(screen.getByText('Earlier: Unknown / not present → Later: 0 B')).toBeVisible()
})
it('validates before network access', () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); render(<ModelChangesPage />)
  setup(); fireEvent.change(screen.getByLabelText('Earlier revision'), { target: { value: 'main' } }); submit()
  expect(screen.getByRole('alert')).toHaveTextContent('40-character'); expect(fetcher).not.toHaveBeenCalled()
})
it.each(['modelId', 'before', 'after', 'listingComplete'])('rejects mismatched %s response', async field => {
  const data = fixture()
  const bad = { ...data, [field]: field === 'modelId' ? 'different/model' : field === 'listingComplete' ? false : { ...data[field as 'before' | 'after'], revision: 'c'.repeat(40) } }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(bad))))
  render(<ModelChangesPage />); setup(); fireEvent.change(screen.getByLabelText('Later revision (optional)'), { target: { value: after } }); submit()
  expect(await screen.findByRole('alert')).toHaveTextContent('incomplete or mismatched'); expect(screen.queryByRole('region')).not.toBeInTheDocument()
})
it('shows HTTP errors and clears previous results when edited', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(fixture()))).mockResolvedValueOnce(new Response('{}', { status: 503 })); vi.stubGlobal('fetch', fetcher)
  render(<ModelChangesPage />); setup(); submit(); await screen.findByRole('region'); fireEvent.change(screen.getByLabelText('Earlier revision'), { target: { value: 'c'.repeat(40) } }); expect(screen.queryByRole('region')).not.toBeInTheDocument(); submit()
  expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 503')
})
it('ignores a stale request even when its mocked fetch ignores abort', async () => {
  let resolve!: (response: Response) => void
  const fetcher = vi.fn().mockImplementation(() => new Promise<Response>(r => { resolve = r })); vi.stubGlobal('fetch', fetcher)
  render(<ModelChangesPage />); setup(); submit(); const signal = fetcher.mock.calls[0][1].signal as AbortSignal
  fireEvent.change(screen.getByLabelText('Model ID or model URL'), { target: { value: 'other/model' } }); expect(signal.aborted).toBe(true)
  await act(async () => { resolve(new Response(JSON.stringify(fixture()))) }); expect(screen.queryByRole('region')).not.toBeInTheDocument(); expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
it('times out after 45 seconds without waiting for an uncooperative fetch', async () => {
  vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(() => {})))
  render(<ModelChangesPage />); setup(); submit(); act(() => vi.advanceTimersByTime(45000))
  expect(screen.getByRole('alert')).toHaveTextContent('timed out after 45'); expect(screen.getByRole('button', { name: 'Compare revisions' })).toBeEnabled()
})
it('aborts on unmount and rejects stale, malformed or oversized bodies', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', { headers: { 'X-Sizeof-Model-Source': 'kv-stale' } })).mockResolvedValueOnce(new Response('not json')).mockResolvedValueOnce(new Response('{}', { headers: { 'Content-Length': '3000000' } })); vi.stubGlobal('fetch', fetcher)
  const view = render(<ModelChangesPage />); setup(); submit(); expect(await screen.findByRole('alert')).toHaveTextContent('Stale'); submit(); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('invalid JSON')); submit(); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('too large'))
  view.unmount(); expect(fetcher.mock.calls[2][1].signal.aborted).toBe(true)
})
