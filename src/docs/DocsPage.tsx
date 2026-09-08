import { useState } from 'react'
import { ArrowRight, BookOpen, Check, Copy, Search } from 'lucide-react'
import { DOCS_REVIEWED_AT, docHref, docsArticles, docsBasePath, findDocArticle, searchDocs } from './content'
import './docs.css'
import { docFigures } from './figures'

function CodeExample({ code }: { code: string }) {
  const [feedback, setFeedback] = useState('')
  async function copy() {
    setFeedback('')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(code)
      setFeedback('Copied')
    } catch {
      setFeedback('Copy failed. Select the command and copy it manually.')
    }
  }
  return <div className="docs-code">
    <div className="docs-code-toolbar"><span>TERMINAL · REVIEW BEFORE RUNNING</span><button type="button" onClick={() => void copy()} aria-label="Copy command">{feedback === 'Copied' ? <Check size={14} /> : <Copy size={14} />} Copy</button></div>
    <pre><code>{code}</code></pre>
    {feedback && <p role="status">{feedback}</p>}
  </div>
}

export default function DocsPage({ basePath, pathname }: { basePath?: string; pathname?: string } = {}) {
  const base = basePath ?? docsBasePath(window.location.hostname)
  const path = pathname ?? window.location.pathname
  const slug = path.replace(/\/$/, '').slice(base.length).replace(/^\//, '')
  const article = slug ? findDocArticle(slug) : undefined
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState('All')
  const [navOpen, setNavOpen] = useState(false)
  const results = searchDocs(query, level)
  const platformOrigin = window.location.hostname === 'docs.sizeof.ai' ? 'https://testnet.sizeof.ai' : ''
  const categories = [...new Set(docsArticles.map((item) => item.category))]

  return <main className="docs-shell">
    <aside className="docs-sidebar" aria-label="Documentation navigation">
      <a href={base || '/'} className="docs-wordmark"><BookOpen size={17} /> FIELD GUIDE <span>01—16</span></a>
      <label className="docs-search"><Search size={16} /><span className="visually-hidden">Search documentation</span><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setNavOpen(true) }} placeholder="Search the field guide" /></label>
      <label className="docs-level"><span>Experience</span><select value={level} onChange={(event) => { setLevel(event.target.value); setNavOpen(true) }}><option>All</option><option>Beginner</option><option>Advanced</option></select></label>
      <div className="docs-nav-results" aria-live="polite">{query || level !== 'All' ? `${results.length} matching guides` : `${docsArticles.length} practical guides`}</div>
      <button className="docs-nav-toggle" aria-expanded={navOpen} aria-controls="docs-guides" onClick={() => setNavOpen(!navOpen)}>{navOpen ? 'Hide guides' : 'Browse guides'} <span aria-hidden="true">{navOpen ? '−' : '+'}</span></button>
      <nav id="docs-guides" className={navOpen ? 'docs-guides docs-guides-open' : 'docs-guides'} aria-label="Guides">{categories.map((category) => {
        const group = results.filter((item) => item.category === category)
        if (!group.length) return null
        return <div className="docs-nav-group" key={category}><h2>{category}</h2>{group.map((item) => <a key={item.slug} href={docHref(item.slug, base)} aria-current={article?.slug === item.slug ? 'page' : undefined}>{item.title}</a>)}</div>
      })}</nav>
      {results.length === 0 && <p className="docs-no-results">No guides match. Try “memory”, “GGUF”, or clear the experience filter.</p>}
      <a className="docs-tool-link" href={`${platformOrigin}/deploy`}>Build a deployment plan <ArrowRight size={15} /></a>
    </aside>

    <div className="docs-main">
      {slug && !article ? <section className="docs-missing"><span className="docs-eyebrow">404 / GUIDE NOT FOUND</span><h1>This page is not in the field guide.</h1><p>The link may be incorrect. Browse the guides or search for a topic.</p><a href={base || '/'}>Back to documentation <ArrowRight size={16} /></a></section> : article ? <>
        <header className="docs-article-header"><a href={base || '/'} className="docs-eyebrow">FIELD GUIDE</a><span className="docs-eyebrow"> / {article.category}</span><h1>{article.title}</h1><p>{article.description}</p><div className="docs-meta"><span>{article.level}</span><span>Reviewed {DOCS_REVIEWED_AT}</span><span>{Math.max(1, Math.ceil(article.sections.map((s) => s.paragraphs.join(' ') + (s.bullets ?? []).join(' ')).join(' ').split(/\s+/).length / 200))} min read</span><a href={`https://docs.sizeof.ai/${article.slug}.md`}>Read as Markdown ↗</a></div></header>
        {docFigures(article.slug).map((figure) => <figure className="docs-figure" key={figure.src}><img src={figure.src} width={figure.width} height={figure.height} alt={figure.alt} loading="lazy" decoding="async" /><figcaption>{figure.caption} <a href={figure.src} target="_blank" rel="noreferrer">Open full-size image ↗</a></figcaption></figure>)}
        {article.slug === 'troubleshooting' && <p className="docs-workflow-link"><a href={`${platformOrigin}/troubleshoot`}>Walk through an interactive diagnosis →</a></p>}
        <div className="docs-reading-layout"><article className="docs-prose">
          {article.sections.map((section, index) => <section id={section.id} key={section.id}><h2><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>{section.title}</h2>{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}{section.bullets && <ul>{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}{section.code && <CodeExample code={section.code} />}</section>)}
          <section className="docs-sources" id="sources"><h2>Sources & verification</h2><p>Primary references reviewed on {DOCS_REVIEWED_AT}. Upstream commands and requirements can change. Check the documentation for your installed release; examples are not a guarantee of compatibility with every model or device.</p><ul>{article.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a></li>)}</ul></section>
          <section className="docs-related"><h2>Continue reading</h2>{article.related.map((relatedSlug) => {
            const related = findDocArticle(relatedSlug)
            return related ? <a href={docHref(related.slug, base)} key={related.slug}><span>{related.title}<small>{related.description}</small></span><ArrowRight size={18} /></a> : null
          })}</section>
        </article><aside className="docs-toc"><nav aria-label="On this page"><h2>ON THIS PAGE</h2>{article.sections.map((section) => <a key={section.id} href={`#${section.id}`}>{section.title}</a>)}<a href="#sources">Sources & verification</a></nav><div className="docs-note"><strong>Measure before you commit.</strong><p>Memory fit is an estimate, not a speed benchmark or a runtime compatibility guarantee.</p><a href={`${platformOrigin}/`}>Open model explorer →</a></div></aside></div>
      </> : <>
        <header className="docs-home-header"><span className="docs-eyebrow">LOCAL INFERENCE / A PRACTICAL REFERENCE</span><h1>From first model<br />to reliable deployment<span>.</span></h1><p>The field guide for choosing, understanding, running, and measuring models on your own hardware.</p></header>
        {!query && level === 'All' && <div className="docs-paths"><a href={docHref('getting-started', base)}><span>01 / START SMALL</span><h2>New to local models?</h2><p>Get one useful conversation working. Learn what to download and what your computer can handle.</p><strong>Take the beginner path <ArrowRight size={16} /></strong></a><a href={docHref('benchmarking', base)}><span>02 / GO DEEPER</span><h2>Building a service?</h2><p>Understand memory boundaries, reproducible measurements, and safe access before scaling.</p><strong>Take the operator path <ArrowRight size={16} /></strong></a></div>}
        <section className="docs-directory"><div className="docs-directory-heading"><h2>{query || level !== 'All' ? 'Matching guides' : 'The complete field guide'}</h2><span aria-live="polite">{results.length} GUIDES</span></div>{results.length === 0 && <p>No guides match your search. Try a shorter query or select All experience levels.</p>}{results.map((item) => <a className="docs-directory-row" href={docHref(item.slug, base)} key={item.slug}><span className="docs-row-category">{item.category}</span><div><h3>{item.title}</h3><p>{item.description}</p></div><span className="docs-row-level">{item.level}</span><ArrowRight size={18} /></a>)}</section>
        <div className="docs-bottom-note"><strong>Evidence over promises.</strong><p>These guides distinguish published facts from estimates. They do not promise universal model support, guaranteed fit, or invented performance numbers.</p></div>
      </>}
    </div>
  </main>
}
