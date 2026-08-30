import { describe, expect, it } from 'vitest'
import { normalizeHuggingFaceModel } from './huggingface'
import {
  buildPublicEstimate,
  parsePublicEstimateQuery,
  PUBLIC_ESTIMATE_DISCLAIMER,
} from './public-estimate'

function safeModel() {
  return normalizeHuggingFaceModel({
    id: 'Qwen/Qwen3.8-27B',
    sha: 'a'.repeat(40),
    lastModified: '2026-08-30T00:00:00.000Z',
    safetensors: { parameters: { BF16: 27_000_000_000 } },
    tags: ['text-generation', 'safetensors'],
  }, {
    architectures: ['Qwen3_5ForCausalLM'],
    model_type: 'qwen3_5',
    num_hidden_layers: 64,
    num_key_value_heads: 4,
    head_dim: 256,
    max_position_embeddings: 262_144,
  })
}

describe('public estimate contract', () => {
  it('parses bounded defaults and rejects unknown, duplicate, malformed, and unsafe parameters', () => {
    const parsed = parsePublicEstimateQuery('model=Qwen%2FQwen3.8-27B')
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        model: 'Qwen/Qwen3.8-27B', quantization: 'q4_k_m', context: 4096,
        kvPrecision: 'fp16', mlaCacheMode: 'expanded', capacityGiB: 32,
        source: 'estimated', artifactId: null, engine: null,
      },
    })

    for (const query of [
      'model=Qwen%2FQwen3.8-27B&destination=https%3A%2F%2Fevil.example',
      'model=Qwen%2FQwen3.8-27B&model=Other%2FModel',
      'model=api%2Fsecret',
      'model=Qwen%2FQwen3.8-27B&context=1',
      'model=Qwen%2FQwen3.8-27B&context=NaN',
      'model=Qwen%2FQwen3.8-27B&vram=4097',
      'model=Qwen%2FQwen3.8-27B&engine=vllm&prompt=4096&generated=1&concurrency=0',
      'model=Qwen%2FQwen3.8-27B&artifact=variant-without-source',
    ]) expect(parsePublicEstimateQuery(query)).toMatchObject({ ok: false })
  })

  it('builds a finite estimate with fit, inverse planner results, and provenance', () => {
    const parsed = parsePublicEstimateQuery('model=Qwen%2FQwen3.8-27B&quant=q4_k_m&context=8192&kv=q8_0&vram=32')
    if (!parsed.ok) throw new Error(parsed.error)
    const result = buildPublicEstimate(safeModel(), parsed.value, {
      publicBaseUrl: 'https://testnet.sizeof.ai', generatedAt: '2026-08-30T12:00:00.000Z',
    })

    expect(result).toMatchObject({
      schema: 'sizeof-estimate/v1',
      model: { id: 'Qwen/Qwen3.8-27B', sourceUrl: 'https://huggingface.co/Qwen/Qwen3.8-27B' },
      configuration: { quantization: 'q4_k_m', context: 8192, kvPrecision: 'q8_0' },
      hardware: { capacityGiB: 32, profile: 'discrete-gpu' },
      result: { state: 'estimate' },
      generatedAt: '2026-08-30T12:00:00.000Z',
      disclaimer: PUBLIC_ESTIMATE_DISCLAIMER,
    })
    expect(result.result.estimate?.totalGiB).toBeGreaterThan(0)
    expect(result.planner.maximumSafeContext).toBeTruthy()
    expect(result.evidence.length).toBeGreaterThan(0)
    expect(result.reproducibleUrl).toContain('https://testnet.sizeof.ai/Qwen/Qwen3.8-27B?')
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity|HF_TOKEN|hf_secret/)
  })

  it('returns unavailable instead of inventing a total for resource-only models', () => {
    const model = normalizeHuggingFaceModel({
      id: 'Org/Encoder', safetensors: { parameters: { F16: 350_000_000 } },
      pipeline_tag: 'feature-extraction', tags: ['sentence-transformers'],
    }, { architectures: ['BertModel'], model_type: 'bert' })
    const parsed = parsePublicEstimateQuery('model=Org%2FEncoder')
    if (!parsed.ok) throw new Error(parsed.error)

    expect(buildPublicEstimate(model, parsed.value).result).toMatchObject({
      state: 'unavailable', estimate: null,
    })
  })

  it('validates selected source and artifact against revision-locked model variants', () => {
    const model = safeModel()
    model.variants = [{
      id: 'q4', label: 'Q4', format: 'gguf', role: 'model', path: 'model-q4.gguf',
      revision: 'b'.repeat(40), bitsPerWeight: 4.5, weightSizeBytes: 10_000_000_000,
      totalSizeBytes: 10_000_000_000, source: 'file',
      provenance: 'community', publisher: 'unsloth', repositoryId: 'unsloth/Qwen',
      sourceUrl: 'https://huggingface.co/unsloth/Qwen',
    }]
    const parsed = parsePublicEstimateQuery('model=Qwen%2FQwen3.8-27B&source=unsloth&artifact=q4')
    if (!parsed.ok) throw new Error(parsed.error)
    const result = buildPublicEstimate(model, parsed.value)
    expect(result.configuration).toMatchObject({ source: 'unsloth', artifactId: 'q4' })
    expect(result.provenance.artifact).toMatchObject({ revision: 'b'.repeat(40), path: 'model-q4.gguf' })

    const missing = { ...parsed.value, artifactId: 'missing' }
    expect(() => buildPublicEstimate(model, missing)).toThrow('Selected artifact is not available')
  })

  it('includes a conservative serving scenario only when explicitly requested', () => {
    const parsed = parsePublicEstimateQuery('model=Qwen%2FQwen3.8-27B&engine=vllm&prompt=2048&generated=256&concurrency=4')
    if (!parsed.ok) throw new Error(parsed.error)
    const result = buildPublicEstimate(safeModel(), parsed.value)
    expect(result.serving).toMatchObject({ inputs: { profileId: 'vllm', concurrency: 4 } })
    expect(result.serving).not.toHaveProperty('throughput')
    expect(result.serving).not.toHaveProperty('latency')
  })

  it('refuses a requested serving window beyond the model native context', () => {
    const parsed = parsePublicEstimateQuery('model=Qwen%2FQwen3.8-27B&engine=vllm&prompt=262144&generated=1024')
    if (!parsed.ok) throw new Error(parsed.error)
    expect(() => buildPublicEstimate(safeModel(), parsed.value)).toThrow('Serving scenario inputs')
  })
})
