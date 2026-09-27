/** Glossary and usage-note checks for checked-in locale catalogs. Pure functions; callers supply the data. */

export interface GlossaryTranslation { use: string; accept: string; avoid?: string; note?: string }
export interface GlossaryTerm {
  id: string
  en: string
  match: string
  caseSensitive?: boolean
  sense: string
  except?: string[]
  translations: Record<string, GlossaryTranslation>
}
export interface Glossary {
  style: Record<string, { register: string; avoid: { pattern: string; reason: string }[] }>
  terms: GlossaryTerm[]
}
export interface UsageNote { kind: string; maxWidth: number | null; where: string[]; alsoUsedAs?: string[] }
export interface UsageNotes { pages: Record<string, { title: string; messages: Record<string, UsageNote> }> }
export interface Violation { locale: string; rule: string; key: string; detail: string }

/** Remove marks that vary between equally correct spellings: Arabic harakat/tatweel and Devanagari nukta. */
export function normalizeForMatch(text: string): string {
  return text.normalize('NFC').replace(/[ً-ٰٟـ़]/g, '').normalize('NFC')
}

/** Display width with East Asian wide characters counted as two columns. Mirrors scripts/i18n-usage.mjs. */
export function displayWidth(text: string): number {
  let width = 0
  for (const char of text.normalize('NFC')) {
    const code = char.codePointAt(0) ?? 0
    if (/\p{Mn}|\p{Me}|\p{Cf}/u.test(char)) continue
    width += (code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3)
      || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe4f) || (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6) ? 2 : 1
  }
  return width
}

/** Messages that are identifiers, class names or code rather than prose are not held to the glossary. */
function checkable(key: string, value: string): boolean {
  if (value === key) return false
  if (/^[a-z][a-z0-9_-]*$/.test(key)) return false
  return true
}

/** `\\b` in glossary patterns means a Unicode word boundary, so accented and non-Latin letters count as word characters. */
const boundary = '(?:(?<=[\\p{L}\\p{N}_])(?![\\p{L}\\p{N}_])|(?<![\\p{L}\\p{N}_])(?=[\\p{L}\\p{N}_]))'
const pattern = (source: string, caseSensitive = false) => new RegExp(source.replaceAll('\\b', boundary), caseSensitive ? 'u' : 'iu')

export function glossaryViolations(glossary: Glossary, messages: Record<string, string>, catalogs: Record<string, Record<string, string>>): Violation[] {
  const violations: Violation[] = []
  for (const [locale, catalog] of Object.entries(catalogs)) {
    const style = glossary.style[locale]
    for (const key of Object.keys(messages)) {
      const value = catalog[key]
      if (typeof value !== 'string' || !checkable(key, value)) continue
      const text = normalizeForMatch(value)
      for (const rule of style?.avoid ?? []) {
        const found = pattern(rule.pattern).exec(text)
        if (found) violations.push({ locale, rule: 'style', key, detail: `“${found[0]}”: ${rule.reason}` })
      }
      for (const term of glossary.terms) {
        if (!pattern(term.match, term.caseSensitive).test(key)) continue
        if (term.except?.some(exception => pattern(exception, true).test(key))) continue
        const approved = term.translations[locale]
        if (!approved) continue
        const avoided = approved.avoid ? pattern(normalizeForMatch(approved.avoid)).exec(text) : null
        if (avoided) violations.push({ locale, rule: `${term.id}:avoid`, key, detail: `“${avoided[0]}”; use “${approved.use}”` })
        else if (!pattern(normalizeForMatch(approved.accept)).test(text)) violations.push({ locale, rule: `${term.id}:missing`, key, detail: `use “${approved.use}”` })
      }
    }
  }
  return violations
}

export function lengthViolations(notes: UsageNotes, catalogs: Record<string, Record<string, string>>): Violation[] {
  const budgets = new Map<string, UsageNote>()
  for (const page of Object.values(notes.pages)) for (const [key, note] of Object.entries(page.messages)) if (note.maxWidth) budgets.set(key, note)
  const violations: Violation[] = []
  for (const [locale, catalog] of Object.entries(catalogs)) {
    for (const [key, note] of budgets) {
      const value = catalog[key]
      if (typeof value !== 'string' || !checkable(key, value)) continue
      const width = displayWidth(value.replace(/\{\d+\}/g, ''))
      if (width > note.maxWidth!) violations.push({ locale, rule: 'length', key, detail: `${note.kind} is ${width} columns; budget ${note.maxWidth}` })
    }
  }
  return violations
}

export const violationId = (violation: Violation) => `${violation.locale} | ${violation.rule} | ${violation.key}`
