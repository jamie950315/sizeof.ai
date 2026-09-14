import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { extractMessages, locales } from './i18n-catalog.mjs'

const root = resolve(import.meta.dirname, '..')
const messages = JSON.parse(readFileSync(resolve(root, 'src/i18n/messages.json'), 'utf8'))
const source = extractMessages()
const keys = Object.keys(source)
const missing = keys.filter(key => !Object.hasOwn(messages, key))
const obsolete = Object.keys(messages).filter(key => !Object.hasOwn(source, key))
if (missing.length || obsolete.length) throw new Error(`Translation source drift: ${missing.length} new / ${obsolete.length} obsolete messages. Run npm run i18n:extract and npm run i18n:generate before release.`)
const placeholders = value => [...value.matchAll(/\{\d+\}/g)].map(match => match[0]).sort().join('|')
for (const locale of locales) {
  const catalog = JSON.parse(readFileSync(resolve(root, `src/i18n/locales/${locale}.json`), 'utf8'))
  const invalid = keys.filter(key => typeof catalog[key] !== 'string' || !catalog[key].trim() || placeholders(catalog[key]) !== placeholders(key))
  if (invalid.length || Object.keys(catalog).some(key => !Object.hasOwn(source, key))) throw new Error(`Incomplete ${locale} catalog: ${invalid.length} missing or invalid translations.`)
}
console.log(`Localization verified: ${keys.length} messages in ${locales.length + 1} languages.`)
