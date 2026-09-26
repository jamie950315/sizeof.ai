import { docsArticles, DOCS_REVIEWED_AT, type DocArticle } from '../src/docs/content'
import { docFigures } from '../src/docs/figures'
import { LANGUAGES, resolveLocale, translate, type Locale } from '../src/i18n/server'

const host = 'https://docs.sizeof.ai'
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')

export function articleMarkdown(article: DocArticle, locale: Locale = 'en', origin = host) {
  const t = (text: string) => translate(text, locale)
  return `# ${t(article.title)}\n\n${t(article.description)}\n\n${t('Reviewed')}: ${DOCS_REVIEWED_AT}\n\n` + docFigures(article.slug, locale).map(figure => `![${t(figure.alt)}](${origin}${figure.src})\n\n${t(figure.caption)}\n\n`).join('') + article.sections.map((section) =>
    `## ${t(section.title)}\n\n${section.paragraphs.map(t).join('\n\n')}\n\n${section.bullets?.map((item) => `- ${t(item)}`).join('\n') ?? ''}\n${section.code ? `\n\`\`\`text\n${section.code}\n\`\`\`\n` : ''}`,
  ).join('\n') + `\n## ${t('Sources')}\n\n` + article.sources.map((source) => `- [${t(source.label)}](${source.url})`).join('\n') + '\n'
}

/** Self-contained fallback styles: the SPA stylesheet may not apply before or without JavaScript. */
const staticStyles = `<style>:root{--nj-paper:#f1efe8;--nj-sheet:#fbfaf6;--nj-ink:#16150f;--nj-ink2:#47443c;--nj-ink3:#6b675d;--nj-rule:#d9d5c9;--nj-tape:#ffcd05;background:var(--nj-paper);color-scheme:light}@media (prefers-color-scheme:dark){:root{--nj-paper:#12120f;--nj-sheet:#1a1a16;--nj-ink:#eeece4;--nj-ink2:#bdb9ad;--nj-ink3:#959186;--nj-rule:#2f2e28;color-scheme:dark}}body{margin:0;background:var(--nj-paper)}.nj{max-width:44rem;margin:0 auto;padding:28px 20px 56px;color:var(--nj-ink);font:19px/1.62 'Newsreader Variable','Iowan Old Style',Georgia,serif}.nj a{color:inherit;text-underline-offset:3px}.nj nav,.nj h1,.nj h2,.nj figcaption,.nj footer,.nj-meta{font-family:'Schibsted Grotesk Variable',system-ui,-apple-system,'Segoe UI',sans-serif}.nj nav{font-size:15px;padding-bottom:12px;border-bottom:1px solid var(--nj-ink)}.nj h1{font-size:clamp(32px,6vw,48px);line-height:1.05;letter-spacing:-.03em;margin:28px 0 12px}.nj h2{font-size:24px;line-height:1.2;letter-spacing:-.02em;margin:36px 0 10px}.nj p{margin:0 0 .8em}.nj-meta{font-size:13px;color:var(--nj-ink2);padding-bottom:18px;border-bottom:1px solid var(--nj-ink)}.nj figure{margin:28px 0}.nj img{display:block;max-width:100%;height:auto;border:1px solid var(--nj-ink);border-radius:4px;background:var(--nj-sheet)}.nj figcaption{font-size:14px;color:var(--nj-ink2);margin-top:8px}.nj pre{white-space:pre-wrap;font:13px/1.8 ui-monospace,Menlo,Consolas,monospace;background:var(--nj-sheet);border:1px solid var(--nj-ink);border-radius:4px;padding:12px 14px}.nj ul{padding-inline-start:1.2em}.nj li{margin-bottom:.4em}.nj-index{list-style:none;padding:0!important;border-top:1px solid var(--nj-ink)}.nj-index li{padding:12px 0;margin:0;border-bottom:1px solid var(--nj-rule)}.nj-index a{font:600 17px/1.3 'Schibsted Grotesk Variable',system-ui,sans-serif}.nj-index p{margin:4px 0 0;color:var(--nj-ink2);font-size:17px}.nj footer{margin-top:48px;border-top:1px solid var(--nj-ink);padding-top:20px;font-size:14px}.nj select,.nj button{font:inherit;color:var(--nj-ink);background:var(--nj-sheet);border:1px solid var(--nj-ink);border-radius:4px;padding:4px 8px}.nj :focus-visible{outline:2px solid var(--nj-ink);box-shadow:0 0 0 5px var(--nj-tape)}</style>`

function staticDocument(article: DocArticle | undefined, missing: boolean, locale: Locale, prefix: string, url: URL, workspaceOrigin: string) {
  const t = (text: string) => escape(translate(text, locale))
  const link = (path: string) => escape(`${prefix}${path}?lang=${locale}`)
  const heading = article?.title ?? (missing ? 'Guide not found' : 'Local model field guide')
  const footer = `<footer><form method="get" action="${escape(url.pathname)}">${Array.from(url.searchParams).filter(([key]) => key !== 'lang').map(([key, value]) => `<input type="hidden" name="${escape(key)}" value="${escape(value)}"/>`).join('')}<label for="docs-language">${t('Language')}</label> <select id="docs-language" name="lang">${LANGUAGES.map(language => `<option value="${language.code}"${language.code === locale ? ' selected' : ''}>${escape(language.label)}</option>`).join('')}</select> <button type="submit">${t('Apply')}</button></form></footer>`
  return `<main class="nj">${staticStyles}<nav><a href="${link('/')}">sizeof.ai Docs</a> · <a href="${escape(`${workspaceOrigin}/start?lang=${locale}`)}">${t('Open workspace')}</a></nav><h1>${t(heading)}</h1>${article
    ? `<p>${t(article.description)}</p><p class="nj-meta">${t('Reviewed')} ${DOCS_REVIEWED_AT} · ${t(article.level)}</p>${docFigures(article.slug, locale).map(figure => `<figure><img src="${escape(figure.src)}" width="${figure.width}" height="${figure.height}" alt="${t(figure.alt)}" loading="lazy"/><figcaption>${t(figure.caption)}</figcaption></figure>`).join('')}${article.sections.map((section) => `<section id="${escape(section.id)}"><h2>${t(section.title)}</h2>${section.paragraphs.map((text) => `<p>${t(text)}</p>`).join('')}${section.bullets ? `<ul>${section.bullets.map((text) => `<li>${t(text)}</li>`).join('')}</ul>` : ''}${section.code ? `<pre dir="ltr"><code>${escape(section.code)}</code></pre>` : ''}</section>`).join('')}<h2>${t('Original sources')}</h2><ul>${article.sources.map((source) => `<li><a href="${escape(source.url)}">${t(source.label)}</a></li>`).join('')}</ul>`
    : missing ? `<p>${t('This guide does not exist.')} <a href="${link('/')}">${t('Browse the documentation.')}</a></p>`
      : `<p>${t('Practical guides for choosing, sizing, running and measuring local models.')}</p><ul class="nj-index">${docsArticles.map((entry) => `<li><a href="${link(`/${entry.slug}`)}">${t(entry.title)}</a><p>${t(entry.description)}</p></li>`).join('')}</ul>`}${footer}</main>`
}

type DocsBindings = { ASSETS: { fetch(request: Request): Promise<Response> } }

export async function handleDocsRequest(request: Request, env: DocsBindings, options: { pathPrefix?: string; publicOrigin?: string } = {}): Promise<Response> {
  const url = new URL(request.url)
  const prefix = options.pathPrefix ?? ''
  const origin = options.publicOrigin ?? host
  const docsHost = `${origin}${prefix}`
  // Docs served inside the platform link back to that same deployment; the standalone docs host uses testnet.
  const workspaceOrigin = prefix && options.publicOrigin ? options.publicOrigin : 'https://testnet.sizeof.ai'
  let cookieLocale: Locale | undefined
  try { cookieLocale = resolveLocale(decodeURIComponent(request.headers.get('Cookie')?.match(/(?:^|;\s*)sizeof-language=([^;]*)/)?.[1] ?? '')) } catch { /* Malformed cookies never block documentation. */ }
  const queryLocale = resolveLocale(url.searchParams.get('lang') ?? '')
  const locale = queryLocale ?? cookieLocale ?? 'en'
  const t = (text: string) => translate(text, locale)
  const send = (body: string, type: string, status = 200) => new Response(request.method === 'HEAD' ? null : body, {
    status, headers: { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'Content-Language': locale, 'Vary': 'Cookie',
      ...(queryLocale ? { 'Set-Cookie': `sizeof-language=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax; Secure${url.hostname === 'sizeof.ai' || url.hostname.endsWith('.sizeof.ai') ? '; Domain=sizeof.ai' : ''}` } : {}),
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' },
  })
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
  const pathname = url.pathname.slice(prefix.length).replace(/\/$/, '') || '/'
  if (pathname === '/robots.txt') return send(`User-agent: *\nAllow: /\nSitemap: ${docsHost}/sitemap.xml\n`, 'text/plain')
  if (pathname === '/sitemap.xml') return send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${docsHost}/</loc></url>${docsArticles.map((article) => `<url><loc>${docsHost}/${article.slug}</loc><lastmod>${DOCS_REVIEWED_AT}</lastmod></url>`).join('')}</urlset>`, 'application/xml')
  if (pathname === '/llms.txt') return send(`# ${t('sizeof.ai documentation')}\n\n${t('Practical local-model deployment references. Calculations are estimates, not benchmarks.')}\n\n${docsArticles.map((article) => `- [${t(article.title)}](${docsHost}/${article.slug}.md?lang=${locale}): ${t(article.description)}`).join('\n')}\n`, 'text/plain')
  if (pathname.endsWith('.md')) {
    const article = docsArticles.find((entry) => `/${entry.slug}.md` === pathname)
    return article ? send(articleMarkdown(article, locale, origin), 'text/markdown') : send(t('Guide not found'), 'text/plain', 404)
  }
  if (pathname.startsWith('/assets/') || /^\/(?:favicon[^/]*|apple-touch-icon[^/]*)$/.test(pathname)) {
    return env.ASSETS.fetch(request)
  }
  const article = docsArticles.find((entry) => `/${entry.slug}` === pathname)
  const missing = pathname !== '/' && !article
  const response = await env.ASSETS.fetch(new Request(new URL('/', url), { method: 'GET' }))
  if (!response.ok || !response.headers.get('Content-Type')?.includes('text/html')) return send(t('Documentation shell is unavailable'), 'text/plain', 503)
  const title = article ? `${article.title} | sizeof.ai Docs` : missing ? 'Guide not found | sizeof.ai Docs' : 'Local model field guide | sizeof.ai Docs'
  const description = article?.description ?? 'Practical guides for beginners and advanced users deploying models locally.'
  const canonical = `${docsHost}${pathname === '/' ? '/' : pathname}${locale === 'en' ? '' : `?lang=${locale}`}`
  const html = (await response.text())
    .replace(/<html\b[^>]*>/i, `<html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}">`)
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escape(t(title.replace(' | sizeof.ai Docs', '')))} | sizeof.ai Docs</title>`)
    .replace(/<meta\s+name=["']description["'][^>]*>/i, `<meta name="description" content="${escape(t(description))}" />`)
    .replace(/<link\s+rel=["']canonical["'][^>]*>/i, `<link rel="canonical" href="${escape(canonical)}" />`)
    .replace('<div id="root"></div>', `<div id="root">${staticDocument(article, missing, locale, prefix, url, workspaceOrigin)}</div>`)
  return send(html, 'text/html', missing ? 404 : 200)
}

export default { fetch: handleDocsRequest }
