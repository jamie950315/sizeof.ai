import { describe, expect, it } from 'vitest'
import { buildDeploymentPlan, DEPLOYMENT_DEFAULTS, deploymentMarkdown, deploymentModelId, deploymentSearch, restoreDeployment, type DeploymentInput } from './deployment'

const input: DeploymentInput = { ...DEPLOYMENT_DEFAULTS, model: 'example/model-GGUF', file: 'model-Q4_K_M.gguf' }
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
    expect(() => restoreDeployment('v=2')).toThrow(/version/)
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
