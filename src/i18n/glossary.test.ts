/// <reference types="node" />
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { glossaryViolations, lengthViolations, violationId, type Glossary, type UsageNotes, type Violation } from './glossary'

const locales = ['zh-CN', 'zh-TW', 'ja', 'es', 'ru', 'de', 'fr', 'pt', 'ko', 'ar', 'hi', 'id']
const read = (path: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, path), 'utf8'))
const messages: Record<string, string> = read('messages.json')
const glossary: Glossary = read('glossary.json')
const notes: UsageNotes = read('usage-notes.json')
const catalogs: Record<string, Record<string, string>> = Object.fromEntries(locales.map(locale => [locale, read(`locales/${locale}.json`)]))
const baselinePath = resolve(import.meta.dirname, 'glossary-baseline.json')

const violations = [...glossaryViolations(glossary, messages, catalogs), ...lengthViolations(notes, catalogs)]
const describeViolation = (violation: Violation) => `${violationId(violation)} → “${catalogs[violation.locale][violation.key]}” (${violation.detail})`

// Regenerate after fixing translations: I18N_BASELINE=update npx vitest run src/i18n/glossary.test.ts
if (process.env.I18N_BASELINE === 'update') writeFileSync(baselinePath, JSON.stringify([...new Set(violations.map(violationId))].sort(), null, 2) + '\n')
const baseline: string[] = JSON.parse(readFileSync(baselinePath, 'utf8'))

describe('translation glossary', () => {
  it('defines a valid approved rendering for every term in every locale', () => {
    for (const term of glossary.terms) {
      expect(() => new RegExp(term.match, 'u'), term.id).not.toThrow()
      for (const exception of term.except ?? []) expect(() => new RegExp(exception, 'u'), `${term.id} except ${exception}`).not.toThrow()
      expect(Object.keys(term.translations).sort(), term.id).toEqual([...locales].sort())
      for (const [locale, translation] of Object.entries(term.translations)) {
        expect(translation.use.trim(), `${term.id} ${locale} use`).not.toBe('')
        expect(() => new RegExp(translation.accept, 'iu'), `${term.id} ${locale} accept`).not.toThrow()
        const avoid = translation.avoid
        if (avoid) expect(() => new RegExp(avoid, 'iu'), `${term.id} ${locale} avoid`).not.toThrow()
      }
    }
    expect(Object.keys(glossary.style).sort()).toEqual([...locales].sort())
  })

  it('introduces no glossary, register or length violations beyond the recorded baseline', () => {
    const known = new Set(baseline)
    expect(violations.filter(violation => !known.has(violationId(violation))).map(describeViolation), 'new violations: use the approved term, or shorten the label').toEqual([])
  })

  it('keeps the baseline limited to translations that still violate', () => {
    const current = new Set(violations.map(violationId))
    // Entries for deleted source messages are ignored so catalog refactors do not have to touch the baseline.
    const fixed = baseline.filter(id => !current.has(id) && Object.hasOwn(messages, id.split(' | ').slice(2).join(' | ')))
    expect(fixed, 'fixed translations: remove these baseline entries').toEqual([])
  })
})

describe('translator usage notes', () => {
  it('covers every catalog message with a page and element kind', () => {
    const located = new Set(Object.values(notes.pages).flatMap(page => Object.keys(page.messages)))
    expect(Object.keys(messages).filter(key => !located.has(key))).toEqual([])
  })

  it('keeps GLOSSARY.md in sync with glossary.json', () => {
    const result = spawnSync(process.execPath, [resolve(import.meta.dirname, '../../scripts/i18n-glossary.mjs'), '--check'], { encoding: 'utf8' })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('matches the current source tree', () => {
    const result = spawnSync(process.execPath, [resolve(import.meta.dirname, '../../scripts/i18n-usage.mjs'), '--check'], { encoding: 'utf8' })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  }, 30_000)
})
