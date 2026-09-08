import type { ReactNode } from 'react'
import './platform.css'

export default function PlatformNav() {
  const docsHost = window.location.hostname === 'docs.sizeof.ai'
  const base = docsHost ? 'https://testnet.sizeof.ai' : ''
  const links = [['Start', '/start'], ['Models', '/'], ['Compare', '/compare'], ['Deploy', '/deploy'], ['Hardware', '/hardware'], ['My library', '/library'], ['Records', '/runs'], ['Measurements', '/benchmarks'], ['Troubleshoot', '/troubleshoot']]
  return <nav className="platform-strip" aria-label="Platform navigation">
    {links.map(([label, path]) => <a key={path} href={`${base}${path}`} aria-current={!docsHost && window.location.pathname === path ? 'page' : undefined}>{label}</a>)}
    <a href={docsHost ? '/' : '/docs'} aria-current={docsHost || window.location.pathname.startsWith('/docs') ? 'page' : undefined}>Docs <span aria-hidden="true">↗</span></a>
  </nav>
}

export function PlatformLayout({ children }: { children: ReactNode }) {
  return <div className="platform-shell"><header className="platform-header">
    <a href={window.location.hostname === 'docs.sizeof.ai' ? 'https://testnet.sizeof.ai/start' : '/start'} className="platform-brand">sizeof<span>.ai</span></a>
    <span>LOCAL MODEL WORKSPACE <b>TESTNET</b></span>
  </header><PlatformNav />{children}<footer className="platform-footer">Estimates, not guarantees. Your hardware and runtime are the final test.<a href="https://docs.sizeof.ai">Documentation</a></footer></div>
}
