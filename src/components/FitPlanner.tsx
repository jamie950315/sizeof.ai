import type { ModelSpec } from '../data/models'
import type { KvPrecisionId, QuantizationId } from '../data/quantizations'
import { buildFitAdjustments, findMaximumSafeContext, type FitAdjustment } from '../lib/planner'
import { formatMessage, translate } from '../i18n/core'

interface PlannerProps {
  model: ModelSpec
  unavailableReason?: string
  capacityGiB: number
  context: number
  quantization: QuantizationId
  kvPrecision: KvPrecisionId
  mlaCacheMode: 'expanded' | 'latent'
  weightBytesOverride?: number
  additionalWeightBytes?: number
  totalGiB: number
  onApply: (adjustment: FitAdjustment) => void
}

type Props = PlannerProps | { model?: undefined; unavailableReason: string }

const refusalLabels = {
  'fixed-artifact-precision': 'The selected artifact has a fixed precision; choose another artifact to change it.',
  'invalid-capacity': 'Choose a positive usable memory capacity to plan a fit.',
  'runtime-specific': 'This runtime-specific model cannot guarantee a precise fit.',
  'weights-only': 'This model does not publish enough cache geometry for a safe fit plan.',
  'missing-safe-geometry': 'This model does not publish enough verified geometry for a safe fit plan.',
  'mla-mode-required': 'Choose an MLA cache layout before planning a fit.',
  'native-context-too-small': 'The published native context is too small for a safe planner result.',
  'weights-do-not-fit': 'The model weights do not fit in the usable memory capacity.',
  'no-precision-fits': 'No supported weight precision fits at the selected context.',
} as const

function adjustmentLabel(adjustment: FitAdjustment) {
  if (adjustment.field === 'context') return formatMessage('Use {0} token context', [adjustment.value])
  if (adjustment.field === 'kvPrecision') return formatMessage('Use {0} KV precision', [adjustment.value])
  return formatMessage('Use {0} weight precision', [adjustment.value])
}

export default function FitPlanner(props: Props) {
  if (!props.model) {
    return <section className="fit-planner" aria-label="Fit planner"><h3>Fit planner</h3><p>{translate(props.unavailableReason ?? 'A precise fit plan is unavailable for this model.')}</p></section>
  }
  const options = {
    quantization: props.quantization,
    context: props.context,
    kvPrecision: props.kvPrecision,
    mlaCacheMode: props.mlaCacheMode,
    weightBytesOverride: props.weightBytesOverride,
    additionalWeightBytes: props.additionalWeightBytes,
  }
  const maximum = findMaximumSafeContext(props.model, {
    quantization: props.quantization,
    kvPrecision: props.kvPrecision,
    mlaCacheMode: props.mlaCacheMode,
    weightBytesOverride: props.weightBytesOverride,
    additionalWeightBytes: props.additionalWeightBytes,
  }, props.capacityGiB)
  const adjustments = buildFitAdjustments(props.model, { ...options, capacityGiB: props.capacityGiB })
  const refusal = maximum.kind === 'unavailable' && maximum.reason !== 'weights-do-not-fit'
    ? refusalLabels[maximum.reason]
    : null

  return (
    <section className="fit-planner" aria-label="Fit planner">
      <h3>Fit planner</h3>
      {refusal ? <p>{translate(refusal)}</p> : maximum.kind === 'available'
        ? <p>Maximum safe native context: <strong>{maximum.context} tokens</strong>.</p>
        : <p>The current weight precision does not fit; try a deterministic adjustment.</p>}
      {!refusal && props.totalGiB > props.capacityGiB && adjustments.length > 0 && (
        <ul>
          {adjustments.map((adjustment) => (
            <li key={`${adjustment.field}:${adjustment.value}`}>
              <span>{adjustmentLabel(adjustment)} — {adjustment.estimate.totalGiB.toFixed(2)} GiB</span>
              <button type="button" aria-label={`Apply: ${adjustmentLabel(adjustment)}`} onClick={() => props.onApply(adjustment)}>Apply</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
