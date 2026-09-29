import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import StatusPage, { parseDataStatus } from './StatusPage'

const region = { id: 'jp', label: 'Osaka', reachable: true, ready: true, syncHealthy: true, models: 3050000, updatedAt: '2026-09-08T12:00:00Z', generation: 'a'.repeat(64), stale: false, lastSyncAt: '2026-09-08T12:00:00Z', initialBackfillComplete: true, lastFullBackfillAt: null, error: null }
const payload = { checkedAt: '2026-09-08T12:01:00Z', regions: [region, { ...region, id: 'us', label: 'San Jose' }], alignment: 'aligned', completeness: 'not-guaranteed', coverageNote: 'Matching lists do not guarantee complete Hugging Face coverage.' }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('data status response validation', () => {
  it('accepts matching snapshots even if synchronization now needs attention', () => {
    expect(parseDataStatus({ ...payload, regions: payload.regions.map(item => ({ ...item, syncHealthy: false, stale: true })) }).alignment).toBe('aligned')
  })
  it('rejects malformed and contradictory successful responses', () => {
    for (const bad of [{}, { ...payload, completeness: 'complete' }, { ...payload, regions: [region, region] }, { ...payload, regions: [region, { ...payload.regions[1], generation: 'b'.repeat(64) }] }, { ...payload, regions: [region, { ...payload.regions[1], models: 4 }] }, { ...payload, regions: [region, { ...payload.regions[1], models: -1 }] }, { ...payload, checkedAt: 'yesterday' }, { ...payload, regions: [region, { ...payload.regions[1], ready: 'yes' }] }]) expect(() => parseDataStatus(bad)).toThrow('invalid')
  })
})
describe('data status page', () => {
  it('loads once, shows identifiers only on demand and refreshes explicitly', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(payload))))
    vi.stubGlobal('fetch', fetcher)
    render(<StatusPage />)
    expect(await screen.findByRole('heading', { name: 'Both regions share the same list' })).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe('/api/status')
    expect(screen.getByText(/not proof of zero missing/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('button', { name: 'Refresh status' })).toBeEnabled()
  })
  it('shows unknown rather than zero and never declares an unreachable machine down', async () => {
    const unavailable = { ...payload, alignment: 'unknown', regions: [region, { ...payload.regions[1], reachable: false, ready: null, models: null, generation: null, updatedAt: null, stale: null, lastSyncAt: null, syncHealthy: null, initialBackfillComplete: null }] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(unavailable))))
    render(<StatusPage />)
    expect(await screen.findByText('Search route could not be reached')).toBeInTheDocument()
    expect(screen.getByText(/not proof that its machine has stopped/)).toBeInTheDocument()
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(1)
  })
  it('removes previous success on refresh failure and exposes invalid JSON', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(payload))).mockResolvedValueOnce(new Response('not json'))
    vi.stubGlobal('fetch', fetcher)
    render(<StatusPage />)
    await screen.findByRole('heading', { name: 'Both regions share the same list' })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid JSON')
    expect(screen.queryByRole('heading', { name: 'Both regions share the same list' })).not.toBeInTheDocument()
  })
  it('cancels requests on unmount', async () => {
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_url, options) => { signal = options.signal; return new Promise(() => {}) }))
    const view = render(<StatusPage />)
    view.unmount()
    expect(signal?.aborted).toBe(true)
  })
  it('makes timeout visible and permits retry', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))))
    render(<StatusPage />)
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    expect(screen.getByRole('alert')).toHaveTextContent('timed out')
    expect(screen.getByRole('button', { name: 'Refresh status' })).toBeEnabled()
  })
})
