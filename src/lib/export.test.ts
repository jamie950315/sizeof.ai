import { describe, expect, it } from 'vitest'
import { EXPORT_SCHEMA_VERSION, createSizingExport, exportSizingCsv, exportSizingMarkdown } from './export'

const input = {
  generatedAt: '2026-08-30T12:00:00.000Z',
  records: [{
    model: { id: 'Qwen/Example', sourceUrl: 'https://huggingface.co/Qwen/Example?token=secret#private' },
    configuration: { quantization: '4bit', contextTokens: 8192, kvPrecision: 'FP16', mlaCacheMode: 'expanded', source: 'unsloth', variantId: 'Q4_K_M', artifactWeightGiB: 15.2 },
    hardware: { capacityGiB: 32 },
    estimate: { kind: 'lower-bound' as const, totalGiB: 18.5, weightsGiB: 15, kvCacheGiB: Number.NaN, runtimeGiB: Number.POSITIVE_INFINITY },
    evidence: [{ id: 'weights', label: 'Published "artifact"', kind: 'verified' as const, detail: 'line one\nline two', sourceUrl: 'https://huggingface.co/Qwen/Example' }],
  }],
}

describe('sizing export document', () => {
  it('creates a versioned record document and omits non-finite fields without synthetic zeroes', () => {
    expect(createSizingExport(input)).toMatchObject({
      schemaVersion: EXPORT_SCHEMA_VERSION,
      generatedAt: input.generatedAt,
      disclaimer: 'Estimate, not a benchmark or guarantee.',
      records: [{
        model: { canonicalId: 'Qwen/Example', sourceUrl: 'https://huggingface.co/Qwen/Example' },
        configuration: { quantization: '4bit', contextTokens: 8192, kvPrecision: 'FP16', mlaCacheMode: 'expanded', source: 'unsloth', variantId: 'Q4_K_M', artifactWeightGiB: 15.2 },
        hardware: { capacityGiB: 32 },
        estimate: { status: 'lower-bound', totalGiB: 18.5, weightsGiB: 15 },
      }],
    })
    expect(JSON.stringify(createSizingExport(input))).not.toMatch(/NaN|Infinity|secret|private/)
  })

  it('keeps comparison records independent rather than joining identities or totaling estimates', () => {
    const document = createSizingExport({
      generatedAt: input.generatedAt,
      records: [input.records[0], {
        model: { id: 'Meta/Two', sourceUrl: 'https://huggingface.co/Meta/Two' },
        configuration: { quantization: '8bit', contextTokens: 16384, kvPrecision: 'Q8_0', mlaCacheMode: 'latent', source: 'estimated' },
        hardware: { capacityGiB: 48 },
        resourceProfile: { kind: 'image', title: 'Published weights', totalGiB: 9.5 },
        evidence: [],
      }],
    })
    expect(document.records).toHaveLength(2)
    expect(document.records.map((record) => record.model.canonicalId)).toEqual(['Qwen/Example', 'Meta/Two'])
    expect(document.records[1]).toMatchObject({ hardware: { capacityGiB: 48 }, resourceProfile: { totalGiB: 9.5 } })
    expect(JSON.stringify(document)).not.toContain('Qwen/Example | Meta/Two')
  })

  it('uses RFC-4180 formula-safe CSV and escaped readable Markdown for every record', () => {
    const csv = exportSizingCsv({ ...input, records: [{ ...input.records[0], model: { id: '=danger,"quoted"', sourceUrl: 'https://huggingface.co/Qwen/Example' } }] })
    const markdown = exportSizingMarkdown({ ...input, records: [{ ...input.records[0], model: { id: '<tag>|pipe\nnext', sourceUrl: 'https://huggingface.co/Qwen/Example' } }] })
    expect(csv).toContain('"\'=danger,""quoted"""')
    expect(csv).toContain('\r\n')
    expect(markdown).toContain('&lt;tag&gt;\\|pipe next')
    expect(markdown).toContain(`Schema version: ${EXPORT_SCHEMA_VERSION}`)
    expect(markdown).toContain('Estimate, not a benchmark or guarantee.')
  })

  it('rejects credential-bearing source URLs', () => {
    const document = createSizingExport({ ...input, records: [{ ...input.records[0], model: { id: 'Qwen/Example', sourceUrl: 'https://user:password@huggingface.co/Qwen/Example' } }] })
    expect(document.records[0]?.model.sourceUrl).toBeUndefined()
  })
})
