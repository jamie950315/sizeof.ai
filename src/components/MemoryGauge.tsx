import type { CSSProperties } from 'react'
import { getMemoryBarPartPercents, getMemoryBarUsage } from '../lib/memory-bar'

export interface MemoryPart {
  label: string
  value: number
  className: string
}

interface Props {
  parts: MemoryPart[]
  totalGiB: number
  capacityGiB: number
  ariaLabel: string
  /** Lower bounds never claim an offload amount or tint the weights as offloaded. */
  lowerBound?: boolean
  showScale?: boolean
  className?: string
}

function scaleLabel(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export function offloadText(offloadGiB: number) {
  return `OFFLOAD ${offloadGiB.toFixed(2)} GiB`
}

/** A ruler-scaled capacity bar: the track is the selected memory capacity. */
export default function MemoryGauge({ parts, totalGiB, capacityGiB, ariaLabel, lowerBound = false, showScale = true, className }: Props) {
  const usage = getMemoryBarUsage(totalGiB, capacityGiB)
  const percents = getMemoryBarPartPercents(parts.map((part) => part.value))
  const weightsOffloadOpacity = lowerBound ? 0 : usage.weightsOffloadOpacity
  const offloadLabel = !lowerBound && usage.offloadGiB > 0 ? offloadText(usage.offloadGiB) : null
  const safeCapacity = Number.isFinite(capacityGiB) && capacityGiB > 0 ? capacityGiB : 0
  return (
    <div className={`gauge${className ? ` ${className}` : ''}`}>
      {showScale && safeCapacity > 0 && (
        <div className="gauge-scale" aria-hidden="true">
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
            <span key={ratio} style={{ left: `${ratio * 100}%` }}>
              {ratio === 1 ? `${scaleLabel(safeCapacity)} GiB` : scaleLabel(safeCapacity * ratio)}
            </span>
          ))}
        </div>
      )}
      <div
        className={`memory-bar${offloadLabel ? ' has-offload' : ''}`}
        role="img"
        data-motion="memory-usage"
        aria-label={ariaLabel}
      >
        <div
          className="memory-bar-used"
          style={{
            width: `${usage.usedPercent}%`,
            '--memory-weights-offload-opacity': weightsOffloadOpacity,
          } as CSSProperties}
        >
          {parts.map((part, index) => (
            <span className={part.className} key={part.label} style={{ width: `${percents[index]}%` }} />
          ))}
          <span className="memory-bar-risk" aria-hidden="true" style={{ opacity: usage.riskOpacity }} />
        </div>
        <span className="memory-bar-remaining" aria-hidden="true" style={{ width: `${usage.remainingPercent}%` }} />
        {offloadLabel && <span className="memory-bar-offload">{offloadLabel}</span>}
      </div>
    </div>
  )
}
