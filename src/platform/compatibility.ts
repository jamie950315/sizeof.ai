export const COMPAT_OPTIONS = { engine: ['llama.cpp', 'mlx-lm', 'vllm'], os: ['linux', 'macos', 'windows', 'wsl2'], hardware: ['nvidia', 'amd', 'apple-silicon', 'cpu', 'other'], format: ['gguf', 'hf-safetensors', 'mlx', 'other'], family: ['llama', 'qwen', 'mistral', 'other'] } as const
export type CompatibilityPlan = { [K in keyof typeof COMPAT_OPTIONS]: typeof COMPAT_OPTIONS[K][number] }
export const DEFAULT_COMPATIBILITY: CompatibilityPlan = { engine: 'llama.cpp', os: 'macos', hardware: 'apple-silicon', format: 'gguf', family: 'other' }
export type EvidenceStatus = 'documented' | 'unsupported' | 'unknown'
export interface CompatibilityEvidence { dimension: string; status: EvidenceStatus; explanation: string; source: string; reviewed: string }
export const REVIEWED = '2026-09-08'
const LLAMA = 'https://github.com/ggml-org/llama.cpp'
const MLX = 'https://github.com/ml-explore/mlx-lm'
const VLLM = 'https://docs.vllm.ai/en/latest/getting_started/installation/gpu/'
const MODELS = 'https://docs.vllm.ai/en/latest/models/supported_models/'
export function validateCompatibility(plan: CompatibilityPlan) {
  if (!plan || typeof plan !== 'object' || Object.keys(plan).some(key => !Object.hasOwn(COMPAT_OPTIONS, key))) throw new Error('Unknown compatibility field.')
  for (const key of Object.keys(COMPAT_OPTIONS) as (keyof CompatibilityPlan)[]) if (!Object.hasOwn(plan, key) || !(COMPAT_OPTIONS[key] as readonly string[]).includes(plan[key])) throw new Error(`Invalid compatibility ${key}.`)
}
export function compatibilityEvidence(plan: CompatibilityPlan): CompatibilityEvidence[] {
  validateCompatibility(plan)
  const source = plan.engine === 'llama.cpp' ? LLAMA : plan.engine === 'mlx-lm' ? MLX : VLLM
  const row = (dimension: string, status: EvidenceStatus, explanation: string, url = source): CompatibilityEvidence => ({ dimension, status, explanation, source: url, reviewed: REVIEWED })
  const rows: CompatibilityEvidence[] = []
  if (plan.engine === 'llama.cpp' && plan.os !== 'wsl2') rows.push(row('Operating system', 'documented', 'The build guide documents Linux, macOS and native Windows builds. Select the matching compiler and backend; this does not validate your driver or device.', 'https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md'))
  else if (plan.engine === 'vllm' && plan.os === 'windows') rows.push(row('Operating system', 'unsupported', 'Official vLLM does not support native Windows. WSL is a separate Linux environment; community forks are outside this check.'))
  else if (plan.engine === 'vllm' && (plan.os === 'linux' || plan.os === 'wsl2')) rows.push(row('Operating system', 'documented', 'Linux is documented. WSL requires a compatible Linux distribution and working GPU passthrough; this is not a test of your installation.'))
  else if (plan.engine === 'mlx-lm' && plan.os === 'macos' && plan.hardware === 'apple-silicon') rows.push(row('Operating system', 'documented', 'MLX LM documents text generation on Apple silicon. Check the installed MLX release requirements.'))
  else rows.push(row('Operating system', 'unknown', 'This small registry has not verified this exact OS and engine combination. Unknown does not mean unsupported.'))
  if (plan.engine === 'llama.cpp' && ['cpu', 'nvidia', 'amd', 'apple-silicon'].includes(plan.hardware)) rows.push(row('Hardware backend', 'documented', 'The project lists CPU, CUDA, HIP and Metal backends. Backend availability is not proof that every device, driver, operation or selected OS works.'))
  else if (plan.engine === 'mlx-lm' && plan.hardware === 'apple-silicon') rows.push(row('Hardware backend', 'documented', 'Apple silicon is the documented MLX LM target. Memory availability and exact release requirements still need checking.'))
  else if (plan.engine === 'vllm' && ['nvidia', 'amd'].includes(plan.hardware)) rows.push(row('Hardware backend', 'documented', 'GPU installation docs list NVIDIA CUDA and specific AMD ROCm devices. Check your exact GPU, supported driver and wheel versions in the source.'))
  else if (plan.engine === 'vllm' && plan.hardware === 'apple-silicon') rows.push(row('Hardware backend', 'unknown', 'Official docs point to the separate community-maintained vLLM-Metal plugin. This checker does not verify that plugin or treat standard vLLM commands as interchangeable.'))
  else rows.push(row('Hardware backend', 'unknown', 'No reviewed hardware evidence for this selection. Check the engine documentation for your exact device.'))
  if (plan.engine === 'llama.cpp' && plan.format === 'gguf') rows.push(row('Model packaging', 'documented', 'llama.cpp requires GGUF. The exact architecture and quantization still need engine support; a .gguf extension is not a compatibility test.', 'https://github.com/ggml-org/llama.cpp/blob/master/docs/models.md'))
  else if (plan.engine === 'llama.cpp' && ['mlx', 'hf-safetensors'].includes(plan.format)) rows.push(row('Model packaging', 'unsupported', 'Direct loading requires GGUF. Conversion may be possible but is a separate, architecture-dependent step; no automatic conversion is assumed.', 'https://github.com/ggml-org/llama.cpp/blob/master/docs/models.md'))
  else if (plan.engine === 'mlx-lm' && plan.format === 'mlx') rows.push(row('Model packaging', 'documented', 'MLX LM documents loading MLX-compatible repositories. An arbitrary safetensors file is not automatically an MLX model.'))
  else if (plan.engine === 'vllm' && plan.format === 'hf-safetensors') rows.push(row('Model packaging', 'documented', 'vLLM documents loading Hugging Face model repositories. Config, tokenizer, architecture and quantization support must also match.', MODELS))
  else rows.push(row('Model packaging', 'unknown', 'This registry has not reviewed this exact packaging path. Use the model publisher and runtime documentation; no format conversion is assumed.'))
  const examples = { llama: 'LlamaForCausalLM', qwen: 'Qwen2ForCausalLM', mistral: 'MistralForCausalLM', other: '' }
  const example = plan.engine === 'vllm' && examples[plan.family] ? ` The official model list includes ${examples[plan.family]}, but that entry does not cover every ${plan.family} model.` : ''
  rows.push(row('Model family', 'unknown', `${plan.family === 'other' ? 'Unlisted architecture' : plan.family}: a family name alone cannot identify architecture, quantization kernels, multimodal requirements or required runtime version.${example} Inspect the exact model config and test that revision.`, plan.engine === 'vllm' ? MODELS : source))
  return rows
}
export function compatibilitySearch(plan: CompatibilityPlan) { validateCompatibility(plan); return new URLSearchParams({ v: '1', ...plan }).toString() }
export function parseCompatibility(search: string): CompatibilityPlan {
  if (!search) return { ...DEFAULT_COMPATIBILITY }
  if (search.length > 1024) throw new Error('Compatibility link is too long.')
  const params = new URLSearchParams(search), keys = ['v', ...Object.keys(COMPAT_OPTIONS)]
  if (params.get('v') !== '1') throw new Error('Unsupported compatibility link version.')
  for (const key of params.keys()) if (!keys.includes(key) || params.getAll(key).length !== 1) throw new Error('Unknown or repeated compatibility link field.')
  const plan = { ...DEFAULT_COMPATIBILITY }
  for (const key of Object.keys(COMPAT_OPTIONS) as (keyof CompatibilityPlan)[]) { const value = params.get(key); if (value === null || !(COMPAT_OPTIONS[key] as readonly string[]).includes(value)) throw new Error(`Invalid compatibility ${key}.`); Object.assign(plan, { [key]: value }) }
  return plan
}
