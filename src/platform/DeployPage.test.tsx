import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DeployPage from './DeployPage'
import { DEPLOYMENT_DEFAULTS, deploymentSearch } from './deployment'

describe('deployment workbench', () => {
  beforeEach(() => window.history.replaceState(null, '', '/deploy'))
  const configure = () => {
    fireEvent.change(screen.getByLabelText('Model ID or URL'), { target: { value: 'example/model' } })
    fireEvent.change(screen.getByLabelText(/Exact GGUF filename/), { target: { value: 'model.gguf' } })
  }
  it('does not fetch or execute commands and only offers a valid runbook', () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    render(<DeployPage />)
    expect(screen.queryByRole('button', { name: 'Copy runbook' })).not.toBeInTheDocument()
    configure()
    expect(screen.getByRole('button', { name: 'Copy runbook' })).toBeInTheDocument()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('surfaces incompatible hardware immediately and removes generated commands', () => {
    render(<DeployPage />)
    configure()
    fireEvent.change(screen.getByLabelText('Inference engine'), { target: { value: 'vllm' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Linux with NVIDIA CUDA')
    expect(screen.queryByRole('button', { name: 'Copy runbook' })).not.toBeInTheDocument()
  })
  it('copies successfully and reports clipboard errors truthfully', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<DeployPage />)
    configure()
    fireEvent.click(screen.getByRole('button', { name: 'Copy runbook' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Runbook copied'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('# Local deployment runbook'))
    writeText.mockRejectedValue(new Error('denied'))
    fireEvent.click(screen.getByRole('button', { name: 'Share plan' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not copy'))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
  it('restores validated URL settings', () => {
    window.history.replaceState(null, '', '/deploy?' + deploymentSearch({ ...DEPLOYMENT_DEFAULTS, model: 'example/model', file: 'model.gguf', port: '9090' }))
    render(<DeployPage />)
    expect(screen.getByLabelText('Local port')).toHaveValue('9090')
    expect(screen.getByRole('button', { name: 'Copy runbook' })).toBeInTheDocument()
  })
  it('prefills detail-page seeds but waits for an exact artifact before generating a plan', () => {
    window.history.replaceState(null, '', '/deploy?model=example%2Fmodel')
    render(<DeployPage />)
    expect(screen.getByLabelText('Model ID or URL')).toHaveValue('example/model')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy runbook' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Exact GGUF filename/), { target: { value: 'model.gguf' } })
    expect(screen.getByRole('button', { name: 'Copy runbook' })).toBeInTheDocument()
  })
  it('does not silently hide an invalid link', () => {
    window.history.replaceState(null, '', '/deploy?v=999')
    render(<DeployPage />)
    expect(screen.getByRole('alert')).toHaveTextContent('unsupported')
    fireEvent.click(screen.getByRole('button', { name: 'Reset invalid link' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(window.location.search).toBe('')
  })
  it('resets readiness checks when settings change', () => {
    render(<DeployPage />)
    configure()
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(screen.getAllByRole('checkbox')[0]).toBeChecked()
    fireEvent.change(screen.getByLabelText('Local port'), { target: { value: '9090' } })
    expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked()
  })
})
