import { describe, expect, it } from 'vitest'
import type { ModelSpec } from '../data/models'
import type { HuggingFaceVariant } from './huggingface-variants'
import { buildModelEvidence } from './evidence'

const safeModel: ModelSpec = {
  id: 'evidence-fixture', name: 'Evidence Fixture', family: 'Test', maker: 'Lab',
  parametersB: 1, layers: 10, kvHeads: 2, headDim: 64, maxContext: 8192,
  releaseYear: 2026, strengths: [], sourceUrl: 'https://example.com/model',
}

const verifiedVariant: HuggingFaceVariant = {
  id: 'deadbeef:weights.gguf', label: 'GGUF Q4', format: 'gguf', revision: 'deadbeef',
  path: 'weights.gguf', source: 'file', role: 'model', bitsPerWeight: 4,
  weightSizeBytes: 1024 ** 3, totalSizeBytes: 1024 ** 3,
  sourceUrl: 'https://huggingface.co/example/resolve/deadbeef/weights.gguf',
}

describe('model evidence', () => {
  it('labels estimated weights as derived and selected revision-locked artifacts as verified', () => {
    const estimated = buildModelEvidence(safeModel, null)
    const verified = buildModelEvidence(safeModel, verifiedVariant)

    expect(estimated).toContainEqual(expect.objectContaining({
      id: 'weights-estimate', kind: 'derived', label: 'Estimated model weights',
    }))
    expect(verified).toContainEqual(expect.objectContaining({
      id: 'variant:deadbeef:weights.gguf', kind: 'verified', revision: 'deadbeef',
      sourceUrl: verifiedVariant.sourceUrl,
    }))
  })

  it('makes runtime gaps and unsafe lower-bound models explicitly unknown', () => {
    expect(buildModelEvidence({ ...safeModel, estimateConfidence: 'weights-only' }, null))
      .toContainEqual(expect.objectContaining({ id: 'runtime-factors', kind: 'unknown' }))
    expect(buildModelEvidence({ ...safeModel, estimateConfidence: 'runtime-specific' }, null))
      .toContainEqual(expect.objectContaining({ id: 'estimate-confidence', kind: 'unknown' }))
  })

  it('keeps weights-only cache geometry, KV, and runtime facts unknown', () => {
    const evidence = buildModelEvidence({ ...safeModel, estimateConfidence: 'weights-only' }, null)

    expect(evidence).toContainEqual(expect.objectContaining({ id: 'cache-geometry', kind: 'unknown' }))
    expect(evidence).toContainEqual(expect.objectContaining({ id: 'kv-cache', kind: 'unknown' }))
    expect(evidence).toContainEqual(expect.objectContaining({ id: 'runtime-factors', kind: 'unknown' }))
    expect(evidence).not.toContainEqual(expect.objectContaining({ id: 'model-specification' }))
    expect(evidence).not.toContainEqual(expect.objectContaining({ id: 'memory-formula' }))
  })
})
