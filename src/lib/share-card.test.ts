import { describe, expect, it } from 'vitest'
import { renderShareCard } from './share-card'

describe('share card SVG', () => {
  it('escapes XML, bounds display values, and visibly labels lower bounds', () => {
    const svg = renderShareCard({
      models: [{
        id: 'Qwen/<script>alert(1)</script>',
        configuration: '4bit · 8K',
        capacityGiB: Number.POSITIVE_INFINITY,
        totalGiB: 18.5,
        lowerBound: true,
      }],
      generatedAt: '2026-08-30T12:00:00.000Z',
    })

    expect(svg).toContain('<svg')
    expect(svg).toContain('LOWER BOUND')
    expect(svg).toContain('Estimate, not a benchmark or guarantee.')
    expect(svg).toContain('&lt;script&gt;')
    expect(svg).not.toContain('<script>')
    expect(svg).not.toContain('Infinity')
    expect(svg).not.toContain('benchmark result')
  })

  it('renders an estimate card without external resources or executable content', () => {
    const svg = renderShareCard({
      models: [{ id: 'Qwen/Example', configuration: '4bit · 8K', capacityGiB: 32, totalGiB: 18.5, lowerBound: false }],
      generatedAt: '2026-08-30T12:00:00.000Z',
    })

    expect(svg).toContain('ESTIMATE')
    expect(svg).not.toMatch(/(?:<script|\s(?:href|src)=|onload=|<image)/i)
  })
})
