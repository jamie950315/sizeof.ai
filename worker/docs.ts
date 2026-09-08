import { docsArticles, DOCS_REVIEWED_AT, type DocArticle } from '../src/docs/content'

const host = 'https://docs.sizeof.ai'
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')

export function articleMarkdown(article: DocArticle) {
  return `# ${article.title}\n\n${article.description}\n\nReviewed: ${DOCS_REVIEWED_AT}\n\n` + article.sections.map((section) =>
    `## ${section.title}\n\n${section.paragraphs.join('\n\n')}\n\n${section.bullets?.map((item) => `- ${item}`).join('\n') ?? ''}\n${section.code ? `\n\`\`\`text\n${section.code}\n\`\`\`\n` : ''}`,
  ).join('\n') + '\n## Sources\n\n' + article.sources.map((source) => `- [${source.label}](${source.url})`).join('\n') + '\n'
}

function staticDocument(article: DocArticle | undefined, missing: boolean) {
  const heading = article?.title ?? (missing ? 'Guide not found' : 'Local model field guide')
  return `<main style="max-width:920px;margin:40px auto;padding:24px;line-height:1.75"><nav><a href="/">sizeof.ai Docs</a> · <a href="https://testnet.sizeof.ai/start">Open workspace</a></nav><h1>${escape(heading)}</h1>${article
    ? `<p>${escape(article.description)}</p><p>Reviewed ${DOCS_REVIEWED_AT} · ${escape(article.level)}</p>${article.sections.map((section) => `<section id="${escape(section.id)}"><h2>${escape(section.title)}</h2>${section.paragraphs.map((text) => `<p>${escape(text)}</p>`).join('')}${section.bullets ? `<ul>${section.bullets.map((text) => `<li>${escape(text)}</li>`).join('')}</ul>` : ''}${section.code ? `<pre style="white-space:pre-wrap"><code>${escape(section.code)}</code></pre>` : ''}</section>`).join('')}<h2>Original sources</h2><ul>${article.sources.map((source) => `<li><a href="${escape(source.url)}">${escape(source.label)}</a></li>`).join('')}</ul>`
    : missing ? '<p>This guide does not exist. <a href="/">Browse the documentation.</a></p>'
      : `<p>Practical guides for choosing, sizing, running and measuring local models.</p><ul>${docsArticles.map((entry) => `<li><a href="/${entry.slug}">${escape(entry.title)}</a><p>${escape(entry.description)}</p></li>`).join('')}</ul>`}</main>`
}

type DocsBindings = { ASSETS: { fetch(request: Request): Promise<Response> } }

export async function handleDocsRequest(request: Request, env: DocsBindings): Promise<Response> {
  const url = new URL(request.url)
  const send = (body: string, type: string, status = 200) => new Response(request.method === 'HEAD' ? null : body, {
    status, headers: { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' },
  })
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
  const pathname = url.pathname.replace(/\/$/, '') || '/'
  if (pathname === '/robots.txt') return send(`User-agent: *\nAllow: /\nSitemap: ${host}/sitemap.xml\n`, 'text/plain')
  if (pathname === '/sitemap.xml') return send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${host}/</loc></url>${docsArticles.map((article) => `<url><loc>${host}/${article.slug}</loc><lastmod>${DOCS_REVIEWED_AT}</lastmod></url>`).join('')}</urlset>`, 'application/xml')
  if (pathname === '/llms.txt') return send(`# sizeof.ai documentation\n\nPractical local-model deployment references. Calculations are estimates, not benchmarks.\n\n${docsArticles.map((article) => `- [${article.title}](${host}/${article.slug}.md): ${article.description}`).join('\n')}\n`, 'text/plain')
  if (pathname.endsWith('.md')) {
    const article = docsArticles.find((entry) => `/${entry.slug}.md` === pathname)
    return article ? send(articleMarkdown(article), 'text/markdown') : send('Guide not found', 'text/plain', 404)
  }
  if (pathname.startsWith('/assets/') || /^\/(?:favicon[^/]*|apple-touch-icon[^/]*)$/.test(pathname)) {
    return env.ASSETS.fetch(request)
  }
  const article = docsArticles.find((entry) => `/${entry.slug}` === pathname)
  const missing = pathname !== '/' && !article
  const response = await env.ASSETS.fetch(new Request(new URL('/', url), { method: 'GET' }))
  if (!response.ok || !response.headers.get('Content-Type')?.includes('text/html')) return send('Documentation shell is unavailable', 'text/plain', 503)
  const title = article ? `${article.title} | sizeof.ai Docs` : missing ? 'Guide not found | sizeof.ai Docs' : 'Local model field guide | sizeof.ai Docs'
  const description = article?.description ?? 'Practical guides for beginners and advanced users deploying models locally.'
  const canonical = `${host}${pathname === '/' ? '/' : pathname}`
  const html = (await response.text())
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escape(title)}</title>`)
    .replace(/<meta\s+name=["']description["'][^>]*>/i, `<meta name="description" content="${escape(description)}" />`)
    .replace(/<link\s+rel=["']canonical["'][^>]*>/i, `<link rel="canonical" href="${escape(canonical)}" />`)
    .replace('<div id="root"></div>', `<div id="root">${staticDocument(article, missing)}</div>`)
  return send(html, 'text/html', missing ? 404 : 200)
}

export default { fetch: handleDocsRequest }
