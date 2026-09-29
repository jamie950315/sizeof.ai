import { describe, expect, it } from 'vitest'
import { buildDeploymentPlan, DEPLOYMENT_DEFAULTS, deploymentMarkdown, deploymentModelId, deploymentSearch, restoreDeployment, type DeploymentInput } from './deployment'

const input: DeploymentInput = { ...DEPLOYMENT_DEFAULTS, model: 'example/model-GGUF', file: 'model-Q4_K_M.gguf' }
describe('complete pinned shard plans', () => {
  const shardFiles = ['q/model-00001-of-00002.gguf', 'q/model-00002-of-00002.gguf']
  const split = { ...input, file: shardFiles[0], revision: 'a'.repeat(40), shardFiles }
  it('downloads only all named shards and launches first, with v3 round trip', () => {
    const plan = buildDeploymentPlan(split)
    expect(plan.download).toContain("'q/model-00001-of-00002.gguf' 'q/model-00002-of-00002.gguf'")
    expect(plan.launch).toContain(shardFiles[0])
    expect(plan.launch).not.toContain(shardFiles[1])
    const query = deploymentSearch(split)
    expect(query).toContain('v=3')
    expect(restoreDeployment(query)).toEqual(split)
    for (const v of ['1', '2']) expect(() => restoreDeployment(query.replace('v=3', `v=${v}`))).toThrow()
  })
  it.each([[], [shardFiles[0]], [shardFiles[0], shardFiles[0]], [...shardFiles].reverse(), [shardFiles[0], 'other-00002-of-00002.gguf'], [shardFiles[0], 'q/model-00002-of-00003.gguf']].map(files => ({ files })))('rejects incomplete or mismatched manifest $files', ({ files }) => {
    expect(() => buildDeploymentPlan({ ...split, shardFiles: files })).toThrow()
  })
  it('fails closed for missing pin, unsupported engine or malformed link', () => {
    expect(() => buildDeploymentPlan({ ...split, revision: undefined })).toThrow()
    expect(() => buildDeploymentPlan({ ...split, engine: 'mlx' })).toThrow()
    const query = deploymentSearch(split)
    expect(() => restoreDeployment(`${query}&shardFiles=[]`)).toThrow()
    expect(() => restoreDeployment(query.replace(/shardFiles=[^&]+/, 'shardFiles=garbage'))).toThrow()
    expect(() => restoreDeployment('x'.repeat(8193))).toThrow()
  })
})
describe('deployment runbooks', () => {
  it('uses a fixed loopback host and exact quoted model and artifact', () => {
    const plan = buildDeploymentPlan(input)
    expect(plan.launch).toContain("--hf-repo 'example/model-GGUF' --hf-file 'model-Q4_K_M.gguf'")
    expect(plan.launch).toContain('--host 127.0.0.1 --port 8080')
    expect(plan.launch).toContain('--parallel 1')
    expect(plan.client).toContain('--fail-with-body')
    expect(plan.client).toContain('"max_tokens":32')
    expect(plan.launch).not.toMatch(/trust-remote-code|0\.0\.0\.0/)
  })
  it.each(['owner/repo;id', 'owner/$(id)', 'owner/a\nrm -rf', "owner/repo'", 'owner/--help', 'https://evil.com/owner/repo', 'https://huggingface.co@evil.com/a/b', 'https://huggingface.co/a/b/resolve/main/f.gguf', 'https://huggingface.co:123/a/b', '../repo', 'owner/a--b'])('rejects unsafe model %s', model => {
    expect(() => buildDeploymentPlan({ ...input, model })).toThrow()
  })
  it.each(['../model.gguf', 'folder/../model.gguf', "foo';id.gguf", 'foo$(id).gguf', '/model.gguf', 'model.safetensors', 'foo\\bar.gguf', 'foo//bar.gguf', '-x.gguf'])('rejects unsafe artifact %s', file => {
    expect(() => buildDeploymentPlan({ ...input, file })).toThrow()
  })
  it.each(['443', '65536', '8080;id', '-1', 'NaN', '8e3', '8080.5'])('rejects invalid ports %s', port => {
    expect(() => buildDeploymentPlan({ ...input, port })).toThrow(/Port/)
  })
  it.each(['0', '511', '1048577', '4096.5', '4096\n', 'Infinity'])('rejects invalid contexts %s', context => {
    expect(() => buildDeploymentPlan({ ...input, context })).toThrow(/Context/)
  })
  it('accepts supported model URLs and subdirectory GGUF filenames', () => {
    expect(deploymentModelId('https://huggingface.co/Qwen/Qwen3-8B?x=1')).toBe('Qwen/Qwen3-8B')
    expect(deploymentModelId('https://testnet.sizeof.ai/Qwen/Qwen3-8B/')).toBe('Qwen/Qwen3-8B')
    expect(buildDeploymentPlan({ ...input, file: 'Q4/model-00001-of-00002.gguf' }).launch).toContain('Q4/model-00001-of-00002.gguf')
  })
  it('refuses unsupported recipes rather than producing misleading commands', () => {
    expect(() => buildDeploymentPlan({ ...input, os: 'linux' })).toThrow(/Apple Silicon/)
    expect(() => buildDeploymentPlan({ ...input, engine: 'vllm' })).toThrow(/Linux/)
    expect(() => buildDeploymentPlan({ ...input, engine: 'mlx', hardware: 'cpu' })).toThrow(/Apple Silicon/)
    expect(() => buildDeploymentPlan({ ...input, hardware: 'cuda' })).toThrow(/CUDA/)
  })
  it('generates vLLM single-GPU limits and MLX without fictitious context flags', () => {
    expect(buildDeploymentPlan({ ...input, engine: 'vllm', os: 'linux', hardware: 'cuda' }).launch).toContain('--max-model-len 4096 --gpu-memory-utilization 0.85 --max-num-seqs 1')
    const mlx = buildDeploymentPlan({ ...input, engine: 'mlx' })
    expect(mlx.launch).not.toContain('--ctx')
    expect(mlx.warnings.join(' ')).toContain('planning target only')
    expect(mlx.client).toContain('"model":"example/model-GGUF"')
  })
  it('generates PowerShell requests without curl JSON quoting ambiguity', () => {
    const plan = buildDeploymentPlan({ ...input, os: 'windows', hardware: 'cpu' })
    expect(plan.launch).toContain('.\\llama-server.exe')
    expect(plan.launch).toContain('--gpu-layers 0')
    expect(plan.client).toContain('Invoke-RestMethod')
    expect(plan.client).toContain('-TimeoutSec 120')
  })
  it('round-trips valid settings and rejects damaged shared links', () => {
    expect(restoreDeployment(deploymentSearch(input))).toEqual(input)
    expect(restoreDeployment('')).toEqual(DEPLOYMENT_DEFAULTS)
    expect(() => restoreDeployment('v=3')).toThrow(/version/)
    expect(() => restoreDeployment(deploymentSearch(input) + '&v=1')).toThrow(/version/)
    expect(() => restoreDeployment(deploymentSearch(input) + '&port=9090')).toThrow(/duplicate/)
    expect(() => restoreDeployment(deploymentSearch(input).replace('os=mac', 'os=invalid'))).toThrow(/Unknown/)
    expect(() => restoreDeployment(deploymentSearch(input).replace('port=8080', 'port=22'))).toThrow(/Port/)
  })
  it('accepts model-only seeds without representing them as complete runbooks', () => {
    expect(restoreDeployment('?model=Qwen%2FQwen3-8B')).toEqual({ ...DEPLOYMENT_DEFAULTS, model: 'Qwen/Qwen3-8B' })
    expect(restoreDeployment('?model=https%3A%2F%2Fhuggingface.co%2FQwen%2FQwen3-8B').model).toBe('Qwen/Qwen3-8B')
    expect(() => buildDeploymentPlan(restoreDeployment('?model=Qwen%2FQwen3-8B'))).toThrow(/GGUF/)
    expect(() => restoreDeployment('?model=owner%2F%24%28id%29')).toThrow()
    expect(() => restoreDeployment('?model=owner%2Frepo&port=8080')).toThrow(/version/)
    expect(() => restoreDeployment('?model=owner%2Frepo&model=owner%2Frepo')).toThrow(/version/)
  })
  it('exports a complete runbook with warnings, real checks and sources', () => {
    const markdown = deploymentMarkdown(input)
    expect(markdown).toContain('- [ ]')
    expect(markdown).toContain('not a verified deployment')
    expect(markdown).toContain('/v1/chat/completions')
    expect(markdown).toContain('https://docs.vllm.ai/')
  })
})

describe('revision-pinned deployment runbooks', () => {
  const revision = 'a1'.repeat(20)
  const pinned = { ...input, revision }
  it('downloads the exact GGUF commit before starting a local file', () => {
    const plan = buildDeploymentPlan(pinned)
    expect(plan.modelRevision).toBe(revision)
    expect(plan.download).toContain(`hf download 'example/model-GGUF' 'model-Q4_K_M.gguf' --revision '${revision}' --local-dir '`)
    expect(plan.localModelPath).toContain(`/${revision}/model-Q4_K_M.gguf`)
    expect(plan.launch).toContain(`-m '${plan.localModelPath}'`)
    expect(plan.launch).not.toMatch(/--hf-|--revision/)
    expect(plan.warnings.join(' ')).toContain('Runtime, driver, and dependency versions are NOT pinned')
    const markdown = deploymentMarkdown(pinned)
    expect(markdown.indexOf(plan.download!)).toBeLessThan(markdown.indexOf(plan.launch))
    expect(markdown).toContain('Runtime version: NOT pinned')
    expect(markdown).toContain('huggingface.co/docs/huggingface_hub/guides/cli')
  })
  it.each(['main', 'v1.0', 'a'.repeat(39), 'a'.repeat(41), 'g'.repeat(40), "'; id", '$(id)', 'a\nb', '--help'])('rejects non-immutable or unsafe revision %s', revision => {
    expect(() => buildDeploymentPlan({ ...input, revision })).toThrow(/revision/)
    expect(() => restoreDeployment(`${deploymentSearch(input).replace('v=1', 'v=2')}&revision=${encodeURIComponent(revision)}`)).toThrow(/revision/)
  })
  it('round-trips pins and keeps older v1 links unpinned', () => {
    expect(new URLSearchParams(deploymentSearch(pinned)).get('v')).toBe('2')
    expect(new URLSearchParams(deploymentSearch(input)).get('v')).toBe('1')
    expect(restoreDeployment(deploymentSearch(pinned))).toEqual(pinned)
    expect(restoreDeployment(deploymentSearch({ ...input, revision: ` ${revision.toUpperCase()} ` }))).toEqual(pinned)
    expect(restoreDeployment(deploymentSearch(input))).toEqual(input)
    for (const revision of ['', '   ', undefined]) {
      expect(deploymentSearch({ ...input, revision })).not.toContain('revision')
      expect(buildDeploymentPlan({ ...input, revision })).toEqual(buildDeploymentPlan(input))
    }
    expect(() => restoreDeployment(`${deploymentSearch(pinned)}&revision=${revision}`)).toThrow(/duplicate revision/)
    expect(() => restoreDeployment(`${deploymentSearch(input)}&revision=&revision=`)).toThrow(/duplicate revision/)
    expect(() => restoreDeployment(`${deploymentSearch(input)}&revision=${revision}`)).toThrow(/version 1/)
    expect(() => restoreDeployment(`${deploymentSearch(input)}&revision=`)).toThrow(/version 1/)
    expect(() => restoreDeployment(deploymentSearch(input).replace('v=1', 'v=2'))).toThrow(/requires a full model revision/)
    expect(() => restoreDeployment(`${deploymentSearch(input).replace('v=1', 'v=2')}&revision=`)).toThrow(/requires a full model revision/)
  })
  it('uses separate portable directories for repository, revision, and case variations', () => {
    const paths = ['example/model-GGUF', 'example/model_47_47_55_46', 'Example/model-GGUF', 'example/model-gguf', 'con/nul'].map(model => buildDeploymentPlan({ ...pinned, model }).localModelPath)
    expect(new Set(paths.map(path => path!.toLowerCase())).size).toBe(paths.length)
    expect(buildDeploymentPlan({ ...pinned, revision: 'b'.repeat(40) }).localModelPath).not.toBe(paths[0])
    expect(paths.every(path => path!.startsWith('./models/') && !path!.includes('..'))).toBe(true)
  })
  it('downloads whole repositories for MLX and vLLM and uses local paths consistently', () => {
    const mlx = buildDeploymentPlan({ ...pinned, engine: 'mlx' })
    expect(mlx.download).toContain(`hf download 'example/model-GGUF' --revision '${revision}'`)
    expect(mlx.download).not.toContain(input.file)
    expect(mlx.launch).toContain(`--model '${mlx.localModelPath}'`)
    expect(mlx.client).toContain(JSON.stringify(mlx.localModelPath))
    const vllm = buildDeploymentPlan({ ...pinned, engine: 'vllm', os: 'linux', hardware: 'cuda' })
    expect(vllm.launch).toContain(`vllm serve '${vllm.localModelPath}'`)
    expect(vllm.launch).not.toContain('--revision')
  })
  it.each(['model-00001-of-00002.gguf', 'Q4/model-00002-of-00002.GGUF'])('does not pretend a split file is complete: %s', file => {
    expect(() => buildDeploymentPlan({ ...pinned, file })).toThrow(/Split GGUF/)
    expect(() => buildDeploymentPlan({ ...input, file })).not.toThrow()
  })
  it('generates literal PowerShell paths with nested GGUF filenames', () => {
    const plan = buildDeploymentPlan({ ...pinned, os: 'windows', hardware: 'cpu', file: 'Q4/model.gguf' })
    expect(plan.launch).toContain(`.\\llama-server.exe -m '${plan.localModelPath}'`)
    expect(plan.download).toContain("'Q4/model.gguf'")
    expect(plan.client).toContain('Invoke-RestMethod')
  })
  it.each(['CON.gguf', 'a/NUL.gguf', 'a./model.gguf', 'COM1/model.gguf', `${'a'.repeat(170)}.gguf`])('rejects pinned Windows path hazards %s', file => {
    expect(() => buildDeploymentPlan({ ...pinned, os: 'windows', hardware: 'cpu', file })).toThrow(/Windows/)
  })
})
