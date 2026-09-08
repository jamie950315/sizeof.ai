import { describe, expect, it, vi } from 'vitest'
import { handleDocsRequest } from './docs'
import { docsArticles } from '../src/docs/content'
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
})
