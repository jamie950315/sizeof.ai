import { describe, expect, it } from 'vitest'
import { getMemoryBarPartPercents, getMemoryBarUsage } from './memory-bar'

describe('getMemoryBarUsage', () => {
  it('allocates half of the bar to a 12 GiB estimate on a 24 GiB device', () => {
    expect(getMemoryBarUsage(12, 24)).toEqual({
      usedPercent: 50,
      remainingPercent: 50,
      riskOpacity: 0,
      weightsOffloadOpacity: 0,
      offloadGiB: 0,
    })
  })

  it('starts a subtle warning tint at 80 percent usage', () => {
    expect(getMemoryBarUsage(19.2, 24)).toEqual({
      usedPercent: 80,
      remainingPercent: 20,
      riskOpacity: 0.16,
      weightsOffloadOpacity: 0,
      offloadGiB: 0,
    })
  })

  it('increases the warning tint as usage approaches and exceeds capacity', () => {
    expect(getMemoryBarUsage(21.6, 24).riskOpacity).toBeCloseTo(0.53, 2)
    expect(getMemoryBarUsage(30, 24)).toEqual({
      usedPercent: 100,
      remainingPercent: 0,
      riskOpacity: 0.9,
      weightsOffloadOpacity: 0.73,
      offloadGiB: 6,
    })
  })

  it('keeps the offload amount separate from the visible VRAM bar', () => {
    expect(getMemoryBarUsage(123.35, 24).offloadGiB).toBeCloseTo(99.35, 2)
  })

  it('keeps every non-zero memory category visible when one category dominates', () => {
    const parts = getMemoryBarPartPercents([4.53, 32, 4.15])

    expect(parts[0]).toBe(16)
    expect(parts[2]).toBe(16)
    expect(parts[1]).toBeCloseTo(68, 5)
    expect(parts.reduce((total, part) => total + part, 0)).toBeCloseTo(100, 5)
  })

  it('keeps invalid or missing capacity inputs finite', () => {
    expect(getMemoryBarUsage(Number.NaN, Number.NaN)).toEqual({
      usedPercent: 0,
      remainingPercent: 100,
      riskOpacity: 0,
      weightsOffloadOpacity: 0,
      offloadGiB: 0,
    })
    expect(getMemoryBarUsage(12, 0)).toEqual({
      usedPercent: 100,
      remainingPercent: 0,
      riskOpacity: 0.9,
      weightsOffloadOpacity: 0.9,
      offloadGiB: 12,
    })
  })
})
