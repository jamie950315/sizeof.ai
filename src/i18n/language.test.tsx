import { useState } from 'react'
import './server'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LanguageFooter, { LanguageProvider, initialLocale, persistLocale, useLanguage } from './LanguageFooter'
import { LANGUAGES, formatMessage, getActiveLocale, localizeHref, localizeOutput, routingSearch, setActiveLocale, translate } from './core'
import App from '../App'
import PlatformRouter from '../platform/PlatformRouter'
import DocsPage from '../docs/DocsPage'
import RunComparison from '../platform/RunComparison'
import RunHistoryPage from '../platform/RunHistoryPage'
import StartPage from '../platform/StartPage'
import { DEPLOYMENT_DEFAULTS } from '../platform/deployment'
import { writeRuns, type DeploymentRun } from '../platform/run-history'
import * as client from './client'

function View() { useLanguage(); return <><PlatformRouter /><LanguageFooter /></> }
beforeEach(() => {
  window.history.replaceState(null, '', '/')
  localStorage.clear()
  document.cookie = 'sizeof-language=; Path=/; Max-Age=0'
  document.documentElement.lang = 'en'
  document.documentElement.dir = 'ltr'
  setActiveLocale('en')
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); setActiveLocale('en'); document.cookie = 'sizeof-language=; Path=/; Max-Age=0' })

describe('site-wide persistent language routing', () => {
  it('validates preference and prioritizes explicit links over stored language', () => {
    localStorage.setItem('sizeof-language', 'ja')
    expect(initialLocale()).toBe('ja')
    document.cookie = 'sizeof-language=es; Path=/'
    expect(initialLocale()).toBe('es')
    window.history.replaceState(null, '', '/start?lang=zh-TW')
    expect(initialLocale()).toBe('zh-TW')
    window.history.replaceState(null, '', '/start?lang=not-a-language')
    expect(initialLocale()).toBe('es')
  })
  it('remembers language without clearing URL settings or hash', () => {
    window.history.replaceState(null, '', '/compare?model=Qwen%2FQwen3#result')
    persistLocale('ja')
    expect(localStorage.getItem('sizeof-language')).toBe('ja')
    expect(document.cookie).toContain('sizeof-language=ja')
    expect(window.location.hash).toBe('#result')
    expect(new URLSearchParams(window.location.search).get('model')).toBe('Qwen/Qwen3')
    expect(new URLSearchParams(window.location.search).get('lang')).toBe('ja')
    expect(document.documentElement.lang).toBe('ja')
  })
  it('retains language through URL and cookie when localStorage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(() => persistLocale('de')).not.toThrow()
    expect(initialLocale()).toBe('de')
    expect(window.location.search).toContain('lang=de')
  })
  it('offers every language and changes direction without remounting form state', async () => {
    function Form() { const [text, setText] = useState(''); useLanguage(); return <><input aria-label="untouched user text" value={text} onChange={event => setText(event.target.value)} /><LanguageFooter /></> }
    render(<LanguageProvider><Form /></LanguageProvider>)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Private user notes for work' } })
    expect(screen.getAllByRole('option')).toHaveLength(LANGUAGES.length)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ar' } })
    await vi.waitFor(() => expect(document.documentElement.dir).toBe('rtl'))
    expect(screen.getByRole('textbox')).toHaveValue('Private user notes for work')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zh-TW' } })
    await vi.waitFor(() => expect(document.documentElement.dir).toBe('ltr'))
    expect(getActiveLocale()).toBe('zh-TW')
  })
  it('does not treat locale parameters as context-workbook configuration', async () => {
    window.history.replaceState(null, '', '/context?lang=ja')
    render(<LanguageProvider><View /></LanguageProvider>)
    expect(await screen.findByRole('heading', { name: translate('Context budget.', 'ja'), level: 1 })).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
    const link = screen.getByRole('link', { name: translate('Deploy', 'ja') })
    expect(link.getAttribute('href')).toContain('lang=ja')
  })
  it('keeps filter option values stable and searches translated guide prose', () => {
    setActiveLocale('zh-TW')
    render(<DocsPage basePath="/docs" pathname="/docs" />)
    const experience = screen.getByRole('combobox')
    expect([...experience.querySelectorAll('option')].map(option => option.value)).toEqual(['All', 'Beginner', 'Advanced'])
    fireEvent.change(experience, { target: { value: 'Advanced' } })
    expect(experience).toHaveValue('Advanced')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '模型' } })
    expect(document.querySelectorAll('.docs-directory-row').length).toBeGreaterThan(0)
  })
  it('rewrites testnet documentation links without touching upstream sources or APIs', () => {
    expect(localizeHref('https://docs.sizeof.ai/kv-cache.md', 'fr', 'https://testnet.sizeof.ai')).toBe('https://testnet.sizeof.ai/docs/kv-cache.md?lang=fr')
    expect(localizeHref('/deploy?model=Qwen%2FQwen3#result', 'es')).toContain('lang=es#result')
    expect(localizeHref('https://huggingface.co/Qwen/Qwen3', 'ja')).toBe('https://huggingface.co/Qwen/Qwen3')
    expect(localizeHref('/api/v1/estimate?model=Qwen%2FQwen3', 'ja')).toBe('/api/v1/estimate?model=Qwen%2FQwen3')
    expect(routingSearch('?lang=ja')).toBe('')
    expect(routingSearch('?v=1&lang=ja&capacity=8192')).toBe('?v=1&capacity=8192')
  })
  it('localizes human exports while preserving executable commands exactly', () => {
    setActiveLocale('zh-TW')
    const command = 'hf download Qwen/Qwen3 --revision abc --local-dir ./model\ncurl http://127.0.0.1:8000/v1/models'
    const output = localizeOutput(`# Local deployment runbook\n\n## Start the server\n\n\`\`\`sh\n${command}\n\`\`\`\n`)
    expect(output).toContain(command)
    expect(output).toContain(translate('# Local deployment runbook', 'zh-TW'))
    expect(output).not.toContain('## Start the server')
  })
  it('keeps technical values opaque and uses only explicit message templates', () => {
    setActiveLocale('zh-TW')
    expect(translate('64L / 4 KVH')).toBe('64L / 4 KVH')
    expect(translate('256K NATIVE')).toBe('256K NATIVE')
    expect(formatMessage('{0} GiB', [18.3])).toBe('18.3GiB')
  })
  it('does not translate catalog measurements as prose', () => {
    setActiveLocale('zh-TW')
    render(<App />)
    expect(screen.getAllByText('64L / 4 KVH').length).toBeGreaterThan(0)
    expect(screen.getByText((_, node) => node?.textContent === '256K 原生上下文')).toBeVisible()
    expect(screen.getByText((_, node) => node?.textContent === '27.781B 參數')).toBeVisible()
    expect(screen.queryByText(/64升|在地化|權權重化|合身性/)).toBeNull()
  })
  it('explicitly localizes fixed card data without translating arbitrary values', () => {
    setActiveLocale('zh-TW')
    render(<StartPage />)
    expect(screen.getByRole('heading', { name: '模型瀏覽器' })).toBeVisible()
    expect(screen.getByText('搜尋公開模型，查看各種設定所需的記憶體。')).toBeVisible()
    expect(screen.queryByText('Model explorer')).toBeNull()
    expect(screen.queryByText('Search public models and inspect the memory behind every configuration.')).toBeNull()
  })
  it('keeps private observations verbatim even when they match known site messages', async () => {
    setActiveLocale('zh-TW')
    const left: DeploymentRun = { id: 'one', savedAt: '2026-09-08T00:00:00.000Z', input: { ...DEPLOYMENT_DEFAULTS, model: 'org/model', file: 'model.gguf' }, runtimeVersion: 'Model', hardwareLabel: 'My library', outcome: 'planned', notes: 'Private notes', firstError: 'Context window' }
    const right = { ...left, id: 'two', notes: 'Language' }
    render(<RunComparison left={left} right={right} />)
    expect(screen.getByText('Private notes', { selector: 'td' })).toBeVisible()
    expect(screen.getByText('Language', { selector: 'td' })).toBeVisible()
    cleanup()
    writeRuns([left])
    render(<RunHistoryPage />)
    expect(await screen.findByText('My library', { selector: 'dd' })).toBeVisible()
    expect(screen.getByText('Private notes', { selector: 'p' })).toBeVisible()
    expect(screen.getByText('Context window', { selector: 'p' })).toBeVisible()
  })
  it('keeps the previous language and configuration if a language asset fails', async () => {
    window.history.replaceState(null, '', '/deploy?model=org%2Fmodel&lang=en#settings')
    vi.spyOn(client, 'loadLocale').mockRejectedValueOnce(new Error('asset unavailable'))
    render(<LanguageProvider><LanguageFooter /></LanguageProvider>)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'fr' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Translation unavailable. Please try again.')
    expect(getActiveLocale()).toBe('en')
    expect(new URLSearchParams(window.location.search).get('model')).toBe('org/model')
    expect(window.location.hash).toBe('#settings')
  })
})
