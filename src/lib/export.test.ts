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
  it.each([true, false])('preserves whether a hardware profile was applied in CSV (%s)', (applied) => {
    const csv = exportSizingCsv({ ...input, records: [{ ...input.records[0], hardware: {
      capacityGiB: 32, profile: { kind: 'discrete-gpu', label: 'GPU', applied },
    } }] })
    expect(csv).toContain(`records[0].hardware.profile.applied,${applied}`)
  })
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

  it('renders every sizing fact, resource component, and evidence field in escaped Markdown', () => {
    const markdown = exportSizingMarkdown({
      generatedAt: '<generated>|\u0007',
      records: [{
        model: { id: 'Org/<model>|\u0002', sourceUrl: 'https://huggingface.co/Org/Model?token=secret' },
        configuration: { quantization: '<Q4>|', contextTokens: 8192, kvPrecision: 'FP16', mlaCacheMode: 'latent', source: 'publisher', variantId: '<artifact>|', artifactWeightGiB: 12.5 },
        hardware: {
          capacityGiB: 72,
          profile: { kind: 'discrete-gpu', label: '<GPU>|', capacityGiB: 80, reservedGiB: 8, systemRamGiB: 128, usableCapacityGiB: 72 },
        },
        estimate: { kind: 'estimate', totalGiB: 20, weightsGiB: 12.5, kvCacheGiB: 3.5, runtimeGiB: 4 },
        resourceProfile: {
          kind: 'video', title: '<pipeline>|', totalGiB: 20,
          components: [{ id: '<transformer>|', label: '<Transformer>|', repositoryId: 'Org/Assets', path: '<model>.safetensors|', sizeBytes: 13_421_772_800, provenance: 'Published <manifest>|', sourceUrl: 'https://huggingface.co/Org/Assets', revision: 'abc123', repositoryUpdatedAt: '2026-08-30' }],
        },
        evidence: [{ id: '<variant>|', label: '<Verified>|', kind: 'verified', detail: '<artifact evidence>|\u0000', sourceUrl: 'https://huggingface.co/Org/Assets?revision=secret', revision: '<abc>|', fetchedAt: '<now>|', repositoryUpdatedAt: '<updated>|' }],
      }],
    })

    expect(markdown).toContain('Generated: &lt;generated&gt;\\|')
    expect(markdown).toContain('Source URL: https://huggingface.co/Org/Model')
    expect(markdown).toContain('Selected source: publisher')
    expect(markdown).toContain('Selected artifact: &lt;artifact&gt;\\| (12.5 GiB)')
    expect(markdown).toContain('Hardware profile: &lt;GPU&gt;\\| (discrete-gpu)')
    expect(markdown).toContain('Usable capacity: 72 GiB (80 GiB − 8 GiB reserved)')
    expect(markdown).toContain('System RAM: 128 GiB')
    expect(markdown).toContain('Weights: 12.5 GiB')
    expect(markdown).toContain('KV cache: 3.5 GiB')
    expect(markdown).toContain('Runtime: 4 GiB')
    expect(markdown).toContain('Resource component: &lt;transformer&gt;\\| — &lt;Transformer&gt;\\|')
    expect(markdown).toContain('repository Org/Assets; path &lt;model&gt;.safetensors\\|; 12.5 GiB; Published &lt;manifest&gt;\\|; https://huggingface.co/Org/Assets; revision abc123; updated 2026-08-30')
    expect(markdown).toContain('Evidence: &lt;variant&gt;\\| [verified] &lt;Verified&gt;\\| — &lt;artifact evidence&gt;\\|')
    expect(markdown).toContain('https://huggingface.co/Org/Assets; revision &lt;abc&gt;\\|; fetched &lt;now&gt;\\|; updated &lt;updated&gt;\\|')
    expect(markdown).toContain('Status: ESTIMATE')
    expect(markdown).toContain('Estimate, not a benchmark or guarantee.')
    expect(markdown).not.toMatch(/token=secret|\u0000|\u0002|\u0007/)
  })
})
