import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ContextBudgetPage from './ContextBudgetPage'
beforeEach(() => window.history.replaceState(null, '', '/context'))
afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe('context budget UI', () => {
  it('shows overflow and blocks unknown input', () => { render(<ContextBudgetPage />); fireEvent.change(screen.getByLabelText('Configured context limit'), { target: { value: '100' } }); expect(screen.getByText('Over budget')).toBeInTheDocument(); fireEvent.change(screen.getByLabelText('Current user message'), { target: { value: '' } }); expect(screen.getByRole('button', { name: 'Copy budget link' })).toBeDisabled(); expect(screen.getByRole('alert')).toHaveTextContent('whole token count') })
  it('invalid links show no calculation until reset', () => { window.history.replaceState(null, '', '/context?v=99'); render(<ContextBudgetPage />); expect(screen.queryByText('Remaining capacity')).not.toBeInTheDocument(); fireEvent.click(screen.getByText('Reset budget')); expect(screen.getByText('Remaining capacity')).toBeInTheDocument() })
  it('shows clipboard failure explicitly', async () => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } }); render(<ContextBudgetPage />); fireEvent.click(screen.getByText('Copy budget link')); expect(await screen.findByRole('alert')).toHaveTextContent('Could not copy') })
})
