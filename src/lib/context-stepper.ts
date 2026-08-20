export const contextLevels = [2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144] as const

export type ContextDirection = 'up' | 'down'

const minimumContext = 1024
const contextBoundaries = [minimumContext, ...contextLevels]

function normalizedContext(value: number) {
  return Math.max(minimumContext, Math.round(value) || minimumContext)
}

function targetLevel(current: number, direction: ContextDirection) {
  if (direction === 'up') {
    return contextBoundaries.find((level) => level > current) ?? current * 2
  }
  return [...contextBoundaries].reverse().find((level) => level < current) ?? Math.max(minimumContext, current / 2)
}

function midpointBoundaries(current: number) {
  for (let index = 0; index < contextBoundaries.length - 1; index += 1) {
    const lower = contextBoundaries[index]
    const upper = contextBoundaries[index + 1]
    if (current === (lower + upper) / 2) return { lower, upper }
  }
  return null
}

export function getContextStep(current: number, direction: ContextDirection) {
  const normalized = normalizedContext(current)
  const midpoint = midpointBoundaries(normalized)
  if (midpoint) return Math.max(1, Math.round((midpoint.upper - midpoint.lower) / 2))
  return Math.max(1, Math.round(Math.abs(normalized - targetLevel(normalized, direction)) / 2))
}

export function stepContext(current: number, direction: ContextDirection) {
  const normalized = normalizedContext(current)
  const step = getContextStep(normalized, direction)
  return Math.max(minimumContext, normalized + (direction === 'up' ? step : -step))
}
