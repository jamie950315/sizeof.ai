/** Deterministic asset generation from reviewed, checked-in locale catalogs. */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const locales = ['zh-CN', 'zh-TW', 'ja', 'es', 'ru', 'de', 'fr', 'pt', 'ko', 'ar', 'hi', 'id']
const source = readFileSync(resolve(root, 'public/assets/docs/memory-pools.svg'), 'utf8')
const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
for (const locale of locales) {
  const catalog = JSON.parse(readFileSync(resolve(root, `src/i18n/locales/${locale}.json`), 'utf8'))
  const svg = source.replace(/<(text|title|desc)\b([^>]*)>([^<]*)<\/\1>/g, (whole, tag, attributes, content) => {
    const original = content.replaceAll('&amp;', '&').trim()
    // CPU and GPU are intentionally untranslated technical abbreviations.
    const translated = catalog[original] ?? (['CPU', 'GPU'].includes(original) ? original : undefined)
    if (!translated) throw new Error(`Missing ${locale} diagram label: ${original}`)
    let layout = attributes
    if (tag === 'text') {
      const x = Number(attributes.match(/\bx="(\d+)"/)?.[1])
      const width = x < 100 && ![40, 42].includes(x) ? 390 : x >= 600 && x < 680 ? 390 : x === 40 ? 1010 : x === 42 ? 450 : 0
      if (width && translated.length > original.length * 1.15) layout += ` textLength="${width}" lengthAdjust="spacingAndGlyphs"`
      if (locale === 'ar' && !['CPU', 'GPU'].includes(original)) {
        const rightEdges = { 40: 1060, 42: 490, 62: 478, 77: 463, 291: 480, 602: 1050, 622: 1038, 627: 1032, 637: 1023 }
        layout = layout.replace(/\bx="\d+"/, `x="${rightEdges[x] ?? x}"`)
        layout += ' direction="rtl" unicode-bidi="plaintext" text-anchor="start"'
      }
    }
    return `<${tag}${layout}>${escape(translated)}</${tag}>`
  })
  writeFileSync(resolve(root, `public/assets/docs/memory-pools.${locale}.svg`), svg)
}
