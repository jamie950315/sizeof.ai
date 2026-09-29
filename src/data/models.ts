export type KvCacheLayout =
  | { kind: 'standard'; heads: number; headDim: number }
  | {
      kind: 'mla'
      heads: number
      keyHeadDim: number
      valueHeadDim: number
      latentDim: number
      ropeDim: number
    }

export type EstimateConfidence = 'safe' | 'runtime-specific' | 'weights-only'

export interface AttentionProfile {
  fullLayers: number
  slidingLayers: number
  linearLayers: number
  kdaLayers: number
  recurrentLayers: number
  ssmLayers: number
  slidingWindow: number | null
  stateKind: 'kda' | 'linear' | 'mamba' | 'recurrent' | null
}

interface ModelSpecBase {
  id: string
  name: string
  family: string
  maker: string
  parametersB: number
  layers: number
  attentionLayers?: number
  attentionProfile?: AttentionProfile
  estimateConfidence?: EstimateConfidence
  maxContext: number
  releaseYear: number
  strengths: string[]
  sourceUrl: string
}

export type ModelSpec = ModelSpecBase & (
  | { kvCache: KvCacheLayout; kvHeads?: number; headDim?: number }
  | { kvCache?: never; kvHeads: number; headDim: number }
)

// Curated from Hugging Face Base-only trending results on 2026-08-22.
// Partial-attention entries expose lower bounds only: omitted local/sliding and hybrid
// state must not be presented as a verified safe fit by the inverse planner.
export const models: ModelSpec[] = [
  {
    id: 'qwen3.8-27b',
    name: 'Qwen3.8 27B',
    family: 'Qwen3.8',
    maker: 'Qwen',
    parametersB: 27.781,
    layers: 64,
    attentionLayers: 16,
    estimateConfidence: 'runtime-specific',
    kvHeads: 4,
    headDim: 256,
    maxContext: 262144,
    releaseYear: 2026,
    strengths: ['reasoning', 'coding', 'multimodal'],
    sourceUrl: 'https://huggingface.co/Qwen/Qwen3.8-27B',
  },
  {
    id: 'ornith-1.5-35b-a3b',
    name: 'Ornith 1.5 35B A3B',
    family: 'Ornith 1.5',
    maker: 'Ornith AI',
    parametersB: 35.952,
    layers: 40,
    attentionLayers: 10,
    estimateConfidence: 'runtime-specific',
    kvHeads: 2,
    headDim: 256,
    maxContext: 262144,
    releaseYear: 2026,
    strengths: ['reasoning', 'agentic', 'multimodal'],
    sourceUrl: 'https://huggingface.co/ornith-ai/Ornith-1.5-35B-A3B',
  },
  {
    id: 'muse-glimmer-30b',
    name: 'Muse Glimmer 30B',
    family: 'Muse Glimmer',
    maker: 'Meta Models',
    parametersB: 29.777,
    layers: 52,
    attentionLayers: 13,
    estimateConfidence: 'runtime-specific',
    attentionProfile: {
      fullLayers: 13, slidingLayers: 39, slidingWindow: 2048,
      linearLayers: 0, kdaLayers: 0, recurrentLayers: 0, ssmLayers: 0, stateKind: null,
    },
    kvHeads: 2,
    headDim: 128,
    maxContext: 131072,
    releaseYear: 2026,
    strengths: ['multimodal', 'computer use', 'agentic'],
    sourceUrl: 'https://huggingface.co/meta-models/Muse-Glimmer-30B',
  },
  {
    id: 'ornith-1.5-9b',
    name: 'Ornith 1.5 9B',
    family: 'Ornith 1.5',
    maker: 'Ornith AI',
    parametersB: 9.41,
    layers: 32,
    attentionLayers: 8,
    estimateConfidence: 'runtime-specific',
    kvHeads: 4,
    headDim: 256,
    maxContext: 262144,
    releaseYear: 2026,
    strengths: ['reasoning', 'compact', 'multimodal'],
    sourceUrl: 'https://huggingface.co/ornith-ai/Ornith-1.5-9B',
  },
  {
    id: 'qwen3.6-35b-a3b',
    name: 'Qwen3.6 35B A3B',
    family: 'Qwen3.6',
    maker: 'Qwen',
    parametersB: 35.952,
    layers: 40,
    attentionLayers: 10,
    estimateConfidence: 'runtime-specific',
    kvHeads: 2,
    headDim: 256,
    maxContext: 262144,
    releaseYear: 2026,
    strengths: ['reasoning', 'multimodal', 'long context'],
    sourceUrl: 'https://huggingface.co/Qwen/Qwen3.6-35B-A3B',
  },
  {
    id: 'kat-coder-v2.5-dev',
    name: 'KAT-Coder V2.5 Dev',
    family: 'KAT-Coder',
    maker: 'KwaiPilot',
    parametersB: 34.661,
    layers: 40,
    attentionLayers: 10,
    estimateConfidence: 'runtime-specific',
    kvHeads: 2,
    headDim: 256,
    maxContext: 262144,
    releaseYear: 2026,
    strengths: ['coding', 'agentic', 'long context'],
    sourceUrl: 'https://huggingface.co/Kwaipilot/KAT-Coder-V2.5-Dev',
  },
  {
    id: 'qwen3.6-27b',
    name: 'Qwen3.6 27B',
    family: 'Qwen3.6',
    maker: 'Qwen',
    parametersB: 27.781,
    layers: 64,
    attentionLayers: 16,
    estimateConfidence: 'runtime-specific',
    kvHeads: 4,
    headDim: 256,
    maxContext: 262144,
    releaseYear: 2026,
    strengths: ['reasoning', 'multimodal', 'long context'],
    sourceUrl: 'https://huggingface.co/Qwen/Qwen3.6-27B',
  },
  {
    id: 'gpt-oss-20b',
    name: 'gpt-oss 20B',
    family: 'gpt-oss',
    maker: 'OpenAI',
    parametersB: 21.512,
    layers: 24,
    attentionLayers: 12,
    estimateConfidence: 'runtime-specific',
    kvHeads: 8,
    headDim: 64,
    maxContext: 131072,
    releaseYear: 2025,
    strengths: ['reasoning', 'tool use', 'open weights'],
    sourceUrl: 'https://huggingface.co/openai/gpt-oss-20b',
  },
  {
    id: 'minicpm5-1b',
    name: 'MiniCPM5 1B',
    family: 'MiniCPM5',
    maker: 'OpenBMB',
    parametersB: 1.081,
    layers: 24,
    kvHeads: 2,
    headDim: 128,
    maxContext: 131072,
    releaseYear: 2026,
    strengths: ['compact', 'on-device', 'instruction'],
    sourceUrl: 'https://huggingface.co/openbmb/MiniCPM5-1B',
  },
]
