export const STAGES = [
  ['download', 'Download'], ['load', 'Load weights'], ['startup', 'Start server'],
  ['first-reply', 'First reply'], ['long-context', 'Long context'], ['slow-output', 'Slow output'],
] as const
export type Stage = typeof STAGES[number][0]
export const SYSTEMS = ['Windows', 'macOS', 'Linux'] as const
export type System = typeof SYSTEMS[number]
export type DiagnosticSelection = { stage: Stage; symptom: string; os: System }
export type DiagnosticPath = { id: string; title: string; questions: string[]; causes: string; check: string; stop: string; doc: string }
export const PATHS: Record<Stage, DiagnosticPath[]> = {
  download: [
    { id: 'access', title: 'Access denied or model not found', questions: ['Can the intended account open the exact repository in a browser?', 'Does the repository require accepting a license or requesting access?'], causes: 'A wrong repository, private model, unaccepted gate, or incorrect credential scope can look similar. This guide cannot inspect your account.', check: 'Open the exact publisher repository and inspect access status. Compare the model ID and revision with your plan. Never paste a token into this page.', stop: 'Stop retries if access is denied. Resolve permission with the publisher or account owner; do not bypass the gate.', doc: 'model-files' },
    { id: 'incomplete', title: 'Interrupted download or missing files', questions: ['Does the earliest error report network failure, disk space, or a missing shard?', 'Does the local file list match every required shard and supporting file?'], causes: 'An interrupted transfer, insufficient space, or an incomplete variant may be responsible; file size alone does not prove integrity.', check: 'Compare filenames and sizes with the publisher manifest for the same revision. Inspect free disk space before retrying. Preserve the first download error.', stop: 'Do not load a partial set. Stop if the required manifest or revision cannot be established; do not delete existing files to guess a fix.', doc: 'model-files' },
  ],
  load: [
    { id: 'memory', title: 'Out of memory while loading', questions: ['Have you identified the device named in the first allocation error?', 'Have you recorded free memory before loading and checked other applications?'], causes: 'Weights, cache allocation, other applications, and runtime overhead all compete for memory. A small download does not guarantee a fit.', check: 'Inspect memory use and the original allocation error. Compare the selected files, context, and device with the plan; note CPU offload rather than silently accepting it.', stop: 'Stop repeated launches when memory is exhausted or the system is swapping heavily. Record the baseline before intentionally changing one setting.', doc: 'hardware' },
    { id: 'unsupported', title: 'Unsupported format or architecture', questions: ['Have you recorded the first unsupported tensor, architecture, or format message?', 'Does documentation for the installed engine version explicitly support this exact variant?'], causes: 'Engine version, model architecture, quantization, or a missing companion file may be incompatible. Matching a file extension is not sufficient.', check: 'Read the installed engine version and compare its official support documentation with the publisher model card and variant requirements.', stop: 'Stop if support is unconfirmed. Do not rename file extensions, enable unreviewed remote code, or quietly substitute another model.', doc: 'quantization' },
  ],
  startup: [
    { id: 'port', title: 'Address already in use', questions: ['Does the first startup error explicitly name a bind failure and port?', 'Is an earlier copy of your own server already running?'], causes: 'Another listener may occupy the port; a bind error can also indicate an unavailable address or insufficient permission.', check: 'Read the bind address and port in the startup log. Inspect your own running server windows or process list without terminating processes.', stop: 'Do not kill an unknown process or disable a firewall. Identify ownership before intentionally selecting another local port.', doc: 'serving-security' },
    { id: 'backend', title: 'Device or backend initialization fails', questions: ['Does the first error occur before any weights load?', 'Does the installed runtime support this operating system and device?'], causes: 'A missing backend, incompatible driver/runtime, or unsupported device may prevent initialization; CPU fallback can hide this failure.', check: 'Inspect the device and runtime version reported by the application. Compare the installation requirements for the exact installed engine release.', stop: 'Stop when the selected backend is unavailable. Do not disable security checks or install arbitrary drivers as a guessing step.', doc: 'troubleshooting' },
  ],
  'first-reply': [
    { id: 'connection', title: 'Client cannot connect', questions: ['Did the server actually report readiness, rather than just model loading?', 'Does the client use the same local address, port, and API path as the server?'], causes: 'The server may still be loading, may have exited, or the client may target a different endpoint. A running process is not proof of readiness.', check: 'Read the server readiness message and first request error. Compare endpoint and port in the client settings with the runbook, without sharing credentials.', stop: 'Stop if startup failed and return to Start server. Never expose the server publicly just to make a local client connect.', doc: 'serving-security' },
    { id: 'empty', title: 'Empty, broken, or unexpected reply', questions: ['Did the request return an error, zero output tokens, or immediate stop?', 'Does the model card specify a chat template, tokenizer, or required prompt format?'], causes: 'Prompt formatting, stop tokens, generation limits, or tokenizer mismatch can produce similar symptoms. This is not proof the weights are damaged.', check: 'Compare the request format with the publisher example, using a short nonsensitive prompt. Record stop reason and output limit before changing anything.', stop: 'Do not patch multiple generation settings at once. If a minimal documented example fails, preserve the error and exact versions for the engine maintainer.', doc: 'troubleshooting' },
  ],
  'long-context': [
    { id: 'limit', title: 'Context limit exceeded', questions: ['Does the total include system text, history, tool output, and reserved reply tokens?', 'Have you confirmed the context limit actually configured in the running engine?'], causes: 'The request may exceed the configured limit even when the model advertises a larger maximum. Token counts vary by tokenizer and chat template.', check: 'Compare the engine-reported token count and configured context with your complete request, including output allowance.', stop: 'Do not blindly raise the context limit. First calculate the memory impact and preserve a working short-prompt baseline.', doc: 'kv-cache' },
    { id: 'growth', title: 'Memory spikes or crashes as context grows', questions: ['Does a short request succeed with the same model and device?', 'Does memory grow with context, parallel requests, or both?'], causes: 'KV cache, prompt processing workspace, and concurrency can increase memory. Hybrid engines may allocate state differently from an estimate.', check: 'Compare a known short request with the failed request settings and memory observations. Record concurrency and cache precision as separate variables.', stop: 'Stop on allocation failures or severe memory pressure. Change only one recorded setting in the next controlled trial.', doc: 'kv-cache' },
  ],
  'slow-output': [
    { id: 'prefill', title: 'Long wait before the first token', questions: ['Have you identified whether the delay is in download, loading, prompt processing, or the queue?', 'Have you recorded cold versus warm start and the input token count?'], causes: 'Cold start, long prompt processing, request queues, or compilation can dominate first-token delay without affecting later token generation equally.', check: 'Read timestamps around loading, readiness, request arrival, and first output. Compare cold and warm measurements only when their conditions are recorded.', stop: 'Do not label startup time as generation speed. Stop comparisons when prompt sizes or request conditions are different.', doc: 'benchmarking' },
    { id: 'decode', title: 'Tokens arrive slowly after the reply starts', questions: ['Does the engine report the intended accelerator without unexpected CPU offload?', 'Is there memory pressure, swapping, or competition from other requests?'], causes: 'Offload, memory bandwidth, thermal limits, concurrency, or engine support can limit decoding. VRAM capacity alone does not predict speed.', check: 'Inspect device use, memory pressure, and engine offload logs during the same recorded workload. Keep prompt, output length, and concurrency fixed.', stop: 'Do not silently switch model, device, or precision to claim improvement. Stop if the system becomes unstable or overheats.', doc: 'benchmarking' },
  ],
}
export const DEFAULT_DIAGNOSTIC: DiagnosticSelection = { stage: 'download', symptom: 'access', os: 'Windows' }
export function diagnosticPath(selection: DiagnosticSelection): DiagnosticPath {
  if (!STAGES.some(([stage]) => stage === selection.stage)) throw new Error('Unsupported diagnostic selection. Reset this link to start again.')
  const path = PATHS[selection.stage]?.find(p => p.id === selection.symptom)
  if (!path || !SYSTEMS.includes(selection.os)) throw new Error('Unsupported diagnostic selection. Reset this link to start again.')
  return path
}
export function parseDiagnostic(search: string): DiagnosticSelection {
  if (search.length > 1024) throw new Error('Diagnostic link is too long. Reset this link to start again.')
  const params = new URLSearchParams(search)
  for (const key of params.keys()) if (!['v', 'stage', 'symptom', 'os'].includes(key) || params.getAll(key).length !== 1) throw new Error('Unsupported diagnostic link fields. Reset this link to start again.')
  if (params.has('v') && params.get('v') !== '1') throw new Error('Unsupported diagnostic link version. Reset this link to start again.')
  const stage = (params.get('stage') ?? DEFAULT_DIAGNOSTIC.stage) as Stage
  if (!STAGES.some(([id]) => id === stage)) throw new Error('Unsupported diagnostic stage. Reset this link to start again.')
  const result = { stage, symptom: params.get('symptom') ?? PATHS[stage]?.[0]?.id ?? '', os: (params.get('os') ?? 'Windows') as System }
  diagnosticPath(result)
  return result
}
export function diagnosticSearch(selection: DiagnosticSelection): string {
  diagnosticPath(selection)
  return new URLSearchParams({ v: '1', stage: selection.stage, symptom: selection.symptom, os: selection.os }).toString()
}
export const SYSTEM_CHECKS: Record<System, string> = {
  Windows: 'Use Task Manager → Performance to inspect RAM and the intended GPU; use File Explorer → This PC for free disk space. GPU counters vary by driver and selected graph.',
  macOS: 'Use Activity Monitor → Memory to inspect memory pressure and swap; use System Settings → General → Storage for free disk space. Unified memory is shared, not dedicated VRAM.',
  Linux: 'Use your desktop System Monitor and disk utility when available, plus the engine’s own device and memory logs. A desktop monitor may not expose GPU memory; use your vendor’s documented read-only monitor.',
}
// Only bounded in-memory notes. Exported checklists deliberately exclude all free text.
export function sanitizeDiagnosticNote(note: string): string {
  return note.slice(0, 4000).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
}
export function diagnosticChecklist(selection: DiagnosticSelection): string {
  const path = diagnosticPath(selection)
  return ['# Local model diagnostic checklist', '', `Stage: ${STAGES.find(([id]) => id === selection.stage)![1]}`, `Symptom: ${path.title}`, `System: ${selection.os}`, '', 'Possible causes, not a diagnosis:', path.causes, '', 'Evidence to collect:', ...path.questions.map(q => `- [ ] ${q}`), '', 'Next read-only check:', path.check, SYSTEM_CHECKS[selection.os], '', 'Stop criteria:', path.stop, '', 'Preserve the FIRST error. Change only one setting at a time. Never silently change model, device, or precision.', 'Private notes and evidence answers are intentionally excluded. Do not include credentials in shared reports.', `Guide: https://docs.sizeof.ai/${path.doc}`, ''].join('\n')
}
