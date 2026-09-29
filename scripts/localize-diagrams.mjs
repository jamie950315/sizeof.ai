/**
 * Deterministic asset generation from reviewed, checked-in locale catalogs.
 *
 * Every source diagram `public/assets/docs/<name>.svg` (no locale suffix) is written
 * to `<name>.<locale>.svg`. Only <text>, <title> and <desc> contents change; shapes
 * are copied byte for byte. Layout hints live on each <text> element:
 *   data-fit="<px>"     maximum rendered width; longer translations are condensed
 *   data-rtl-x="<px>"   right edge used as the start position for right-to-left locales
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const directory = resolve(root, 'public/assets/docs')
const locales = ['zh-CN', 'zh-TW', 'ja', 'es', 'ru', 'de', 'fr', 'pt', 'ko', 'ar', 'hi', 'id']
const rtlLocales = new Set(['ar'])
export const diagramSources = () => readdirSync(directory).filter((file) => /^[a-z0-9]+(?:-[a-z0-9]+)*\.svg$/.test(file)).sort()

const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const unescape = (text) => text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&')
const attribute = (attributes, name) => attributes.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
const setAttribute = (attributes, name, value) => new RegExp(`\\s${name}="[^"]*"`).test(attributes)
  ? attributes.replace(new RegExp(`\\s${name}="[^"]*"`), ` ${name}="${value}"`)
  : `${attributes} ${name}="${value}"`
// Labels without words (percentages, numbers) and bare technical abbreviations stay as written.
const needsTranslation = (text) => /[A-Za-z]{2}/.test(text) && !/^[A-Z]{2,4}$/.test(text)

/** Approximate advance width in em for proportional UI fonts. */
function estimateWidth(text, fontSize) {
  let em = 0
  for (const char of text) {
    const code = char.codePointAt(0)
    if (code >= 0x1100 && (code <= 0x115f || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3)
      || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe4f) || (code >= 0xff00 && code <= 0xff60))) em += 1
    else if (char === ' ') em += 0.28
    else if (/[A-Z]/.test(char)) em += 0.64
    else em += 0.55
  }
  return em * fontSize
}

export function localizeDiagram(source, catalog, locale) {
  return source.replace(/<(text|title|desc)\b([^>]*)>([^<]*)<\/\1>/g, (whole, tag, attributes, content) => {
    const original = unescape(content).trim()
    const translated = catalog[original] ?? (needsTranslation(original) ? undefined : original)
    if (!translated) throw new Error(`Missing ${locale} diagram label: ${original}`)
    let layout = attributes
    if (tag === 'text') {
      const fit = Number(attribute(attributes, 'data-fit'))
      const fontSize = Number(attribute(attributes, 'font-size') ?? 16)
      if (fit && translated !== original && estimateWidth(translated, fontSize) > fit) {
        layout += ` textLength="${fit}" lengthAdjust="spacingAndGlyphs"`
      }
      if (rtlLocales.has(locale) && translated !== original) {
        const rtlX = attribute(attributes, 'data-rtl-x')
        const anchor = attribute(attributes, 'text-anchor') ?? 'start'
        if (rtlX) layout = setAttribute(setAttribute(layout, 'x', rtlX), 'text-anchor', 'start')
        // In right-to-left text, "start" is the right edge: an LTR end-anchored label keeps its edge.
        else if (anchor === 'end') layout = setAttribute(layout, 'text-anchor', 'start')
        layout += ' direction="rtl" unicode-bidi="plaintext"'
      }
    }
    return `<${tag}${layout}>${escape(translated)}</${tag}>`
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const file of diagramSources()) {
    const source = readFileSync(resolve(directory, file), 'utf8')
    for (const locale of locales) {
      const catalog = JSON.parse(readFileSync(resolve(root, `src/i18n/locales/${locale}.json`), 'utf8'))
      writeFileSync(resolve(directory, file.replace(/\.svg$/, `.${locale}.svg`)), localizeDiagram(source, catalog, locale))
    }
  }
}
