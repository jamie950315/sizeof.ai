import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ArtifactPicker from './ArtifactPicker'
const payload = { id: 'Owner/Model', componentKind: 'model', modelKind: 'language', variants: [{ format: 'gguf', role: 'model', path: 'Q4.gguf', label: 'Q4', revision: 'a'.repeat(40), weightSizeBytes: 1024 ** 3, repositoryId: 'Publisher/GGUF', provenance: 'community' }] }
afterEach(() => vi.unstubAllGlobals())
describe('artifact picker', () => {
  it('shows every required shard and passes the complete group to the deployment form', async () => {
    const files = [{ path: 'Q4-00001-of-00002.gguf', sizeBytes: 512 * 1024 ** 2 }, { path: 'Q4-00002-of-00002.gguf', sizeBytes: 512 * 1024 ** 2 }]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...payload, variants: [{ ...payload.variants[0], path: files[0].path, files }] }))))
    const onSelect = vi.fn()
    render(<ArtifactPicker modelInput="Owner/Model" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: 'Find GGUF files' }))
    expect(await screen.findByText('2 required shards · total 1.00 GiB')).toBeInTheDocument()
    expect(screen.getByText(files[1].path)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: `Use Publisher/GGUF/${files[0].path}` }))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ files, sizeBytes: 1024 ** 3 }))
  })
  it('waits for explicit lookup, filters results and selects actual publisher with revision', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)))
    vi.stubGlobal('fetch', fetcher)
    const onSelect = vi.fn()
    render(<ArtifactPicker modelInput="Owner/Model" onSelect={onSelect} />)
    expect(fetcher).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Find GGUF files' }))
    const use = await screen.findByRole('button', { name: 'Use Publisher/GGUF/Q4.gguf' })
    fireEvent.change(screen.getByLabelText('Filter published files'), { target: { value: 'q8' } })
    expect(screen.queryByRole('button', { name: 'Use Publisher/GGUF/Q4.gguf' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Filter published files'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: use.getAttribute('aria-label')! }))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ repositoryId: 'Publisher/GGUF', sourceModelId: 'Owner/Model', revision: 'a'.repeat(40) }))
  })
  it('cancels model changes and ignores late previous responses', async () => {
    let finish!: (value: Response) => void
    const fetcher = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve }))
    vi.stubGlobal('fetch', fetcher)
    const { rerender } = render(<ArtifactPicker modelInput="Owner/Model" onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Find GGUF files' }))
    const signal = fetcher.mock.calls[0][1].signal
    rerender(<ArtifactPicker modelInput="Other/New" onSelect={vi.fn()} />)
    expect(signal.aborted).toBe(true)
    finish(new Response(JSON.stringify(payload)))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Find GGUF files' })).toBeEnabled())
    expect(screen.queryByRole('button', { name: /Use Publisher/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('shows upstream errors without an empty-success message and allows retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })))
    render(<ArtifactPicker modelInput="Owner/Model" onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Find GGUF files' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('503')
    expect(screen.queryByText(/No supported single-file/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Find GGUF files' })).toBeEnabled()
  })
})
