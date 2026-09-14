import { describe, expect, it, vi } from 'vitest'
import { articleMarkdown, handleDocsRequest } from './docs'
import { docsArticles } from '../src/docs/content'
import { LANGUAGES, translate } from '../src/i18n/core'
import { handleWorkerRequest } from './index'
const env = { ASSETS: { fetch: vi.fn(async () => new Response('<html><head><title>sizeof.ai</title><meta name="description" content="old"><link rel="canonical" href="https://sizeof.ai/"></head><body><div id="root"></div></body></html>', {headers:{'Content-Type':'text/html'}})) } }
describe('independent documentation site', () => {
  it('serves article content without JavaScript and uses docs canonical URLs', async () => {
    const response = await handleDocsRequest(new Request('https://docs.sizeof.ai/getting-started'), env)
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toContain('Your first local model')
    expect(html).toContain('https://docs.sizeof.ai/getting-started')
    expect(html).toContain(docsArticles.find(article => article.slug === 'getting-started')!.sections[0].paragraphs[0])
    expect(html).not.toContain('href="https://sizeof.ai/"')
  })
  it('exposes all guides through sitemap and machine-readable Markdown', async () => {
    const sitemap = await (await handleDocsRequest(new Request('https://docs.sizeof.ai/sitemap.xml'), env)).text()
    for (const article of docsArticles) expect(sitemap).toContain(`/${article.slug}</loc>`)
    const markdown = await handleDocsRequest(new Request('https://docs.sizeof.ai/quantization.md'), env)
    expect(markdown.headers.get('Content-Type')).toContain('text/markdown')
    expect(await markdown.text()).toContain('## Sources')
    const llms = await (await handleDocsRequest(new Request('https://docs.sizeof.ai/llms.txt'), env)).text()
    expect(llms).toContain('/quantization.md')
  })
  it('does not serve unknown articles or API routes as successful pages', async () => {
    for (const path of ['/missing', '/api/models/Qwen/Model', '/unknown.md']) {
      expect((await handleDocsRequest(new Request(`https://docs.sizeof.ai${path}`), env)).status).toBe(404)
    }
  })
  it('supports HEAD and rejects mutations', async () => {
    const head = await handleDocsRequest(new Request('https://docs.sizeof.ai/getting-started', {method:'HEAD'}), env)
    expect(head.status).toBe(200); expect(await head.text()).toBe('')
    expect((await handleDocsRequest(new Request('https://docs.sizeof.ai/', {method:'POST'}), env)).status).toBe(405)
  })
  it('localizes server-rendered articles in every offered language without changing technical code', async () => {
    const article = docsArticles.find(entry => entry.sections.some(section => section.code))!
    for (const { code } of LANGUAGES) {
      const response = await handleDocsRequest(new Request(`https://docs.sizeof.ai/${article.slug}?lang=${code}`), env)
      const html = await response.text()
      expect(response.headers.get('Content-Language')).toBe(code)
      expect(html).toContain(`lang="${code}"`)
      expect(html).toContain(`dir="${code === 'ar' ? 'rtl' : 'ltr'}"`)
      expect(html).toContain(translate(article.title, code))
      if (code !== 'en') expect(translate(article.title, code)).not.toBe(article.title)
      expect(html).toContain('name="lang"')
      expect(html).toContain(`value="${code}" selected`)
      expect(html).toContain(`${article.sources[0].url}`)
      for (const section of article.sections) if (section.code) expect(articleMarkdown(article, code)).toContain(section.code)
    }
  })
  it('prioritizes explicit choice, remembers it across subdomains, and does not cache personalized language', async () => {
    const response = await handleDocsRequest(new Request('https://docs.sizeof.ai/getting-started?lang=ja&view=compact', { headers: { Cookie: 'sizeof-language=zh-TW' } }), env)
    expect(response.headers.get('Content-Language')).toBe('ja')
    expect(response.headers.get('Set-Cookie')).toContain('Domain=sizeof.ai')
    expect(response.headers.get('Set-Cookie')).toContain('sizeof-language=ja')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Vary')).toBe('Cookie')
    const html = await response.text()
    expect(html).toContain('name="view" value="compact"')
    expect(html).toContain('href="/?lang=ja"')
    const remembered = await handleDocsRequest(new Request('https://docs.sizeof.ai/quantization', { headers: { Cookie: 'other=value; sizeof-language=zh-TW' } }), env)
    expect(remembered.headers.get('Content-Language')).toBe('zh-TW')
    const invalid = await handleDocsRequest(new Request('https://docs.sizeof.ai/?lang=unsafe', { headers: { Cookie: 'sizeof-language=%invalid' } }), env)
    expect(invalid.headers.get('Content-Language')).toBe('en')
  })
  it('localizes Markdown and llms references on the isolated testnet docs paths', async () => {
    const options = { pathPrefix: '/docs', publicOrigin: 'https://testnet.sizeof.ai' }
    const article = docsArticles.find(entry => entry.slug === 'getting-started')!
    const markdown = await (await handleDocsRequest(new Request('https://testnet.sizeof.ai/docs/getting-started.md?lang=zh-TW'), env, options)).text()
    expect(markdown).toContain(`# ${translate(article.title, 'zh-TW')}`)
    expect(markdown).toContain(translate(article.sections[0].paragraphs[0], 'zh-TW'))
    const llms = await (await handleDocsRequest(new Request('https://testnet.sizeof.ai/docs/llms.txt?lang=ja'), env, options)).text()
    expect(llms).toContain('https://testnet.sizeof.ai/docs/quantization.md?lang=ja')
    expect(llms).not.toContain('https://docs.sizeof.ai/')
  })
  it('enables documentation rendering only on the testnet Worker', async () => {
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext
    const bindings = { ...env, MODEL_CACHE: { get: vi.fn(), put: vi.fn() } }
    const testnet = await handleWorkerRequest(new Request('https://testnet.sizeof.ai/docs/getting-started.md?lang=ja'), { ...bindings, ENVIRONMENT: 'testnet' }, ctx)
    expect(testnet.headers.get('Content-Type')).toContain('text/markdown')
    expect(testnet.headers.get('Content-Language')).toBe('ja')
    const production = await handleWorkerRequest(new Request('https://sizeof.ai/docs/getting-started.md?lang=ja'), { ...bindings, ENVIRONMENT: 'production' }, ctx)
    expect(production.headers.get('Content-Type')).toContain('text/html')
    expect(production.headers.get('Content-Language')).toBeNull()
  })
})
