import { describe, expect, it } from 'vitest'
import {
  EXPORT_SCHEMA_VERSION,
  createSizingExport,
  exportSizingCsv,
  exportSizingMarkdown,
} from './export'

const input = {
  model: { id: 'Qwen/Example', sourceUrl: 'https://huggingface.co/Qwen/Example' },
  configuration: { quantization: '4bit', contextTokens: 8192, kvPrecision: 'FP16' },
  hardware: { capacityGiB: 32 },
  estimate: { kind: 'lower-bound' as const, totalGiB: 18.5, weightsGiB: 15, kvCacheGiB: Number.NaN, runtimeGiB: Number.POSITIVE_INFINITY },
  evidence: [{ id: 'weights', label: 'Published "artifact"', kind: 'verified' as const, detail: 'line one\nline two', sourceUrl: 'https://huggingface.co/Qwen/Example' }],
  generatedAt: '2026-08-30T12:00:00.000Z',
}

describe('sizing exports', () => {
  it('creates a deterministic versioned JSON record without non-finite values', () => {
    expect(createSizingExport(input)).toEqual({
      schemaVersion: EXPORT_SCHEMA_VERSION,
      generatedAt: '2026-08-30T12:00:00.000Z',
      disclaimer: 'Estimate, not a benchmark or guarantee.',
      model: { canonicalId: 'Qwen/Example', sourceUrl: 'https://huggingface.co/Qwen/Example' },
      configuration: { contextTokens: 8192, kvPrecision: 'FP16', quantization: '4bit' },
      hardware: { capacityGiB: 32 },
      estimate: { status: 'lower-bound', totalGiB: 18.5, weightsGiB: 15 },
      evidence: [{ id: 'weights', kind: 'verified', label: 'Published "artifact"', detail: 'line one\nline two', sourceUrl: 'https://huggingface.co/Qwen/Example' }],
    })
  })

  it('uses RFC-4180 quotes, formula escaping, and stable key ordering for CSV', () => {
    const csv = exportSizingCsv({
      ...input,
      model: { id: '=danger,\"quoted\"', sourceUrl: 'https://huggingface.co/Qwen/Example' },
      evidence: [],
    })

    expect(csv).toBe([
      'field,value',
      'schemaVersion,1',
      'generatedAt,2026-08-30T12:00:00.000Z',
      'disclaimer,"Estimate, not a benchmark or guarantee."',
      'model.canonicalId,"\'=danger,\"\"quoted\"\""',
      'model.sourceUrl,https://huggingface.co/Qwen/Example',
      'configuration.contextTokens,8192',
      'configuration.kvPrecision,FP16',
      'configuration.quantization,4bit',
      'hardware.capacityGiB,32',
      'estimate.status,lower-bound',
      'estimate.totalGiB,18.5',
      'estimate.weightsGiB,15',
    ].join('\r\n'))
  })

  it('renders readable Markdown with lower-bound status and omits missing fields', () => {
    const markdown = exportSizingMarkdown(input)

    expect(markdown).toContain('# sizeof.ai sizing export')
    expect(markdown).toContain('- Status: LOWER BOUND')
    expect(markdown).toContain('- Weights: 15 GiB')
    expect(markdown).not.toContain('KV cache:')
    expect(markdown).not.toContain('Infinity')
    expect(markdown).toContain('Estimate, not a benchmark or guarantee.')
  })
})
