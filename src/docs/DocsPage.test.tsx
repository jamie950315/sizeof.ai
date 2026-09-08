import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DocsPage from './DocsPage'
import { docHref, docsArticles, docsBasePath, findDocArticle, searchDocs } from './content'

afterEach(() => vi.restoreAllMocks())

describe('documentation content integrity', () => {
  it('contains substantive source-linked articles with unique routes, sections and valid related links', () => {
    expect(docsArticles.length).toBeGreaterThanOrEqual(16)
    expect(new Set(docsArticles.map((item) => item.slug)).size).toBe(docsArticles.length)
    for (const article of docsArticles) {
      expect(article.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      expect(article.description.length).toBeGreaterThan(35)
      expect(article.sections.length).toBeGreaterThanOrEqual(3)
      expect(new Set(article.sections.map((item) => item.id)).size).toBe(article.sections.length)
      expect(article.sections.flatMap((item) => item.paragraphs).join(' ').length).toBeGreaterThan(900)
      expect(article.sources.length).toBeGreaterThan(0)
      for (const source of article.sources) expect(new URL(source.url).protocol).toBe('https:')
      for (const related of article.related) expect(findDocArticle(related)).toBeDefined()
    }
  })

  it('matches all query terms across article body with case and whitespace normalization', () => {
    expect(searchDocs('  MEMORY    DISCRETE  ').map((item) => item.slug)).toContain('hardware')
    expect(searchDocs('importance matrix').map((item) => item.slug)).toContain('model-files')
    expect(searchDocs('nonexistent-phrase')).toEqual([])
    expect(searchDocs('')).toHaveLength(docsArticles.length)
    expect(searchDocs('memory', 'Advanced').every((item) => item.level === 'Advanced')).toBe(true)
  })

  it('keeps docs-host and testnet links independent', () => {
    expect(docsBasePath('docs.sizeof.ai')).toBe('')
    expect(docsBasePath('testnet.sizeof.ai')).toBe('/docs')
    expect(docHref('hardware', '')).toBe('/hardware')
    expect(docHref('hardware')).toBe('/docs/hardware')
    expect(findDocArticle('unknown')).toBeUndefined()
  })
})

describe('documentation reader', () => {
  it('renders the directory and updates results immediately while typing', async () => {
    const user = userEvent.setup()
    render(<DocsPage pathname="/docs" basePath="/docs" />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('From first model')
    await user.type(screen.getByRole('searchbox', { name: 'Search documentation' }), 'importance matrix')
    const guides = screen.getByRole('navigation', { name: 'Guides' })
    expect(within(guides).getByRole('link', { name: 'Download the right model files' })).toHaveAttribute('href', '/docs/model-files')
    expect(within(guides).queryByRole('link', { name: 'Your first local model' })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Experience' }), 'Advanced')
    expect(screen.getByText('No guides match your search. Try a shorter query or select All experience levels.')).toBeInTheDocument()
  })

  it('renders sections, sources, and anchors for a known article', () => {
    render(<DocsPage pathname="/docs/kv-cache/" basePath="/docs" />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Context length and the KV cache')
    expect(within(screen.getByRole('navigation', { name: 'On this page' })).getByRole('link', { name: 'The conversation has a memory cost' })).toHaveAttribute('href', '#what')
    expect(screen.getByRole('link', { name: 'Transformers cache strategies ↗' })).toHaveAttribute('rel', 'noreferrer')
    expect(within(screen.getByRole('navigation', { name: 'Guides' })).getByRole('link', { name: 'Context length and the KV cache' })).toHaveAttribute('aria-current', 'page')
  })

  it('supports root paths on the docs host and does not present unknown slugs as a home page', () => {
    const { rerender } = render(<DocsPage pathname="/hardware" basePath="" />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Plan RAM, VRAM, and disk together')
    expect(within(screen.getByRole('navigation', { name: 'Guides' })).getByRole('link', { name: 'Your first local model' })).toHaveAttribute('href', '/getting-started')
    rerender(<DocsPage pathname="/unknown/route" basePath="" />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('This page is not in the field guide')
    expect(screen.getByRole('link', { name: 'Back to documentation' })).toHaveAttribute('href', '/')
  })

  it('copies exact commands and exposes clipboard failures instead of claiming success', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    render(<DocsPage pathname="/docs/llama-cpp" basePath="/docs" />)
    const buttons = screen.getAllByRole('button', { name: 'Copy command' })
    await user.click(buttons[0])
    expect(writeText).toHaveBeenCalledWith('llama --help\nllama cli --help')
    expect(screen.getByRole('status')).toHaveTextContent('Copied')
    writeText.mockRejectedValueOnce(new Error('Permission denied'))
    await user.click(buttons[0])
    expect(screen.getByRole('status')).toHaveTextContent('Copy failed. Select the command and copy it manually.')
    expect(screen.getByRole('status')).not.toHaveTextContent('Copied')
  })
})
