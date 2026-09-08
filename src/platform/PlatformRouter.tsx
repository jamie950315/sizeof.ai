import { Component, lazy, Suspense, type ReactNode } from 'react'
import App from '../App'
import { PlatformLayout } from './PlatformNav'
import StartPage from './StartPage'

const DeployPage = lazy(() => import('./DeployPage'))
const HardwarePage = lazy(() => import('./HardwarePage'))
const LibraryPage = lazy(() => import('./LibraryPage'))
const DocsPage = lazy(() => import('../docs/DocsPage'))
const RunHistoryPage = lazy(() => import('./RunHistoryPage'))
const TroubleshootPage = lazy(() => import('./TroubleshootPage'))

export class WorkspaceBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <main className="platform-main"><div role="alert" className="platform-alert"><h1>Workspace could not load</h1><p>Reload to retry. Your saved library has not been changed.</p><button onClick={() => window.location.reload()}>Reload workspace</button> <a href="/">Open model explorer</a></div></main> : this.props.children
  }
}

export default function PlatformRouter() {
  const path = window.location.pathname.replace(/\/$/, '') || '/'
  const docs = window.location.hostname === 'docs.sizeof.ai' || path === '/docs' || path.startsWith('/docs/')
  const content = docs ? <DocsPage /> : path === '/start' ? <StartPage /> : path === '/deploy' ? <DeployPage />
    : path === '/hardware' ? <HardwarePage /> : path === '/library' ? <LibraryPage />
      : path === '/runs' ? <RunHistoryPage /> : path === '/troubleshoot' ? <TroubleshootPage /> : null
  if (!content) return <App />
  return <PlatformLayout><WorkspaceBoundary><Suspense fallback={<div className="platform-loading" role="status">Opening workspace…</div>}>{content}</Suspense></WorkspaceBoundary></PlatformLayout>
}
