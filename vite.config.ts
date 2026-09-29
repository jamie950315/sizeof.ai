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
      // Babel 8 types its source map as readonly; Vite accepts the serialized JSON form.
      return result?.code ? { code: result.code, map: result.map ? JSON.stringify(result.map) : null } : undefined
    },
  }, react()],
  server: {
    // Local UI work reads live public data from the production Worker API.
    proxy: { '/api': { target: 'https://sizeof.ai', changeOrigin: true } },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
})
