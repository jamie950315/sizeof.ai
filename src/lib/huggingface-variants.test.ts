import { describe, expect, it } from 'vitest'
import {
  applyReleaseManifest,
  parseHuggingFaceVariants,
  parseNInferManifest,
  parseVariantArtifactManifest,
} from './huggingface-variants'

describe('parseHuggingFaceVariants', () => {
  it('exports actual complete shard paths and sizes in launch order', () => {
    const variants = parseHuggingFaceVariants([{ revision: 'a'.repeat(40), label: 'main', entries: [
      { type: 'file', path: 'model-00002-of-00002.gguf', size: 20_000_000 },
      { type: 'file', path: 'model-00001-of-00002.gguf', size: 30_000_000 },
    ] }], ['gguf'])
    expect(variants[0].files).toEqual([{ path: 'model-00001-of-00002.gguf', sizeBytes: 30_000_000 }, { path: 'model-00002-of-00002.gguf', sizeBytes: 20_000_000 }])
    expect(variants[0].weightSizeBytes).toBe(50_000_000)
  })
  it('excludes importance-matrix calibration files from model weights', () => {
    const variants = parseHuggingFaceVariants([{ revision: 'rev', label: 'main', entries: [
      { type: 'file', path: 'Model-imatrix.gguf', size: 13_000_000 },
      { type: 'file', path: 'Model-Q4_K_M.gguf', size: 10_000_000_000 },
    ] }], ['gguf'])
    expect(variants).toHaveLength(1)
    expect(variants[0].path).toBe('Model-Q4_K_M.gguf')
  })
  it('never reports one shard as a complete GGUF or safetensors model', () => {
    for (const extension of ['gguf', 'safetensors']) {
      expect(parseHuggingFaceVariants([{ revision: 'rev', label: 'main', entries: [
        { type: 'file', path: `Model-00001-of-00002.${extension}`, size: 100 },
      ] }], ['mlx', 'gguf'])).toEqual([])
    }
  })

  it('keeps nested variants separate and preserves case-sensitive artifact identity', () => {
    const variants = parseHuggingFaceVariants([{ revision: 'rev', label: 'main', entries: [
      { type: 'file', path: 'nested/4bit/model.safetensors', size: 100 },
      { type: 'file', path: 'nested/8bit/model.safetensors', size: 200 },
      { type: 'file', path: 'Q4.gguf', size: 300 },
      { type: 'file', path: 'q4.gguf', size: 400 },
    ] }], ['mlx'])
    expect(variants).toHaveLength(4)
    expect(new Set(variants.map((item) => item.id)).size).toBe(4)
    expect(variants.find((item) => item.path === 'nested/4bit')?.weightSizeBytes).toBe(100)
  })
  it('groups MLX weight shards by quantized directory', () => {
    const variants = parseHuggingFaceVariants([
      {
        revision: 'mainsha',
        label: 'main',
        entries: [
          { type: 'file', path: '4bit/config.json', size: 3_697 },
          { type: 'file', path: '4bit/model-00001-of-00002.safetensors', size: 5_349_769_710 },
          { type: 'file', path: '4bit/model-00002-of-00002.safetensors', size: 600_449_850 },
          { type: 'file', path: '8bit/config.json', size: 3_697 },
          { type: 'file', path: '8bit/model-00001-of-00002.safetensors', size: 5_339_521_769 },
          { type: 'file', path: '8bit/model-00002-of-00002.safetensors', size: 5_087_069_142 },
          { type: 'file', path: 'bf16/model-00001-of-00002.safetensors', size: 10_000_000_000 },
          { type: 'file', path: 'bf16/model-00002-of-00002.safetensors', size: 8_820_000_000 },
        ],
      },
    ], ['mlx', '4-bit', '8-bit', 'bf16'])

    expect(variants).toHaveLength(3)
    expect(variants.map((variant) => variant.label)).toEqual(['MLX 4-bit', 'MLX 8-bit', 'MLX BF16'])
    expect(variants[0]).toMatchObject({
      format: 'mlx',
      path: '4bit',
      revision: 'mainsha',
      bitsPerWeight: 4,
      weightSizeBytes: 5_950_219_560,
      totalSizeBytes: 5_950_223_257,
    })
  })

  it('turns EXL branch snapshots into bpw variants', () => {
    const variants = parseHuggingFaceVariants([
      {
        revision: 'branch350sha',
        label: '3.50bpw',
        entries: [
          { type: 'file', path: 'config.json', size: 4_000 },
          { type: 'file', path: 'output-00001-of-00002.safetensors', size: 7_000_000_000 },
          { type: 'file', path: 'output-00002-of-00002.safetensors', size: 6_000_000_000 },
        ],
      },
      {
        revision: 'branch600sha',
        label: '6.00bpw',
        entries: [
          { type: 'file', path: 'output.safetensors', size: 22_000_000_000 },
        ],
      },
    ], ['exl3'])

    expect(variants).toHaveLength(2)
    expect(variants[0]).toMatchObject({
      label: 'EXL3 3.50 bpw',
      format: 'exl3',
      revision: 'branch350sha',
      bitsPerWeight: 3.5,
      weightSizeBytes: 13_000_000_000,
      totalSizeBytes: 13_000_004_000,
    })
    expect(variants[1].label).toBe('EXL3 6.00 bpw')
  })

  it('detects GGUF and NInfer artifacts as independently selectable files', () => {
    const variants = parseHuggingFaceVariants([
      {
        revision: 'mainsha',
        label: 'main',
        entries: [
          { type: 'file', path: 'Qwen-Q4_K_M.gguf', size: 15_100_000_000 },
          { type: 'file', path: 'Qwen-Q8_0.gguf', size: 28_000_000_000 },
          { type: 'file', path: 'mmproj-F16.gguf', size: 900_000_000 },
          { type: 'file', path: 'mtp-head.gguf', size: 500_000_000 },
          { type: 'file', path: 'Model-BF16-00001-of-00002.gguf', size: 30_000_000_000 },
          { type: 'file', path: 'Model-BF16-00002-of-00002.gguf', size: 12_000_000_000 },
          { type: 'file', path: 'qwen3_8_27b.ninfer', size: 18_210_531_328 },
          { type: 'file', path: 'README.md', size: 4_850 },
        ],
      },
    ], ['gguf', 'ninfer'])

    expect(variants).toEqual([
      expect.objectContaining({
        label: 'GGUF Q4_K_M',
        format: 'gguf',
        path: 'Qwen-Q4_K_M.gguf',
        weightSizeBytes: 15_100_000_000,
      }),
      expect.objectContaining({
        label: 'GGUF Q8_0',
        format: 'gguf',
        path: 'Qwen-Q8_0.gguf',
        weightSizeBytes: 28_000_000_000,
      }),
      expect.objectContaining({
        label: 'GGUF BF16',
        path: 'Model-BF16-00001-of-00002.gguf',
        weightSizeBytes: 42_000_000_000,
      }),
      expect.objectContaining({
        label: 'NInfer',
        format: 'ninfer',
        path: 'qwen3_8_27b.ninfer',
        weightSizeBytes: 18_210_531_328,
      }),
      expect.objectContaining({ format: 'gguf', path: 'mmproj-F16.gguf', role: 'projector' }),
      expect.objectContaining({ format: 'gguf', path: 'mtp-head.gguf', role: 'addon' }),
    ])
  })

  it('distinguishes otherwise identical GGUF variants that include built-in MTP', () => {
    const variants = parseHuggingFaceVariants([{
      revision: 'mainsha',
      label: 'main',
      entries: [
        { type: 'file', path: 'Model-IQ4_KT-attn-IQ4_KS-MTP.gguf', size: 15_000_000_000 },
        { type: 'file', path: 'Model-IQ4_KT-attn-IQ4_KS.gguf', size: 14_000_000_000 },
      ],
    }], ['gguf'])

    expect(variants.map((variant) => variant.label).sort()).toEqual([
      'GGUF IQ4_KT',
      'GGUF IQ4_KT + MTP',
    ])
  })

  it('ignores docs-only snapshots and unsafe entries', () => {
    const variants = parseHuggingFaceVariants([
      {
        revision: 'mainsha',
        label: 'main',
        entries: [
          { type: 'file', path: 'README.md', size: 2_000 },
          { type: 'directory', path: '4bit', size: 0 },
          { type: 'file', path: '../escape.gguf', size: 100 },
          { type: 'file', path: 'broken.gguf', size: -1 },
        ],
      },
    ], ['gguf'])

    expect(variants).toEqual([])
  })

  it('reads a revision-locked base and artifact facts from an NInfer manifest', () => {
    expect(parseNInferManifest({
      artifact: { path: 'qwen3_8_27b.ninfer', bytes: 18_210_531_328 },
      base: {
        repo_id: 'Qwen/Qwen3.8-27B',
        revision: '1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0',
      },
      weights_id: 'groupwise-int',
    })).toEqual({
      artifactPath: 'qwen3_8_27b.ninfer',
      artifactSizeBytes: 18_210_531_328,
      baseModelId: 'Qwen/Qwen3.8-27B',
      baseRevision: '1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0',
      weightsId: 'groupwise-int',
    })
    expect(parseNInferManifest({ base: { repo_id: '../escape', revision: 'main' } })).toBeNull()
  })

  it('reads a declared base model from a directory artifact manifest', () => {
    expect(parseVariantArtifactManifest({
      artifact: 'PocketAiHub/Qwen3.8-9B-Abliterated-MLX/4bit',
      metadata: {
        sourceRepository: 'empero-ai/Qwen3.8-9B',
        sourceRevision: '0934f3d2327ff2df2197495278c4c46ae5a56bd9',
        baseModel: 'Qwen/Qwen3.5-9B',
        precision: '4-bit',
      },
    })).toEqual({
      baseModelId: 'Qwen/Qwen3.5-9B',
      sourceModelId: 'empero-ai/Qwen3.8-9B',
      sourceRevision: '0934f3d2327ff2df2197495278c4c46ae5a56bd9',
    })
    expect(parseVariantArtifactManifest({ metadata: { baseModel: '../escape' } })).toBeNull()
  })

  it('uses a release manifest as the canonical per-variant download size', () => {
    const detected = parseHuggingFaceVariants([{
      revision: 'mainsha',
      label: 'main',
      entries: [
        { type: 'file', path: '4bit/model.safetensors', size: 5_950_000_000 },
        { type: 'file', path: '4bit/artifact-manifest.json', size: 2_816 },
      ],
    }], ['mlx', '4-bit'])

    const variants = applyReleaseManifest(detected, {
      variants: [{
        name: '4bit',
        path: '4bit',
        precision: '4-bit',
        total_size_bytes: 5_977_078_438,
      }],
    })

    expect(variants[0]).toMatchObject({
      label: 'MLX 4-bit',
      weightSizeBytes: 5_950_000_000,
      totalSizeBytes: 5_977_078_438,
    })
  })
})
