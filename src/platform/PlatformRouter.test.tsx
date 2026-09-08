import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import PlatformRouter, { WorkspaceBoundary } from './PlatformRouter'
it('provides a complete entry point without loading model metadata', () => {
  history.replaceState(null, '', '/start')
  render(<PlatformRouter />)
  expect(screen.getByRole('heading', {level:1})).toHaveTextContent('working plan')
  expect(screen.getByRole('navigation', {name:'Platform navigation'})).toBeInTheDocument()
  expect(screen.getByRole('link', {name:'Build a deployment plan ↗'})).toHaveAttribute('href','/deploy')
})
it('shows failed workspace loads instead of silently substituting results', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const Broken = (): never => { throw new Error('chunk failed') }
  render(<WorkspaceBoundary><Broken /></WorkspaceBoundary>)
  expect(screen.getByRole('alert')).toHaveTextContent('Workspace could not load')
  expect(screen.getByRole('button', {name:'Reload workspace'})).toBeInTheDocument()
  consoleError.mockRestore()
})
