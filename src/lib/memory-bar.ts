const WARNING_THRESHOLD = 0.8
const WARNING_START_OPACITY = 0.16
const WARNING_MAX_OPACITY = 0.9

export interface MemoryBarUsage {
  usedPercent: number
  remainingPercent: number
  riskOpacity: number
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
  }
}
