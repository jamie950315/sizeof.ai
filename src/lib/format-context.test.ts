import { describe, expect, it } from 'vitest'
import { formatContextTokens } from './format-context'

describe('formatContextTokens', () => {
  it('uses binary K/M for power-of-two style context lengths', () => {
    expect(formatContextTokens(4096)).toBe('4K')
    expect(formatContextTokens(40960)).toBe('40K')
    expect(formatContextTokens(131072)).toBe('128K')
    expect(formatContextTokens(163840)).toBe('160K')
    expect(formatContextTokens(262144)).toBe('256K')
    expect(formatContextTokens(1_048_576)).toBe('1M')
  })

  it('keeps decimal K/M for context lengths published in decimal units', () => {
    expect(formatContextTokens(128_000)).toBe('128K')
    expect(formatContextTokens(1_000_000)).toBe('1M')
  })

  it('does not round midpoint stepper values onto a neighbouring level', () => {
    expect(formatContextTokens(1536)).toBe('1.5K')
    expect(formatContextTokens(393216)).toBe('384K')
    expect(formatContextTokens(512)).toBe('512')
  })
})
