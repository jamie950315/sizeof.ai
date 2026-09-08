import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import CompatibilityPage from './CompatibilityPage'
beforeEach(() => window.history.replaceState(null, '', '/compatibility'))
afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe('compatibility UI', () => {
  it('shows source links and no tested combination claim', () => { render(<CompatibilityPage />); expect(screen.getAllByRole('link', { name: 'Official source ↗' })).toHaveLength(4); expect(screen.getByText('Documented pieces are not a tested combination.')).toBeInTheDocument(); fireEvent.change(screen.getByLabelText('Execution engine'), { target: { value: 'vllm' } }); fireEvent.change(screen.getByLabelText('Operating system'), { target: { value: 'windows' } }); expect(screen.getByText('DOCUMENTED BLOCKER')).toBeInTheDocument() })
  it('invalid link blocks evidence until reset', () => { window.history.replaceState(null, '', '/compatibility?v=1'); render(<CompatibilityPage />); expect(screen.queryByText('Officially documented')).not.toBeInTheDocument(); fireEvent.click(screen.getByText('Reset check')); expect(screen.getByLabelText('Execution engine')).toBeInTheDocument() })
  it('reports clipboard errors', async () => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } }); render(<CompatibilityPage />); fireEvent.click(screen.getByText('Copy check link')); expect(await screen.findByRole('alert')).toHaveTextContent('Could not copy') })
})
