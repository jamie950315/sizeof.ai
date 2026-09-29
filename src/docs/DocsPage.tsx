import { useState } from 'react'
import { ArrowRight, Check, Copy, Search } from 'lucide-react'
import '@fontsource-variable/newsreader/opsz.css'
import { DOCS_REVIEWED_AT, docHref, docsArticles, docsBasePath, findDocArticle, searchDocs, type DocArticle } from './content'
import './docs.css'
import { docFigures } from './figures'
import { translate } from '../i18n/core'

const evidenceTools: Record<string, Array<[string, string]>> = {
  evidence: [['View data status and completeness limits', '/status']],
  'choose-model': [['Review compatibility evidence', '/compatibility']],
  'kv-cache': [['Plan a complete context budget', '/context']],
  'model-files': [['Review model revision changes', '/model-changes'], ['Prepare a complete download', '/deploy']],
  benchmarking: [['Import raw benchmark tool results', '/benchmarks#tool-result-import']],
}

/** Workspace links that turn a guide into a concrete workflow. */
function workflowLinks(slug: string): Array<[string, string]> {
  const links: Array<[string, string]> = []
  if (slug === 'troubleshooting') links.push([translate('Walk through an interactive diagnosis'), '/troubleshoot'])
  if (slug === 'benchmarking') links.push([translate('Record measured results in your local notebook'), '/benchmarks'])
  for (const [label, href] of evidenceTools[slug] ?? []) links.push([translate(label), href])
  if (slug === 'reproducible-deployments') {
    links.push([translate('Prepare a fixed model revision'), '/deploy'], [translate('Compare saved configurations'), '/runs'])
  }
  return links
}

function readingMinutes(article: DocArticle) {
  const words = article.sections.map((s) => s.paragraphs.join(' ') + (s.bullets ?? []).join(' ')).join(' ').split(/\s+/).length
  return Math.max(1, Math.ceil(words / 200))
}

function sourceHost(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

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
    <div className="docs-code-head">
      <span>Terminal · review before running</span>
      <button type="button" className="btn btn-quiet docs-copy" onClick={() => void copy()} aria-label="Copy command">
        {feedback === 'Copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} Copy
      </button>
    </div>
    <pre dir="ltr"><code>{code.split('\n').map((line, index) => <span className="docs-code-line" key={index}>{line}{'\n'}</span>)}</code></pre>
    {feedback && <p role="status" className={`docs-code-status${feedback === 'Copied' ? '' : ' docs-code-status-error'}`}>{translate(feedback)}</p>}
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
  const filtered = Boolean(query) || level !== 'All'
  const platformOrigin = window.location.hostname === 'docs.sizeof.ai' ? 'https://sizeof.ai' : ''
  const categories = [...new Set(docsArticles.map((item) => item.category))]
  const home = base || '/'
  const isHome = !slug

  const searchControls = <div className="docs-filters">
    <label className="docs-search">
      <Search aria-hidden="true" />
      <span className="visually-hidden">Search documentation</span>
      <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setNavOpen(true) }} placeholder="Search the field guide" />
    </label>
    <label className="docs-level">
      <span>Experience</span>
      <select value={level} onChange={(event) => { setLevel(event.target.value); setNavOpen(true) }}><option>All</option><option>Beginner</option><option>Advanced</option></select>
    </label>
  </div>

  if (isHome) {
    return <main className="page docs docs-home">
      <header className="docs-cover">
        <h1>Local model field guide</h1>
        <p className="docs-cover-lede">The field guide for choosing, understanding, running, and measuring models on your own hardware.</p>
        <p className="docs-colophon"><span>{docsArticles.length} practical guides</span><span>Reviewed {DOCS_REVIEWED_AT}</span></p>
      </header>

      {!filtered && <section className="docs-paths">
        <a href={docHref('getting-started', base)}>
          <h2>New to local models?</h2>
          <p>Get one useful conversation working. Learn what to download and what your computer can handle.</p>
          <strong>Take the beginner path <ArrowRight aria-hidden="true" /></strong>
        </a>
        <a href={docHref('benchmarking', base)}>
          <h2>Building a service?</h2>
          <p>Understand memory boundaries, reproducible measurements, and safe access before scaling.</p>
          <strong>Take the operator path <ArrowRight aria-hidden="true" /></strong>
        </a>
      </section>}

      <section className="docs-contents" aria-labelledby="docs-contents-title">
        <div className="docs-contents-head">
          <h2 id="docs-contents-title">{filtered ? 'Matching guides' : 'The complete field guide'}</h2>
          <span aria-live="polite">{filtered ? `${results.length} matching guides` : `${docsArticles.length} practical guides`}</span>
        </div>
        {searchControls}
        {results.length === 0 && <p className="docs-empty">No guides match your search. Try a shorter query or select All experience levels.</p>}
        <nav id="docs-guides" aria-label="Guides">{categories.map((category) => {
          const group = results.filter((item) => item.category === category)
          if (!group.length) return null
          return <div className="docs-toc-group" key={category}>
            <h3>{translate(category)}</h3>
            <ol>{group.map((item) => <li key={item.slug}>
              <a href={docHref(item.slug, base)}>
                <span className="docs-toc-title">{translate(item.title)}</span>
                <span className="docs-toc-desc">{translate(item.description)}</span>
              </a>
              <span className="docs-toc-level">{translate(item.level)}</span>
            </li>)}</ol>
          </div>
        })}</nav>
        <p className="docs-contents-foot"><a className="btn" href={`${platformOrigin}/deploy`}>Build a deployment plan</a></p>
      </section>

      <aside className="docs-bottom-note"><strong>Evidence over promises.</strong><p>These guides distinguish published facts from estimates. They do not promise universal model support, guaranteed fit, or invented performance numbers.</p></aside>
    </main>
  }

  const tools = article ? workflowLinks(article.slug) : []

  return <main className="page docs docs-reader">
    <aside className="docs-index" aria-label="Documentation navigation">
      <div className="docs-index-head">
        <a href={home} className="docs-index-title">Field guide</a>
        <span className="docs-index-count" aria-live="polite">{filtered ? `${results.length} matching guides` : `${docsArticles.length} practical guides`}</span>
      </div>
      <button type="button" className="docs-nav-toggle" aria-expanded={navOpen} aria-controls="docs-index-panel" onClick={() => setNavOpen(!navOpen)}>
        {navOpen ? 'Hide guides' : 'Browse guides'} <span aria-hidden="true">{navOpen ? '−' : '+'}</span>
      </button>
      <div id="docs-index-panel" className={`docs-index-panel${navOpen ? ' docs-index-panel-open' : ''}`}>
        {searchControls}
        <nav id="docs-guides" aria-label="Guides">{categories.map((category) => {
          const group = results.filter((item) => item.category === category)
          if (!group.length) return null
          return <div className="docs-nav-group" key={category}>
            <h2>{translate(category)}</h2>
            <ul>{group.map((item) => <li key={item.slug}><a href={docHref(item.slug, base)} aria-current={article?.slug === item.slug ? 'page' : undefined}>{translate(item.title)}</a></li>)}</ul>
          </div>
        })}</nav>
        {results.length === 0 && <p className="docs-no-results">No guides match. Try “memory”, “GGUF”, or clear the experience filter.</p>}
        <a className="docs-tool-link" href={`${platformOrigin}/deploy`}>Build a deployment plan</a>
      </div>
    </aside>

    {!article ? <section className="docs-missing">
      <p className="docs-missing-code" aria-hidden="true">404</p>
      <h1>This page is not in the field guide.</h1>
      <p>The link may be incorrect. Browse the guides or search for a topic.</p>
      <a className="btn" href={home}>Back to documentation</a>
    </section> : <div className="docs-article">
      <header className="docs-article-header">
        <p className="docs-crumbs"><a href={home}>Field guide</a><span aria-hidden="true">/</span><span>{translate(article.category)}</span></p>
        <h1>{translate(article.title)}</h1>
        <p className="docs-standfirst">{translate(article.description)}</p>
        <ul className="docs-meta">
          <li>{translate(article.level)}</li>
          <li>Reviewed {DOCS_REVIEWED_AT}</li>
          <li>{readingMinutes(article)} min read</li>
          <li><a href={`https://docs.sizeof.ai/${article.slug}.md`}>Read as Markdown</a></li>
        </ul>
      </header>

      {docFigures(article.slug).map((figure, index) => <figure className="docs-figure" key={figure.src}>
        <div className="docs-figure-plate"><img src={figure.src} width={figure.width} height={figure.height} alt={translate(figure.alt)} loading="lazy" decoding="async" /></div>
        <figcaption><strong>Figure {index + 1}.</strong> {translate(figure.caption)} <a href={figure.src} target="_blank" rel="noreferrer">Open full-size image</a></figcaption>
      </figure>)}

      <div className="docs-reading">
        <article className="docs-prose">
          {tools.length > 0 && <aside className="docs-tools" aria-labelledby="docs-tools-title">
            <h2 id="docs-tools-title">Related tools</h2>
            <ul>{tools.map(([label, href]) => <li key={href}><a href={`${platformOrigin}${href}`}>{label}</a></li>)}</ul>
          </aside>}

          {article.sections.map((section, index) => <section id={section.id} key={section.id}>
            <h2><span className="docs-section-mark" aria-hidden="true">§{index + 1}</span>{translate(section.title)}</h2>
            {section.paragraphs.map((paragraph) => <p key={paragraph}>{translate(paragraph)}</p>)}
            {section.bullets && <ul>{section.bullets.map((bullet) => <li key={bullet}>{translate(bullet)}</li>)}</ul>}
            {section.code && <CodeExample code={section.code} />}
          </section>)}

          <section className="docs-sources" id="sources">
            <h2>Sources & verification</h2>
            <p>Primary references reviewed on {DOCS_REVIEWED_AT}. Upstream commands and requirements can change. Check the documentation for your installed release; examples are not a guarantee of compatibility with every model or device.</p>
            <ol>{article.sources.map((source) => <li key={source.url}>
              <a href={source.url} target="_blank" rel="noreferrer">{translate(source.label)}</a>
              <span className="docs-source-host" dir="ltr">{sourceHost(source.url)}</span>
            </li>)}</ol>
          </section>

          <section className="docs-related">
            <h2>Continue reading</h2>
            <ul>{article.related.map((relatedSlug) => {
              const related = findDocArticle(relatedSlug)
              return related ? <li key={related.slug}><a href={docHref(related.slug, base)}>
                <span className="docs-related-title">{translate(related.title)}</span>
                <span className="docs-related-desc">{translate(related.description)}</span>
              </a><span className="docs-related-meta">{translate(related.category)}</span></li> : null
            })}</ul>
          </section>
        </article>

        <aside className="docs-rail">
          <nav aria-label="On this page">
            <h2>On this page</h2>
            <ol>
              {article.sections.map((section) => <li key={section.id}><a href={`#${section.id}`}>{translate(section.title)}</a></li>)}
              <li><a href="#sources">Sources & verification</a></li>
            </ol>
          </nav>
          <div className="docs-rail-note">
            <strong>Measure before you commit.</strong>
            <p>Memory fit is an estimate, not a speed benchmark or a runtime compatibility guarantee.</p>
            <a href={`${platformOrigin}/`}>Open model explorer</a>
          </div>
        </aside>
      </div>
    </div>}
  </main>
}
