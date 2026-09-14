import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/archivo'
import '@fontsource-variable/jetbrains-mono'
import PlatformRouter from './platform/PlatformRouter'
import './styles.css'
import LanguageFooter, { LanguageProvider, initialLocale, useLanguage } from './i18n/LanguageFooter'
import { translate } from './i18n/core'
import { loadLocale } from './i18n/client'

function Site() {
  const { locale } = useLanguage()
  React.useEffect(() => {
    const heading = document.querySelector('h1')?.textContent?.trim()
    if (heading) document.title = `${heading} — sizeof.ai`
    else if (window.location.pathname === '/') document.title = `sizeof.ai — ${translate('LLM memory, measured', locale)}`
    document.querySelector('meta[name="description"]')?.setAttribute('content', translate('Estimate LLM VRAM across quantizations and context sizes. Find the strongest model that fits your hardware.', locale))
  }, [locale])
  return <><PlatformRouter /><LanguageFooter /></>
}

function renderSite(initialError = false) { ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider initialError={initialError}><Site /></LanguageProvider>
  </React.StrictMode>,
) }
void loadLocale(initialLocale()).then(() => renderSite(), () => {
  // Keep the page usable if a language asset cannot be downloaded.
  const url = new URL(window.location.href)
  url.searchParams.set('lang', 'en')
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  renderSite(true)
})
