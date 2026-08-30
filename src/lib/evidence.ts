import type { ModelSpec } from '../data/models'
import type { HuggingFaceVariant } from './huggingface-variants'

export interface EvidenceEntry {
  id: string
  label: string
  kind: 'verified' | 'derived' | 'unknown'
  detail: string
  sourceUrl?: string
  revision?: string
  fetchedAt?: string
}

export function buildModelEvidence(
  model: ModelSpec,
  selectedVariant: HuggingFaceVariant | null,
): EvidenceEntry[] {
  const weightsOnly = model.estimateConfidence === 'weights-only'
  const entries: EvidenceEntry[] = weightsOnly ? [] : [{
    id: 'model-specification',
    label: 'Published model specification',
    kind: 'verified',
    detail: 'Published model parameters, context limit, and cache geometry used by this calculator.',
    sourceUrl: model.sourceUrl,
  }]

  if (selectedVariant) {
    entries.push({
      id: `variant:${selectedVariant.id}`,
      label: 'Verified selected artifact',
      kind: 'verified',
      detail: `Published artifact size for ${selectedVariant.path} locked to revision ${selectedVariant.revision}.`,
      sourceUrl: selectedVariant.sourceUrl,
      revision: selectedVariant.revision,
    })
  } else {
    entries.push({
      id: 'weights-estimate',
      label: 'Estimated model weights',
      kind: 'derived',
      detail: 'Weight memory is derived from the selected bit precision and published parameter count.',
      sourceUrl: model.sourceUrl,
    })
  }

  if (!weightsOnly) {
    entries.push({
      id: 'memory-formula',
      label: 'Derived memory estimate',
      kind: 'derived',
      detail: 'KV cache and runtime reserve are calculated from the selected context and precision settings.',
    })
  }

  if (model.estimateConfidence === 'runtime-specific') {
    entries.push({
      id: 'estimate-confidence',
      label: 'Runtime-specific memory factors',
      kind: 'unknown',
      detail: 'This architecture has engine-dependent runtime state, so the total cannot be treated as a safe fit claim.',
    })
  }
  if (model.estimateConfidence === 'weights-only') {
    entries.push({
      id: 'cache-geometry',
      label: 'Cache geometry',
      kind: 'unknown',
      detail: 'The repository does not provide enough cache geometry for a safe context-dependent estimate.',
    }, {
      id: 'kv-cache',
      label: 'KV cache memory',
      kind: 'unknown',
      detail: 'KV cache residency cannot be calculated safely from the available repository facts.',
    })
    entries.push({
      id: 'runtime-factors',
      label: 'Runtime memory factors',
      kind: 'unknown',
      detail: 'The repository does not provide enough runtime facts for a complete memory estimate.',
    })
  }
  return entries
}
