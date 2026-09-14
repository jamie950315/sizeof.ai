import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { transformAsync } from '@babel/core'
import { createRequire } from 'node:module'

const jsxLocalization = createRequire(import.meta.url)('./scripts/i18n-jsx.cjs')

export default defineConfig({
  plugins: [{
    name: 'sizeof-localization',
    enforce: 'pre',
    async transform(source, id) {
      if (!/\/src\/.*\.tsx?$/.test(id) || /\/(?:i18n|test)\/|\.test\.tsx?$/.test(id)) return
      const result = await transformAsync(source, {
        filename: id, configFile: false, babelrc: false, sourceMaps: true,
        parserOpts: { plugins: ['typescript', 'jsx'] }, plugins: [jsxLocalization],
      })
      return result?.code ? { code: result.code, map: result.map } : undefined
    },
  }, react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
})
