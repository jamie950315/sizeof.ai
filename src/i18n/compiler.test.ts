/// <reference types="node" />
import { transformSync } from '@babel/core'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const jsxLocalization = createRequire(import.meta.url)('../../scripts/i18n-jsx.cjs')

describe('complete-message JSX localization', () => {
  it('keeps mixed prose as one message and treats expressions as opaque values', () => {
    const result = transformSync(
      'export default function Example({ date }: { date: string }) { return <p>Primary references reviewed on {date}. Upstream commands can change.</p> }',
      {
        filename: '/workspace/src/Example.tsx',
        configFile: false,
        babelrc: false,
        parserOpts: { plugins: ['typescript', 'jsx'] },
        plugins: [jsxLocalization],
      },
    )
    expect(result?.code).toContain('__sizeof_formatRichMessage("Primary references reviewed on {0}. Upstream commands can change.", [date])')
    expect(result?.code).not.toContain('__sizeof_translate("Primary references reviewed on ")')
    expect(result?.code).not.toContain('__sizeof_translate(". Upstream commands can change.")')
  })

  it('keeps prose around inline elements in one reorderable message', () => {
    const result = transformSync(
      'export default function Example({ path }: { path: string }) { return <p>Run the download first, then launch from <code>{path}</code>.</p> }',
      {
        filename: '/workspace/src/Example.tsx',
        configFile: false,
        babelrc: false,
        parserOpts: { plugins: ['typescript', 'jsx'] },
        plugins: [jsxLocalization],
      },
    )
    expect(result?.code).toContain('__sizeof_formatRichMessage("Run the download first, then launch from {0}.", [<code>{path}</code>])')
    expect(result?.code).not.toContain('__sizeof_translate("Run the download first, then launch from ")')
  })
})
