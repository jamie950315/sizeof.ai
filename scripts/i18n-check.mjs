import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { transformSync } from '@babel/core'
import { createRequire } from 'node:module'
import { extractMessages, locales } from './i18n-catalog.mjs'

const root = resolve(import.meta.dirname, '..')
const jsxLocalization = createRequire(import.meta.url)('./i18n-jsx.cjs')
const messages = JSON.parse(readFileSync(resolve(root, 'src/i18n/messages.json'), 'utf8'))
const source = extractMessages()
const keys = Object.keys(source)
const missing = keys.filter(key => !Object.hasOwn(messages, key))
const obsolete = Object.keys(messages).filter(key => !Object.hasOwn(source, key))
if (missing.length || obsolete.length) throw new Error(`Translation source drift: ${missing.length} new / ${obsolete.length} obsolete messages. Run npm run i18n:extract and npm run i18n:generate before release.`)
const runtimeKeys = new Set()
const visit = dir => {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, item.name)
    if (item.isDirectory()) { if (!['i18n', 'test'].includes(item.name)) visit(path); continue }
    if (!/\.tsx?$/.test(item.name) || /\.(?:test|spec)\./.test(item.name)) continue
    const code = transformSync(readFileSync(path, 'utf8'), {
      filename: path, configFile: false, babelrc: false,
      parserOpts: { plugins: ['typescript', 'jsx'] }, plugins: [jsxLocalization],
    })?.code ?? ''
    for (const match of code.matchAll(/__sizeof_(?:translate|format(?:Rich)?Message)\(((?:"(?:\\.|[^"\\])*")|(?:'(?:\\.|[^'\\])*'))/g)) {
      const quoted = match[1]
      const key = quoted.startsWith('"') ? JSON.parse(quoted.replace(/\\x([\da-f]{2})/gi, '\\u00$1')) : quoted.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\')
      runtimeKeys.add(key.trim())
    }
  }
}
visit(resolve(root, 'src'))
const runtimeProtected = /^(?:(?:[\w.-]+\/)+[\w.-]+|[\w.-]+\.gguf|\{0\}-bit|tok\/s|owner\/repository|owner\/model|sizeof(?:\{0\})?|\.ai|sizeof\.ai|GiB|GB|MB|TB|KB|B|L|KV|KVH|VRAM|RAM|CPU|GPU|FP\d+|BF\d+|Qwen|OpenBMB|Hugging Face|MLX|GGUF|CUDA|ROCm|MTP|MLA|KDA|SSM|MoE|vLLM|llama\.cpp|macOS|Linux|Windows|Apple|NVIDIA)$/
const runtimeTechnical = key => runtimeProtected.test(key.trim()) || !/\s/.test(key) && (/[\/,]/.test(key) || /\.[A-Za-z0-9]/.test(key) || /^[a-z][a-z-]*[.,:]$/.test(key))
const runtimeMissing = [...runtimeKeys].filter(key => /[A-Za-z]{2}/.test(key) && !runtimeTechnical(key) && !Object.hasOwn(messages, key))
if (runtimeMissing.length) throw new Error(`Runtime localization drift: ${runtimeMissing.length} compiled messages are absent from the catalog: ${runtimeMissing.join(' | ')}`)
const placeholders = value => [...value.matchAll(/\{\d+\}/g)].map(match => match[0]).sort().join('|')
for (const locale of locales) {
  const catalog = JSON.parse(readFileSync(resolve(root, `src/i18n/locales/${locale}.json`), 'utf8'))
  const invalid = keys.filter(key => typeof catalog[key] !== 'string' || !catalog[key].trim() || placeholders(catalog[key]) !== placeholders(key))
  if (invalid.length || Object.keys(catalog).some(key => !Object.hasOwn(source, key))) throw new Error(`Incomplete ${locale} catalog: ${invalid.length} missing or invalid translations.`)
}
console.log(`Localization verified: ${keys.length} messages in ${locales.length + 1} languages.`)
