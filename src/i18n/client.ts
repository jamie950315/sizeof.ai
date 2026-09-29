import { catalogs, registerCatalog, type Locale } from './core'

const loaders = {
  'zh-CN': () => import('./locales/zh-CN.json'), 'zh-TW': () => import('./locales/zh-TW.json'),
  ja: () => import('./locales/ja.json'), es: () => import('./locales/es.json'),
  ru: () => import('./locales/ru.json'), de: () => import('./locales/de.json'),
  fr: () => import('./locales/fr.json'), pt: () => import('./locales/pt.json'),
  ko: () => import('./locales/ko.json'), ar: () => import('./locales/ar.json'),
  hi: () => import('./locales/hi.json'), id: () => import('./locales/id.json'),
}
const pending = new Map<Locale, Promise<void>>()
export function loadLocale(locale: Locale): Promise<void> {
  if (catalogs[locale]) return Promise.resolve()
  const existing = pending.get(locale)
  if (existing) return existing
  const request = loaders[locale as Exclude<Locale, 'en'>]().then(module => {
    registerCatalog(locale, module.default)
  }).finally(() => { pending.delete(locale) })
  pending.set(locale, request)
  return request
}
