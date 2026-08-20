import { describe, expect, it } from 'vitest'
import { getContextStep, stepContext } from './context-stepper'

describe('context-stepper', () => {
  it('moves halfway toward the neighboring preset', () => {
    expect(getContextStep(4096, 'down')).toBe(1024)
    expect(stepContext(4096, 'down')).toBe(3072)
    expect(getContextStep(4096, 'up')).toBe(2048)
    expect(stepContext(4096, 'up')).toBe(6144)
  })

  it('completes the interval when moving again from a midpoint', () => {
    expect(getContextStep(3072, 'down')).toBe(1024)
    expect(stepContext(3072, 'down')).toBe(2048)
    expect(getContextStep(3072, 'up')).toBe(1024)
    expect(stepContext(3072, 'up')).toBe(4096)
    expect(getContextStep(6144, 'down')).toBe(2048)
    expect(stepContext(6144, 'down')).toBe(4096)
    expect(getContextStep(6144, 'up')).toBe(2048)
    expect(stepContext(6144, 'up')).toBe(8192)
  })

  it('does not move below the minimum context', () => {
    expect(stepContext(1024, 'down')).toBe(1024)
  })

  it('keeps dynamically extended levels symmetric above the largest preset', () => {
    expect(getContextStep(262144, 'up')).toBe(131072)
    expect(stepContext(262144, 'up')).toBe(393216)
    expect(getContextStep(393216, 'down')).toBe(131072)
    expect(stepContext(393216, 'down')).toBe(262144)
    expect(getContextStep(393216, 'up')).toBe(131072)
    expect(stepContext(393216, 'up')).toBe(524288)
  })
})
