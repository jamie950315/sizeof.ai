import { describe, expect, it } from 'vitest'
import stylesheet from './styles.css?raw'

describe('mobile sticky result CSS', () => {
  it('shows the sticky result only at narrow widths', () => {
    expect(stylesheet).toMatch(/@media \(max-width: 620px\) \{[\s\S]*?\.detail-sticky-result \{[\s\S]*?position: sticky/)
  })

  it('returns the sticky result to normal flow on short narrow viewports', () => {
    expect(stylesheet).toMatch(/@media \(max-width: 620px\) and \(max-height: 620px\) \{[\s\S]*?\.detail-sticky-result \{ position: static; \}/)
  })

  it('removes sticky-result motion when reduced motion is requested', () => {
    expect(stylesheet).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.detail-sticky-result \{ transition: none; \}/)
  })

  it('keeps comparison cards in normal DOM-width flow on mobile without horizontal overflow', () => {
    expect(stylesheet).toMatch(/@media \(max-width: 620px\) \{[\s\S]*?\.compare-cards \{[\s\S]*?grid-template-columns: 1fr;[\s\S]*?overflow-x: hidden;/)
    expect(stylesheet).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.compare-card[\s\S]*?transition: none;/)
  })

  it('makes the compact comparison model selector sticky and motion-safe on mobile', () => {
    expect(stylesheet).toMatch(/@media \(max-width: 620px\) \{[\s\S]*?\.compare-mobile-selector \{[\s\S]*?position: sticky;[\s\S]*?overflow-x: auto;/)
    expect(stylesheet).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.compare-mobile-selector[\s\S]*?transition: none;/)
  })

  it('collapses live search rows to explicit mobile tracks without implicit columns', () => {
    expect(stylesheet).toMatch(/@media \(max-width: 900px\) \{[\s\S]*?\.search-results-table \.catalog-row \{ grid-template-columns: minmax\(0, 1fr\) auto auto auto; \}/)
    expect(stylesheet).toMatch(/\.search-results-table \.catalog-row > div:nth-child\(2\), \.search-results-table \.catalog-row > div:nth-child\(3\) \{ display: none; \}/)
  })

  it.each([390, 320])('uses exactly two populated search-row tracks at %ipx', (width) => {
    expect(width).toBeLessThanOrEqual(620)
    expect(stylesheet).toMatch(/@media \(max-width: 620px\) \{[\s\S]*?\.search-results-table \.catalog-row \{ grid-template-columns: minmax\(0, 1fr\) auto; \}/)
    expect(stylesheet).toMatch(/@media \(max-width: 620px\) \{[\s\S]*?\.search-results-table \.catalog-row > div:nth-child\(2\), \.search-results-table \.catalog-row > div:nth-child\(3\), \.search-results-table \.catalog-row > div:nth-child\(4\), \.search-results-table \.catalog-row > div:nth-child\(5\) \{ display: none; \}/)
  })

  it('keeps serving disclosure responsive and removes its motion for reduced-motion users', () => {
    expect(stylesheet).toMatch(/\.serving-scenario[\s\S]*?min-width: 0;/)
    expect(stylesheet).toMatch(/@media \(max-width: 620px\) \{[\s\S]*?\.serving-input-grid \{ grid-template-columns: 1fr; \}/)
    expect(stylesheet).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.serving-scenario[\s\S]*?transition: none;/)
  })

  it('keeps catalog compare actions icon-sized and reveals their label only on hover or keyboard focus', () => {
    expect(stylesheet).toMatch(/\.catalog-compare-action\s*\{[\s\S]*?width: 38px;/)
    expect(stylesheet).toMatch(/\.catalog-compare-label\s*\{[\s\S]*?opacity: 0;/)
    expect(stylesheet).toMatch(/\.catalog-compare-action:(?:hover|focus-visible)[\s\S]*?\.catalog-compare-label/)
  })

  it('gives comparison cards calculator-style memory bars and responsive quantization controls', () => {
    expect(stylesheet).toMatch(/\.compare-memory-bar[\s\S]*?\.memory-bar/)
    expect(stylesheet).toMatch(/\.compare-quant-grid\s*\{[\s\S]*?grid-template-columns:/)
    expect(stylesheet).toMatch(/@media \(max-width: 620px\) \{[\s\S]*?\.compare-quant-grid/)
  })
})
