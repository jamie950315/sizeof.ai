const WARNING_THRESHOLD = 0.8
const WARNING_START_OPACITY = 0.16
const WARNING_MAX_OPACITY = 0.9
const MIN_VISIBLE_PART_PERCENT = 16

export interface MemoryBarUsage {
  usedPercent: number
  remainingPercent: number
  riskOpacity: number
  offloadGiB: number
}

export function getMemoryBarPartPercents(valuesGiB: readonly number[]) {
  const values = valuesGiB.map((value) => Number.isFinite(value) ? Math.max(0, value) : 0)
  const totalGiB = values.reduce((total, value) => total + value, 0)
  const positiveCount = values.filter((value) => value > 0).length
  if (totalGiB <= 0 || positiveCount === 0) return values.map(() => 0)

  const minimumPercent = Math.min(MIN_VISIBLE_PART_PERCENT, 100 / positiveCount)
  const rawPercents = values.map((value) => (value / totalGiB) * 100)
  const minimumPercents = values.map((value) => value > 0 ? minimumPercent : 0)
  const remainingPercent = 100 - minimumPercents.reduce((total, value) => total + value, 0)
  const excessPercents = rawPercents.map((value) => value > minimumPercent ? value - minimumPercent : 0)
  const excessTotal = excessPercents.reduce((total, value) => total + value, 0)

  if (excessTotal <= 0) return minimumPercents
  return minimumPercents.map((minimum, index) => minimum + remainingPercent * (excessPercents[index] / excessTotal))
}

export function getMemoryBarUsage(totalGiB: number, vramGiB: number): MemoryBarUsage {
  const usageRatio = vramGiB > 0 ? Math.max(0, totalGiB / vramGiB) : 1
  const stableUsageRatio = Math.round(usageRatio * 10000) / 10000
  const usedPercent = Math.min(100, usageRatio * 100)
  const remainingPercent = 100 - usedPercent
  const riskOpacity = stableUsageRatio < WARNING_THRESHOLD
    ? 0
    : Math.min(
        WARNING_MAX_OPACITY,
        WARNING_START_OPACITY +
          ((stableUsageRatio - WARNING_THRESHOLD) / (1 - WARNING_THRESHOLD)) *
            (WARNING_MAX_OPACITY - WARNING_START_OPACITY),
      )

  return {
    usedPercent,
    remainingPercent,
    riskOpacity: Number(riskOpacity.toFixed(2)),
    offloadGiB: vramGiB > 0 ? Math.max(0, totalGiB - vramGiB) : Math.max(0, totalGiB),
  }
}
