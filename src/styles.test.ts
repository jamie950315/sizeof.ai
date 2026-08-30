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
})
