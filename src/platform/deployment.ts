export type DeploymentEngine = 'llama-cpp' | 'mlx' | 'vllm'
export interface DeploymentInput {
  os: 'mac' | 'linux' | 'windows'
  hardware: 'cpu' | 'cuda' | 'apple'
  engine: DeploymentEngine
  model: string
  file: string
  context: string
  port: string
  revision?: string
}
export const DEPLOYMENT_DEFAULTS: DeploymentInput = {
  os: 'mac', hardware: 'apple', engine: 'llama-cpp', model: '', file: '', context: '4096', port: '8080',
}
export const DEPLOYMENT_SOURCES = [
  { title: 'Hugging Face CLI: revision-locked downloads', url: 'https://huggingface.co/docs/huggingface_hub/guides/cli#download-a-specific-revision' },
  { title: 'llama.cpp server and flags', url: 'https://github.com/ggml-org/llama.cpp/tree/master/tools/server' },
  { title: 'MLX LM setup and models', url: 'https://github.com/ml-explore/mlx-lm' },
  { title: 'MLX server arguments', url: 'https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/server.py' },
  { title: 'vLLM installation', url: 'https://docs.vllm.ai/en/latest/getting_started/installation/' },
  { title: 'vLLM serve arguments', url: 'https://docs.vllm.ai/en/latest/cli/serve/' },
]

export function deploymentModelId(raw: string): string {
  let value = raw.trim()
  if (/^https:\/\//i.test(value)) {
    const url = new URL(value)
    if (!['huggingface.co', 'sizeof.ai', 'www.sizeof.ai', 'testnet.sizeof.ai'].includes(url.hostname) || url.username || url.password || url.port) throw new Error('Use a Hugging Face or sizeof.ai model-page URL.')
    value = url.pathname.replace(/^\/+|\/+$/g, '')
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(value) || value.includes('..') || value.includes('--')) throw new Error('Enter a valid owner/model ID or model-page URL, not a file URL.')
  return value
}

export function deploymentCompatibility(input: DeploymentInput): string | null {
  if (!['mac', 'linux', 'windows'].includes(input.os) || !['cpu', 'cuda', 'apple'].includes(input.hardware) || !['llama-cpp', 'mlx', 'vllm'].includes(input.engine)) return 'Unknown operating system, hardware, or engine.'
  if (input.hardware === 'apple' && input.os !== 'mac') return 'Apple Silicon requires macOS in this guide.'
  if (input.hardware === 'cuda' && input.os === 'mac') return 'This CUDA recipe requires Linux or Windows, not macOS.'
  if (input.engine === 'mlx' && (input.os !== 'mac' || input.hardware !== 'apple')) return 'This MLX guide requires an Apple Silicon Mac. Choose llama.cpp for CPU or CUDA.'
  if (input.engine === 'vllm' && (input.os !== 'linux' || input.hardware !== 'cuda')) return 'This vLLM recipe targets Linux with NVIDIA CUDA. For WSL2, choose Linux after configuring GPU access. Other backends need their own installation guide.'
  return null
}

export interface DeploymentPlan { modelId: string; shell: string; launch: string; download?: string; modelRevision?: string; localModelPath?: string; probe: string; client: string; warnings: string[]; checklist: string[] }

function modelRevision(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') return undefined
  if (typeof raw !== 'string') throw new Error('Model revision must be a full 40-character commit hash.')
  const revision = raw.trim()
  if (!revision) return undefined
  if (!/^[a-fA-F0-9]{40}$/.test(revision)) throw new Error('Model revision must be a full 40-character commit hash, not a branch, tag, or shortened hash.')
  return revision.toLowerCase()
}

function pinnedDirectory(model: string, revision: string): string {
  // Encode uppercase and underscores so even case-insensitive filesystems cannot
  // conflate differently spelled IDs. Suffixes avoid Windows reserved names/dots.
  const parts = model.split('/').map(part => `${part.replace(/[A-Z_]/g, character => `_${character.charCodeAt(0).toString(16)}`)}-snapshot`)
  if (parts.some(part => part.length > 240)) throw new Error('The model name is too long for a portable pinned download directory.')
  return `./models/${parts.join('/')}/${revision}`
}

export function buildDeploymentPlan(input: DeploymentInput): DeploymentPlan {
  const compatibility = deploymentCompatibility(input)
  if (compatibility) throw new Error(compatibility)
  const modelId = deploymentModelId(input.model)
  const revision = modelRevision(input.revision)
  const directory = revision ? pinnedDirectory(modelId, revision) : undefined
  for (const [name, value, min, max] of [['Context', input.context, 512, 1048576], ['Port', input.port, 1024, 65535]] as const) {
    if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) throw new Error(`${name} must be a whole number between ${min} and ${max}.`)
  }
  const context = Number(input.context), port = Number(input.port)
  const quote = (value: string) => `'${value}'` // All interpolated values are validated against closed character sets above/below.
  const windows = input.os === 'windows'
  const host = `http://127.0.0.1:${port}`
  const warnings = ['These are reviewed command templates, not a verified deployment. Model architecture, format, license, runtime version, free memory, and GPU drivers must be checked on your machine.', 'First launch may download many gigabytes. This website neither downloads weights nor executes these commands.', 'Local access only. Do not expose this unauthenticated server to the internet or change its binding without an authentication and TLS plan.']
  warnings.push('This template prepares text-chat requests only. Vision/audio companion files and pipelines are not configured.')
  warnings.push(revision ? 'The model download is pinned to the specified commit, not independently verified by this form. Runtime, driver, and dependency versions are NOT pinned. Record them separately; this does not guarantee identical results.' : 'Model and runtime versions are not pinned by these commands; record and verify them separately.')
  if (revision) warnings.push('Complete the download successfully before starting the server, using the same working directory. Keep the downloaded directory unchanged; local edits or extra files are not verified. Never substitute a newer revision if the pinned commit is unavailable.')
  let localModelPath = directory
  let download = directory ? `hf download ${quote(modelId)} --revision ${quote(revision!)} --local-dir ${quote(directory)}` : undefined
  let launch: string
  if (input.engine === 'llama-cpp') {
    const file = input.file.trim()
    if (file.length > 240 || !/^[A-Za-z0-9][A-Za-z0-9_./-]*\.gguf$/i.test(file) || file.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('Enter the exact GGUF filename from the repository; only letters, digits, dots, underscores, hyphens, and subfolders are accepted.')
    if (revision && /-\d+-of-\d+\.gguf$/i.test(file)) throw new Error('Pinned downloads support single-file GGUF only. Split GGUF requires a complete, verified shard list; choose an unsplit file.')
    if (directory) {
      localModelPath = `${directory}/${file}`
      download = `hf download ${quote(modelId)} ${quote(file)} --revision ${quote(revision!)} --local-dir ${quote(directory)}`
      if (windows && file.split('/').some(part => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) || part.endsWith('.'))) throw new Error('The GGUF path contains a filename unsupported on Windows.')
    }
    launch = `${windows ? '.\\llama-server.exe' : 'llama-server'} ${localModelPath ? `-m ${quote(localModelPath)}` : `--hf-repo ${quote(modelId)} --hf-file ${quote(file)}`} --ctx-size ${context} --parallel 1 --gpu-layers ${input.hardware === 'cpu' ? '0' : '99'} --host 127.0.0.1 --port ${port} --alias local-model`
    warnings.push('Use a compatible full-model GGUF, not an adapter or projector. For split GGUF weights, select the first shard and confirm all shards are available. GPU offload is a requested maximum, not a fit guarantee.', 'This recipe targets the standalone llama-server binary documented in tools/server. Some newer distributions expose a llama serve wrapper instead. Check your installed release’s help; do not assume the executable name or every flag is identical.')
  } else if (input.engine === 'mlx') {
    launch = `mlx_lm.server --model ${quote(localModelPath ?? modelId)} --host 127.0.0.1 --port ${port}`
    warnings.push(`The ${context}-token context value is a planning target only: MLX server has no equivalent universal context-cap flag in this template. Keep prompts within the model limit and monitor unified memory. Use an MLX-compatible repository.`)
  } else {
    launch = `vllm serve ${quote(localModelPath ?? modelId)} --host 127.0.0.1 --port ${port} --max-model-len ${context} --gpu-memory-utilization 0.85 --max-num-seqs 1 --served-model-name local-model`
    warnings.push('vLLM reserves GPU memory; 0.85 is a reservation fraction, not a predicted memory requirement. This single-GPU recipe does not combine multiple GPUs. Choose a supported Transformers checkpoint, not a GGUF or MLX repository.')
  }
  if (windows && localModelPath && localModelPath.length > 220) throw new Error('The pinned local path is too long for this Windows recipe. Choose a shorter repository/file path or follow the runtime’s long-path setup guide.')
  if (directory) warnings.push('Install the Hugging Face hf CLI from its official guide. Run these commands from a short working-directory path (especially on Windows). Repository downloads for MLX/vLLM include all files at that commit, which may require much more disk space than the selected weights.')
  const payload = JSON.stringify({ model: input.engine === 'mlx' ? localModelPath ?? modelId : 'local-model', messages: [{ role: 'user', content: 'Reply with one short greeting.' }], max_tokens: 32, stream: false })
  return {
    modelId, shell: windows ? 'PowerShell' : 'Bash / Zsh', launch,
    ...(revision ? { download, modelRevision: revision, localModelPath } : {}),
    probe: windows ? `Invoke-RestMethod -Uri '${host}/v1/models' -TimeoutSec 15` : `curl --fail-with-body --max-time 15 '${host}/v1/models'`,
    client: windows ? `Invoke-RestMethod -Uri '${host}/v1/chat/completions' -Method Post -ContentType 'application/json' -Body '${payload}' -TimeoutSec 120` : `curl --fail-with-body --max-time 120 '${host}/v1/chat/completions' -H 'Content-Type: application/json' --data '${payload}'`,
    warnings,
    checklist: [
      ...(revision ? ['Install the Hugging Face hf CLI from its official guide and confirm hf --help works. Fixed model downloads require this tool before starting the server.'] : []),
      `Install a current ${input.engine === 'llama-cpp' ? 'llama.cpp server build for your CPU/GPU; make the binary available in PATH (Windows: open PowerShell in its extracted directory)' : input.engine === 'mlx' ? 'MLX LM package in an isolated Python environment on Apple Silicon' : 'vLLM environment matching its documented Python, GPU, driver, and CUDA requirements'}. Use the official links below.`,
      'Check the model card, license, supported architecture, and exact weight format. Gated repositories require your own approved Hugging Face access; never put a token into a shared link or runbook.',
      'Check free disk space for weights and download cache. Check available GPU/system memory, and leave room for the operating system and other apps.',
      `Confirm ${context} tokens is within the model’s supported context. Check memory in the calculator; this wizard does not certify model fit.`,
      `Ensure local port ${port} is free. Start the server in one terminal; keep startup logs visible and wait until model loading completes.`,
      'Run the model-list check in a second terminal, then the short completion request. A successful list alone does not prove inference works.',
      'Stop with Ctrl+C in the server terminal. If loading or generation fails, inspect the first error before changing settings; see the troubleshooting guide.',
    ],
  }
}

export function deploymentSearch(input: DeploymentInput): string {
  const plan = buildDeploymentPlan(input)
  const { revision: _revision, ...settings } = input
  return new URLSearchParams({ ...settings, ...(plan.modelRevision ? { revision: plan.modelRevision } : {}), model: plan.modelId, file: input.engine === 'llama-cpp' ? input.file.trim() : '', v: plan.modelRevision ? '2' : '1' }).toString()
}

export function restoreDeployment(search: string): DeploymentInput {
  const params = new URLSearchParams(search)
  if (!search || !params.size) return { ...DEPLOYMENT_DEFAULTS }
  // A detail-page link may seed just the model. It is not a complete shared runbook.
  if (!params.has('v') && params.size === 1 && params.has('model')) {
    return { ...DEPLOYMENT_DEFAULTS, model: deploymentModelId(params.get('model') ?? '') }
  }
  const version = params.get('v')
  if (!['1', '2'].includes(version ?? '') || params.getAll('v').length !== 1) throw new Error('This deployment link has an unsupported, missing, or duplicate version. Reset it to start a new plan.')
  if (params.getAll('revision').length > 1) throw new Error('The deployment link has a duplicate revision field.')
  if (version === '1' && params.has('revision')) throw new Error('A version 1 deployment link cannot contain a model revision. Use a version 2 pinned link.')
  const revision = modelRevision(params.get('revision') ?? undefined)
  if (version === '2' && !revision) throw new Error('A version 2 deployment link requires a full model revision.')
  const input = { ...DEPLOYMENT_DEFAULTS }
  for (const key of Object.keys(input) as (keyof DeploymentInput)[]) {
    const value = params.get(key)
    if (value === null || params.getAll(key).length !== 1) throw new Error(`The deployment link has a missing or duplicate ${key} field.`)
    Object.assign(input, { [key]: value })
  }
  if (revision) input.revision = revision
  buildDeploymentPlan(input)
  return input
}

export function deploymentMarkdown(input: DeploymentInput): string {
  const plan = buildDeploymentPlan(input)
  const downloadStep = plan.download ? `## Download the pinned model\n\nModel commit: ${plan.modelRevision}\nLocal model path: ${plan.localModelPath}\nRuntime version: NOT pinned\n\nRun this first and stop if it fails. Start the server only after it succeeds, from the same working directory.\n\n\`\`\`${input.os === 'windows' ? 'powershell' : 'sh'}\n${plan.download}\n\`\`\`\n\n` : ''
  return `# Local deployment runbook\n\nModel: ${plan.modelId}\nEngine: ${input.engine}\nSystem: ${input.os} / ${input.hardware}\nShell: ${plan.shell}\nReviewed: 2026-09-08\n\n## Before starting\n\n${plan.checklist.map(text => `- [ ] ${text}`).join('\n')}\n\n## Important limits\n\n${plan.warnings.map(text => `- ${text}`).join('\n')}\n\n${downloadStep}## Start the server\n\n\`\`\`${input.os === 'windows' ? 'powershell' : 'sh'}\n${plan.launch}\n\`\`\`\n\n## Check the API (second terminal)\n\n\`\`\`\n${plan.probe}\n\`\`\`\n\n## Test a short completion\n\n\`\`\`\n${plan.client}\n\`\`\`\n\n## Official references\n\n${DEPLOYMENT_SOURCES.map(source => `- [${source.title}](${source.url})`).join('\n')}\n`
}
