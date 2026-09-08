export const contextLevels = [2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144] as const

export type ContextDirection = 'up' | 'down'

const minimumContext = 1024
export const maximumContext = 16_777_216
const contextBoundaries = [minimumContext, ...contextLevels]

export function normalizedContext(value: number) {
  const rounded = Math.round(value)
  return Number.isFinite(rounded) ? Math.min(maximumContext, Math.max(minimumContext, rounded || minimumContext)) : minimumContext
}

function contextBoundariesThrough(current: number) {
  const levels = [...contextBoundaries]
  while (levels[levels.length - 1] <= current) {
    levels.push(levels[levels.length - 1] * 2)
  }
  return levels
}

function targetLevel(current: number, direction: ContextDirection) {
  const levels = contextBoundariesThrough(current)
  if (direction === 'up') {
    return levels.find((level) => level > current) ?? current * 2
  }
  return [...levels].reverse().find((level) => level < current) ?? Math.max(minimumContext, current / 2)
}

function midpointBoundaries(current: number) {
  const levels = contextBoundariesThrough(current)
  for (let index = 0; index < levels.length - 1; index += 1) {
    const lower = levels[index]
    const upper = levels[index + 1]
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
  return normalizedContext(normalized + (direction === 'up' ? step : -step))
}
