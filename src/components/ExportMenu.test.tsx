import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ExportMenu from './ExportMenu'

const input = { generatedAt: '2026-08-30T12:00:00.000Z', records: [{ model: { id: 'Qwen/Example', sourceUrl: 'https://huggingface.co/Qwen/Example' }, configuration: { quantization: '4bit', contextTokens: 8192, kvPrecision: 'fp16', mlaCacheMode: 'expanded' }, hardware: { capacityGiB: 32 }, estimate: { kind: 'estimate' as const, totalGiB: 18.5 }, evidence: [] }] }

describe('ExportMenu', () => {
  it('uses an accessible disclosure panel and restores focus on Escape', async () => {
    const user = userEvent.setup()
    render(<ExportMenu input={input} fileStem="test" />)
    const trigger = screen.getByRole('button', { name: 'Export sizing' })
    await user.click(trigger)
    expect(screen.getByRole('region', { name: 'Export sizing options' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('region', { name: 'Export sizing options' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('falls back to a real textarea copy after clipboard rejection', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<ExportMenu input={input} fileStem="test" />)
    await user.click(screen.getByRole('button', { name: 'Export sizing' }))
    await user.click(screen.getByRole('button', { name: 'Copy Markdown export' }))
    expect(writeText).toHaveBeenCalled()
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
  })
})
