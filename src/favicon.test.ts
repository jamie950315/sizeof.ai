import { describe, expect, it } from 'vitest'
import indexHtml from '../index.html?raw'

describe('favicon assets', () => {
  it('uses the selected redesigned favicon at browser-tab sizes', () => {
    expect(indexHtml).toContain('<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png" />')
    expect(indexHtml).toContain('<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />')
    expect(indexHtml).toContain('<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />')
    expect(indexHtml).not.toContain('/favicon.svg')
  })
})
