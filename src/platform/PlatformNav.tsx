import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { LayoutGrid, X } from 'lucide-react'
import { translate } from '../i18n/core'
import { primaryLinks, toolGroups } from './tools'
import './platform.css'

function docsHost() {
  return window.location.hostname === 'docs.sizeof.ai'
}

function currentSection(path: string) {
  if (path.startsWith('/docs')) return '/docs'
  return path.replace(/\/$/, '') || '/'
}

export function Wordmark() {
  return (
    <a className="wordmark" href={docsHost() ? 'https://testnet.sizeof.ai/' : '/'} aria-label="sizeof.ai home">
      <span>sizeof</span><span className="paren">(</span><span className="arg">ai</span><span className="paren">)</span>
    </a>
  )
}

export default function PlatformNav() {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const toggle = useRef<HTMLButtonElement>(null)
  const onDocs = docsHost()
  const base = onDocs ? 'https://testnet.sizeof.ai' : ''
  const path = onDocs ? '/docs' : currentSection(window.location.pathname)
  const production = /^(?:www\.)?sizeof\.ai$/.test(window.location.hostname)
  const isModelPage = path !== '/' && !path.startsWith('/docs') && path.split('/').length === 3
    && !toolGroups.some((group) => group.tools.some((tool) => tool.href === path))
  const hrefFor = (href: string) => onDocs && href === '/docs' ? '/' : `${base}${href}`
  const active = (href: string) => href === path || (href === '/' && isModelPage) ? 'page' : undefined

  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      toggle.current?.focus()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open])

  return (
    <>
      <header className="masthead">
        <div className="masthead-inner">
          <Wordmark />
          <nav className="masthead-nav" aria-label="Platform navigation">
            {primaryLinks.map(([label, href]) => (
              <a key={href} href={hrefFor(href)} aria-current={active(href)}>{translate(label)}</a>
            ))}
          </nav>
          <span className="masthead-spacer" />
          {!production && <span className="env-tag">Preview build</span>}
          <button
            ref={toggle}
            type="button"
            className="index-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X aria-hidden="true" /> : <LayoutGrid aria-hidden="true" />}
            <span>{open ? 'Close' : 'All tools'}</span>
          </button>
        </div>
      </header>
      <div className="index-panel" id={panelId} hidden={!open}>
        <nav className="index-panel-inner" aria-label="All tools">
          {toolGroups.map((group) => (
            <div className="index-group" key={group.title}>
              <h2>{translate(group.title)}</h2>
              {group.tools.map((tool) => (
                <a key={tool.href} href={hrefFor(tool.href)} aria-current={active(tool.href)}>
                  <strong>{translate(tool.name)}</strong>
                  <span>{translate(tool.description)}</span>
                </a>
              ))}
            </div>
          ))}
        </nav>
      </div>
    </>
  )
}

export function PlatformLayout({ children }: { children: ReactNode }) {
  return <div className="platform-shell"><PlatformNav />{children}</div>
}
