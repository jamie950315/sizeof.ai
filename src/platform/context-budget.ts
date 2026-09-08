export const CONTEXT_FIELDS = ['system', 'history', 'user', 'documents', 'tools', 'overhead', 'output'] as const
export type ContextField = typeof CONTEXT_FIELDS[number]
export type ContextPlan = Record<ContextField | 'capacity', string>
export const CONTEXT_LABELS: Record<ContextField | 'capacity', string> = { capacity: 'Configured context limit', system: 'System instructions', history: 'Conversation history', user: 'Current user message', documents: 'Retrieved documents', tools: 'Tool definitions & results', overhead: 'Template & special-token overhead', output: 'Reserved output' }
export const DEFAULT_CONTEXT_PLAN: ContextPlan = { capacity: '8192', system: '0', history: '0', user: '0', documents: '0', tools: '0', overhead: '0', output: '1024' }
export function contextBudget(plan: ContextPlan) {
  const allowed = ['capacity', ...CONTEXT_FIELDS]
  if (!plan || typeof plan !== 'object' || Object.keys(plan).some(key => !allowed.includes(key))) throw new Error('Unknown context field.')
  const values = {} as Record<keyof ContextPlan, number>
  for (const key of ['capacity', ...CONTEXT_FIELDS] as const) {
    if (!Object.hasOwn(plan, key) || typeof plan[key] !== 'string' || !/^\d{1,8}$/.test(plan[key])) throw new Error(`${CONTEXT_LABELS[key]} must be a whole token count.`)
    const value = Number(plan[key])
    if (value > 10000000 || (key === 'capacity' && value < 1)) throw new Error(`${CONTEXT_LABELS[key]} must be ${key === 'capacity' ? '1' : '0'}–10,000,000 tokens.`)
    values[key] = value
  }
  const input = CONTEXT_FIELDS.filter(key => key !== 'output').reduce((sum, key) => sum + values[key], 0)
  const total = input + values.output
  return { values, input, total, remaining: values.capacity - total, overflow: Math.max(0, total - values.capacity) }
}
export function contextSearch(plan: ContextPlan) { contextBudget(plan); return new URLSearchParams({ v: '1', ...plan }).toString() }
export function parseContextPlan(search: string): ContextPlan {
  if (!search) return { ...DEFAULT_CONTEXT_PLAN }
  if (search.length > 1024) throw new Error('Context link is too long.')
  const params = new URLSearchParams(search), keys = ['v', 'capacity', ...CONTEXT_FIELDS]
  if (params.get('v') !== '1') throw new Error('Unsupported context link version.')
  for (const key of params.keys()) if (!keys.includes(key) || params.getAll(key).length !== 1) throw new Error('Unknown or repeated context link field.')
  const plan = { ...DEFAULT_CONTEXT_PLAN }
  for (const key of ['capacity', ...CONTEXT_FIELDS] as const) { const value = params.get(key); if (value === null) throw new Error('Incomplete context link.'); plan[key] = value }
  contextBudget(plan); return plan
}
export function contextSummary(plan: ContextPlan) {
  const result = contextBudget(plan)
  return ['# Context budget', '', 'User-entered counts and reservations; not tokenizer-verified or a memory-fit guarantee.', ...(['capacity', ...CONTEXT_FIELDS] as const).map(key => `${CONTEXT_LABELS[key]}: ${result.values[key]} tokens`), `Total allocated: ${result.total}`, `Remaining: ${result.remaining}`, '', 'Count the final rendered prompt with the exact runtime tokenizer and chat template. Include image/audio token accounting from the runtime. Component token counts may not add exactly at boundaries. Validate against the final prompt count before execution.'].join('\n')
}
