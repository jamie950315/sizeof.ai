import { describe, expect, it } from 'vitest'
import { costBudget, DEFAULT_HARDWARE_PLAN as defaults, hardwareSearch, hardwareSummary, memoryBudget, numberInput, parseHardwarePlan, storageBudget } from './hardware'

describe('hardware planning math', () => {
  it('reserves memory per device without implying pooled compatibility', () => {
    expect(memoryBudget({ ...defaults, memory: 'multi', devices: '4' })).toEqual({ capacity: 24, reserve: 2, devices: 4, perDevice: 22, total: 88 })
    expect(memoryBudget({ ...defaults, reserve: '24' }).total).toBe(0)
    expect(() => memoryBudget({ ...defaults, reserve: '25' })).toThrow()
    expect(() => memoryBudget({ ...defaults, memory: 'multi', devices: '1.5' })).toThrow(/whole/)
  })
  it.each(['', ' ', 'NaN', 'Infinity', '-1', '0x10', '1e2', '1,000'])('rejects malformed input %j', value => {
    expect(() => numberInput(value, 'Value')).toThrow()
  })
  it('converts decimal parameter weights to binary memory units', () => {
    const s = storageBudget({ ...defaults, parameters: '8', bits: '4', copies: '1', staging: '0', mbps: '100', efficiency: '100' })
    expect(s.weightsGiB).toBeCloseTo(4e9 / 2 ** 30)
    expect(s.downloadGB).toBeCloseTo(4)
    expect(s.seconds).toBeCloseTo(320)
    expect(s.peakGiB).toBe(s.retainedGiB)
  })
  it('staging affects peak disk but never download volume or time', () => {
    const a = storageBudget({ ...defaults, source: 'exact', exact: '10', copies: '3', staging: '0' })
    const b = storageBudget({ ...defaults, source: 'exact', exact: '10', copies: '3', staging: '2' })
    expect(a.retainedGiB).toBe(30); expect(b.peakGiB).toBe(50)
    expect(a.seconds).toBe(b.seconds); expect(a.downloadGB).toBe(b.downloadGB)
    expect(() => storageBudget({ ...defaults, copies: '1.2' })).toThrow(/whole/)
    expect(() => storageBudget({ ...defaults, efficiency: '0' })).toThrow()
    expect(() => storageBudget({ ...defaults, mbps: '0' })).toThrow()
  })
  it('computes 30-day electricity and positive-only payback', () => {
    const p = { ...defaults, watts: '1000', hours: '2', tariff: '0.2', apiPrice: '10', tokens: '10', purchase: '880' }
    expect(costBudget(p)).toEqual({ energy: 60, electricity: 12, api: 100, monthlySaving: 88, breakEvenMonths: 10 })
    expect(costBudget({ ...p, apiPrice: '0' }).breakEvenMonths).toBeNull()
    expect(costBudget({ ...p, apiPrice: '1.2' }).breakEvenMonths).toBeNull()
    expect(() => costBudget({ ...p, hours: '25' })).toThrow()
  })
  it('round-trips all inputs and refuses ambiguous or oversized links', () => {
    expect(parseHardwarePlan(hardwareSearch(defaults))).toEqual(defaults)
    expect(() => parseHardwarePlan('?memory=wrong')).toThrow()
    expect(() => parseHardwarePlan('?source=wrong')).toThrow()
    expect(() => parseHardwarePlan('?capacity=2&capacity=3')).toThrow(/Duplicate/)
    expect(() => parseHardwarePlan('?capacity=' + '1'.repeat(33))).toThrow(/too long/)
    expect(() => parseHardwarePlan('x'.repeat(4097))).toThrow(/too long/)
    expect(parseHardwarePlan('?capacity=bad').capacity).toBe('bad')
    expect(() => hardwareSearch({ ...defaults, capacity: 'bad' })).toThrow()
  })
  it('exports assumptions and limits with readable units', () => {
    const summary = hardwareSummary(defaults)
    expect(summary).toContain('GiB'); expect(summary).toContain('GB,'); expect(summary).toContain('not a compatibility or speed guarantee')
    expect(summary).not.toContain('NaN'); expect(summary).toContain('Inputs: memory=dedicated')
  })
})
