import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import HardwarePage from './HardwarePage'

describe('hardware lab', () => {
  beforeEach(() => window.history.replaceState(null, '', '/hardware'))
  it('calculates budget and flags malformed inputs immediately', () => {
    render(<HardwarePage />)
    expect(screen.getByRole('heading', { name: 'Hardware lab.' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Memory per device (GiB)'), { target: { value: '' } })
    expect(screen.getByRole('alert')).toHaveTextContent('enter a finite')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
  it('allows memory layouts and preserves inputs between tools', () => {
    render(<HardwarePage />)
    fireEvent.change(screen.getByLabelText('Memory layout'), { target: { value: 'multi' } })
    fireEvent.change(screen.getByLabelText(/Device count/), { target: { value: '4' } })
    expect(screen.getByText(/Summed memory is not one large GPU/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Storage & download/ }))
    expect(screen.getByLabelText('Size source')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Memory budget/ }))
    expect(screen.getByLabelText(/Device count/)).toHaveValue('4')
  })
  it('exposes invalid shared links instead of showing plausible default output', () => {
    window.history.replaceState(null, '', '/hardware?memory=bogus')
    render(<HardwarePage />)
    expect(screen.getByRole('alert')).toHaveTextContent('Unknown memory layout')
    expect(screen.queryByRole('region', { name: 'Planning results' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reset plan' }))
    expect(screen.getByRole('region', { name: 'Planning results' })).toBeInTheDocument()
  })
  it('does not claim copying succeeded when the clipboard rejects', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    render(<HardwarePage />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy planning link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not copy. denied')
  })
  it('shares a reproducible worksheet link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<HardwarePage />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy planning link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/hardware?memory=dedicated&capacity=24')))
    expect(await screen.findByRole('status')).toHaveTextContent('Planning link copied')
  })
  it('refuses an export with invalid values instead of downloading a default plan', () => {
    render(<HardwarePage />)
    fireEvent.change(screen.getByLabelText('Memory per device (GiB)'), { target: { value: 'broken' } })
    fireEvent.click(screen.getByRole('button', { name: 'Export worksheet' }))
    expect(screen.getAllByRole('alert').some(item => item.textContent?.includes('Could not export.'))).toBe(true)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
  it('shows no-payback scenarios and rejects impossible daily hours', () => {
    render(<HardwarePage />)
    fireEvent.click(screen.getByRole('button', { name: /Running costs/ }))
    fireEvent.change(screen.getByLabelText(/Blended API price per million tokens/), { target: { value: '0' } })
    expect(screen.getByText('Not reached')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Hours per day/), { target: { value: '25' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Hours per day')
  })
})
