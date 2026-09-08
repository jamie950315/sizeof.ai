import { describe, expect, it } from 'vitest'
import { DEFAULT_CONTEXT_PLAN, contextBudget, contextSearch, contextSummary, parseContextPlan } from './context-budget'
describe('context allocation', () => {
  it('sums every input including template and output reservation', () => { const result = contextBudget({ ...DEFAULT_CONTEXT_PLAN, capacity: '100', system: '10', history: '20', user: '10', documents: '10', tools: '10', overhead: '5', output: '40' }); expect(result).toMatchObject({ input: 65, total: 105, remaining: -5, overflow: 5 }) })
  it.each(['', '-1', '1.5', 'NaN', 'Infinity', '1e3', '10000001', ' 1', '9007199254740992'])('rejects invalid counts %s', value => expect(() => contextBudget({ ...DEFAULT_CONTEXT_PLAN, user: value })).toThrow())
  it('rejects zero capacity but permits zero output', () => { expect(() => contextBudget({ ...DEFAULT_CONTEXT_PLAN, capacity: '0' })).toThrow(); expect(contextBudget({ ...DEFAULT_CONTEXT_PLAN, output: '0' }).total).toBe(0) })
  it('rejects inherited fields', () => expect(() => contextBudget(Object.create(DEFAULT_CONTEXT_PLAN))).toThrow())
  it('rejects unexpected fields instead of serializing them', () => expect(() => contextSearch({ ...DEFAULT_CONTEXT_PLAN, secret: 'x' } as typeof DEFAULT_CONTEXT_PLAN)).toThrow())
  it('round trips a bounded complete link', () => expect(parseContextPlan(`?${contextSearch(DEFAULT_CONTEXT_PLAN)}`)).toEqual(DEFAULT_CONTEXT_PLAN))
  it.each(['?v=1', '?v=2', '?v=1&__proto__=x', `?${contextSearch(DEFAULT_CONTEXT_PLAN)}&user=2`, '?x=' + 'a'.repeat(1024)])('rejects malformed links %s', search => expect(() => parseContextPlan(search)).toThrow())
  it('exports limitations and no prompt contents', () => { expect(contextSummary(DEFAULT_CONTEXT_PLAN)).toContain('not tokenizer-verified'); expect(contextSummary(DEFAULT_CONTEXT_PLAN)).toContain('final rendered prompt') })
})
