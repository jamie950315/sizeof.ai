import { describe, expect, it } from 'vitest'
import { getMemoryBarUsage } from './memory-bar'

describe('getMemoryBarUsage', () => {
  it('allocates half of the bar to a 12 GiB estimate on a 24 GiB device', () => {
    expect(getMemoryBarUsage(12, 24)).toEqual({
      usedPercent: 50,
      remainingPercent: 50,
      riskOpacity: 0,
    })
  })

  it('starts a subtle warning tint at 80 percent usage', () => {
    expect(getMemoryBarUsage(19.2, 24)).toEqual({
      usedPercent: 80,
      remainingPercent: 20,
      riskOpacity: 0.16,
    })
  })

  it('increases the warning tint as usage approaches and exceeds capacity', () => {
    expect(getMemoryBarUsage(21.6, 24).riskOpacity).toBeCloseTo(0.53, 2)
    expect(getMemoryBarUsage(30, 24)).toEqual({
      usedPercent: 100,
      remainingPercent: 0,
      riskOpacity: 0.9,
    })
  })
})
