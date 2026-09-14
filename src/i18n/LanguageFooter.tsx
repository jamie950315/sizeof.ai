import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { LANGUAGES, getActiveLocale, resolveLocale, setActiveLocale, translate, type Locale } from './core'
import './language.css'
import { loadLocale } from './client'

const STORAGE_KEY = 'sizeof-language'
function cookieLocale() {
  try { return resolveLocale(decodeURIComponent(document.cookie.split('; ').find(item => item.startsWith(`${STORAGE_KEY}=`))?.split('=')[1] ?? '')) } catch { return undefined }
}
export function initialLocale(): Locale {
  const explicit = resolveLocale(new URLSearchParams(window.location.search).get('lang'))
  if (explicit) return explicit
  const cookie = cookieLocale()
  if (cookie) return cookie
  try { return resolveLocale(localStorage.getItem(STORAGE_KEY)) ?? 'en' } catch { return 'en' }
}
export function persistLocale(locale: Locale) {
  setActiveLocale(locale)
  try { localStorage.setItem(STORAGE_KEY, locale) } catch { /* URL and cookie retain the choice when storage is blocked. */ }
  const sharedDomain = /(^|\.)sizeof\.ai$/.test(window.location.hostname) ? '; Domain=sizeof.ai' : ''
  document.cookie = `${STORAGE_KEY}=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax${sharedDomain}${window.location.protocol === 'https:' ? '; Secure' : ''}`
  const url = new URL(window.location.href)
  url.searchParams.set('lang', locale)
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  document.documentElement.lang = locale
  document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'
}
const LanguageContext = createContext<{ locale: Locale; change: (locale: Locale) => Promise<boolean>; loading: boolean; error: boolean }>({ locale: 'en', change: async () => false, loading: false, error: false })
export const useLanguage = () => useContext(LanguageContext)
export function LanguageProvider({ children, initialError = false }: { children: ReactNode; initialError?: boolean }) {
  const [locale, setLocale] = useState(initialLocale)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(initialError)
  const generation = useRef(0)
  async function change(next: Locale) {
    const request = ++generation.current
    setLoading(true); setError(false)
    try { await loadLocale(next); if (request !== generation.current) return false; setActiveLocale(next); setLocale(next); return true }
    catch { if (request === generation.current) setError(true); return false }
    finally { if (request === generation.current) setLoading(false) }
  }
  setActiveLocale(locale)
  useEffect(() => { persistLocale(locale) }, [locale])
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === STORAGE_KEY) { const next = resolveLocale(event.newValue); if (next) void change(next) } }
    const back = () => { void change(initialLocale()) }
    window.addEventListener('storage', sync)
    window.addEventListener('popstate', back)
    return () => { generation.current++; window.removeEventListener('storage', sync); window.removeEventListener('popstate', back) }
  }, [])
  return <LanguageContext.Provider value={{ locale, change, loading, error }}>{children}</LanguageContext.Provider>
}
export default function LanguageFooter() {
  const { locale, change, loading, error } = useLanguage()
  const [saved, setSaved] = useState(false)
  async function select(next: Locale) {
    if (await change(next)) { persistLocale(next); setSaved(true) }
  }
  return <div className="language-footer" role="contentinfo">
    <div><span className="language-brand">sizeof.ai</span><p>{translate('Choose your language. Your choice stays with you across the site.', locale)}</p></div>
    <div className="language-control"><label htmlFor="site-language">{translate('Language', locale)}</label>
      <select id="site-language" value={locale} disabled={loading} aria-busy={loading} onChange={event => { const next = resolveLocale(event.target.value); if (next) void select(next) }}>
        {LANGUAGES.map(language => <option key={language.code} value={language.code} lang={language.code} dir="auto">{language.label}</option>)}
      </select><span className="language-feedback" role={error ? 'alert' : 'status'}>{error ? translate('Translation unavailable. Please try again.', locale) : loading ? translate('Loading translation…', locale) : saved ? translate('Language preference saved.', locale) : ''}</span>
    </div>
  </div>
}
export function currentLanguage() { return getActiveLocale() }
export function WorkspaceMetadata() {
  useLanguage()
  useEffect(() => {
    const heading = document.querySelector('h1')?.textContent?.trim()
    if (heading) document.title = `${heading} — sizeof.ai`
  })
  return null
}
