import { describe, expect, it } from 'vitest'
import { DEFAULT_DIAGNOSTIC, diagnosticChecklist, diagnosticPath, diagnosticSearch, parseDiagnostic, PATHS, sanitizeDiagnosticNote, STAGES, SYSTEMS } from './troubleshooting'
import { findDocArticle } from '../docs/content'

describe('diagnostic paths', () => {
  for (const [stage] of STAGES) for (const path of PATHS[stage]) for (const os of SYSTEMS) {
    it(`reaches ${stage}/${path.id}/${os} through a shared link`, () => {
      const selection = { stage, symptom: path.id, os }
      expect(parseDiagnostic(diagnosticSearch(selection))).toEqual(selection)
      expect(diagnosticPath(selection)).toEqual(path)
      expect(path.questions).toHaveLength(2)
      expect(path.stop.length).toBeGreaterThan(40)
      expect(findDocArticle(path.doc)).toBeDefined()
      expect(diagnosticChecklist(selection)).toContain(path.check)
    })
  }
  it('accepts an empty link and rejects unknown or ambiguous values visibly', () => {
    expect(parseDiagnostic('')).toEqual(DEFAULT_DIAGNOSTIC)
    for (const query of ['?stage=garbage', '?stage=load&symptom=access', '?os=unknown', '?v=3', '?stage=load&stage=download', '?notes=private', '?x=' + 'x'.repeat(1100), '?stage=__proto__']) {
      expect(() => parseDiagnostic(query)).toThrow()
    }
  })
  it('serializes an allowlist and cannot accidentally share added note fields', () => {
    const selection = { ...DEFAULT_DIAGNOSTIC, notes: 'private-secret', answers: ['private-answer'] }
    expect(diagnosticSearch(selection)).not.toContain('private')
    expect(diagnosticChecklist(selection)).not.toContain('private-secret')
    expect(diagnosticChecklist(selection)).not.toContain('private-answer')
    expect(diagnosticChecklist(selection)).toContain('FIRST error')
  })
  it('bounds notes and removes terminal control/bidi spoofing without claiming secret detection', () => {
    expect(sanitizeDiagnosticNote('a\u0000\u001b\u202eb\nline')).toBe('ab\nline')
    expect(sanitizeDiagnosticNote('x'.repeat(5000))).toHaveLength(4000)
    expect(sanitizeDiagnosticNote('ordinary-token')).toBe('ordinary-token')
  })
})
