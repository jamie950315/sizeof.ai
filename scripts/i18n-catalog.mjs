/** Build-time translation of public checked-in copy only. No runtime translation requests. */
import * as ts from 'typescript/unstable/ast'
import { API } from 'typescript/unstable/sync'
import { transformSync } from '@babel/core'
import { createRequire } from 'node:module'
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, relative, dirname } from 'node:path'

export const locales = ['zh-CN', 'zh-TW', 'ja', 'es', 'ru', 'de', 'fr', 'pt', 'ko', 'ar', 'hi', 'id']
const root = resolve(import.meta.dirname, '..')
const jsxLocalization = createRequire(import.meta.url)('./i18n-jsx.cjs')
export function normalizeJsx(text) {
  return text.split(/\r?\n/).map((line, i, lines) => {
    let value = line.replace(/\t/g, ' ')
    if (i > 0) value = value.replace(/^ +/, '')
    if (i < lines.length - 1) value = value.replace(/ +$/, '')
    return value
  }).filter(Boolean).join(' ')
}
function human(text) {
  return /[A-Za-z]/.test(text) && !/^https?:|^[./]|^#[\da-f]{3,8}$|^\w+:\/\//i.test(text)
    && !(!/\s/.test(text) && (/[\/,]/.test(text) || /\.[A-Za-z0-9]/.test(text) || /^[a-z][a-z-]*[.,:]$/.test(text)))
    && (/[\s]/.test(text) || /^[A-Za-z][A-Za-z .,:;!?…’'()-]*$/.test(text))
    && !/^(?:import |export |curl |python |pip |npm |npx |uv |git |docker |hf |llama-server |vllm |mlx_lm)/.test(text)
    && !/<[!?/]?[a-z][^>]*>/i.test(text)
}
export function extractMessages() {
  const found = new Set(['Language', 'Choose language', 'Translation unavailable. Please try again.', 'Loading translation…'])
  const html = readFileSync(resolve(root, 'index.html'), 'utf8')
  for (const match of html.matchAll(/<title>([^<]+)<\/title>|<meta\s+name="description"\s+content="([^"]+)"/g)) found.add(match[1] || match[2])
  const api = new API()
  const snapshot = api.updateSnapshot({ openProjects: [resolve(root, 'tsconfig.app.json'), resolve(root, 'tsconfig.worker.json')] })
  const visitDir = (dir) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, item.name)
      if (item.isDirectory()) { if (!['locales', 'test'].includes(item.name)) visitDir(path); continue }
      if (dir.endsWith('/src/i18n') && item.name !== 'LanguageFooter.tsx') continue
      if (!/\.tsx?$/.test(item.name) || /\.(test|spec)\./.test(item.name)) continue
      const source = snapshot.getProjects().map(project => project.program.getSourceFile(path)).find(Boolean)
      if (!source) throw new Error(`Source not in TypeScript project: ${path}`)
      const add = (text) => {
        text = text.trim()
        if (human(text)) found.add(text)
        if (text.includes('\n')) for (const line of text.split('\n')) {
          const raw = line.trim()
          const stripped = raw.replace(/^\s*(?:#{1,6}\s+|[-*]\s+(?:\[[ x]\]\s*)?|\d+\.\s+)/, '')
          for (const value of [raw, stripped]) if (human(value)) found.add(value)
        }
      }
      const walk = (node) => {
        if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
          const attribute = String(node.name.escapedText ?? node.name.text ?? '')
          if (['aria-label', 'aria-description', 'aria-valuetext', 'title', 'alt', 'placeholder', 'label'].includes(attribute)) add(node.initializer.text)
        }
        if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
          const children = node.children.filter(child => !ts.isJsxText(child) || normalizeJsx(child.text))
          const inline = new Set(['a', 'br', 'button', 'code', 'em', 'kbd', 'small', 'span', 'strong'])
          const mixed = children.some(child => ts.isJsxExpression(child) || ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child))
            && children.every(child => ts.isJsxText(child) || ts.isJsxExpression(child) && child.expression
              && !ts.isConditionalExpression(child.expression) && !ts.isBinaryExpression(child.expression)
              && !ts.isJsxElement(child.expression) && !ts.isJsxFragment(child.expression)
              || ts.isJsxElement(child) && inline.has(child.openingElement.tagName.getText(source))
              || ts.isJsxSelfClosingElement(child))
          if (mixed) {
            let slot = 0
            const key = children.map(child => ts.isJsxText(child) ? normalizeJsx(child.text) : `{${slot++}}`).join('')
            add(key)
            for (const child of children) {
              if (ts.isJsxExpression(child) && child.expression) child.expression.forEachChild(walk)
              else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) walk(child)
            }
            return
          }
        }
        if (ts.isJsxText(node)) add(normalizeJsx(node.text))
        else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
          const attribute = ts.isJsxAttribute(node.parent) ? String(node.parent.name.escapedText ?? node.parent.name.text ?? '') : undefined
          if (!attribute || ['aria-label', 'aria-description', 'aria-valuetext', 'title', 'alt', 'placeholder', 'label'].includes(String(attribute))) add(node.text)
        }
        else if (ts.isTemplateExpression(node)) {
          add(node.head.text + node.templateSpans.map((span, i) => `{${i}}${span.literal.text}`).join(''))
        }
        node.forEachChild(walk)
      }
      walk(source)
      if (/\.tsx$/.test(item.name)) {
        const compiled = transformSync(readFileSync(path, 'utf8'), {
          filename: path, configFile: false, babelrc: false,
          parserOpts: { plugins: ['typescript', 'jsx'] }, plugins: [jsxLocalization],
        })?.code ?? ''
        for (const match of compiled.matchAll(/__sizeof_(?:translate|format(?:Rich)?Message)\(((?:"(?:\\.|[^"\\])*")|(?:'(?:\\.|[^'\\])*'))/g)) {
          const quoted = match[1]
          const key = quoted.startsWith('"') ? JSON.parse(quoted.replace(/\\x([\da-f]{2})/gi, '\\u00$1')) : quoted.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\')
          const normalized = key.trim()
          if (human(normalized) || /\{\d+\}/.test(normalized) && /[A-Za-z]{2}/.test(normalized)
            && !/^(?:sizeof\{\d+\}|\{\d+\}-bit|\{\d+\}\/)/.test(normalized)) found.add(normalized)
        }
      }
    }
  }
  for (const dir of ['src', 'worker']) visitDir(resolve(root, dir))
  const diagram = readFileSync(resolve(root, 'public/assets/docs/memory-pools.svg'), 'utf8')
  for (const match of diagram.matchAll(/<(?:text|title|desc)\b[^>]*>([\s\S]*?)<\/(?:text|title|desc)>/g)) {
    const text = match[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim()
    if (human(text)) found.add(text)
  }
  snapshot.dispose()
  api.close()
  return Object.fromEntries([...found].sort().map((message) => [message, message]))
}
function patchJson(path, data) {
  const content = JSON.stringify(data, null, 2) + '\n'
  if (process.argv.includes('--write')) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
    return
  }
  const target = relative(root, path)
  const patch = existsSync(path)
    ? `*** Begin Patch\n*** Update File: ${target}\n@@\n${readFileSync(path, 'utf8').trimEnd().split('\n').map(line => '-' + line).join('\n')}\n${content.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`
    : `*** Begin Patch\n*** Add File: ${target}\n${content.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`
  process.stdout.write(patch)
}
export function validateTranslation(source, text) {
  text = text.trim()
  const expected = [...source.matchAll(/\{\d+\}/g)].map(match => match[0]).sort().join('|')
  const actual = [...text.matchAll(/\{\d+\}/g)].map(match => match[0]).sort().join('|')
  if (expected !== actual) throw new Error('Placeholder mismatch')
  return text
}
export async function generate(selected = locales) {
  const messages = extractMessages()
  patchJson(resolve(root, 'src/i18n/messages.json'), messages)
  console.error(`Extracted ${Object.keys(messages).length} public messages`)
  const keys = Object.keys(messages)
  for (const locale of selected) {
    const path = resolve(root, `src/i18n/locales/${locale}.json`)
    const previous = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
    const missing = keys.filter(key => !previous[key])
    if (missing.length) throw new Error(`${locale} requires ${missing.length} reviewed translations; automatic translation is disabled`)
    const output = Object.fromEntries(keys.map(key => [key, validateTranslation(key, previous[key])]))
    if (keys.some(key => !output[key])) throw new Error(`Incomplete locale ${locale}`)
    console.error(`${locale}: prepared ${keys.length} translations`)
    patchJson(path, Object.fromEntries(keys.map(key => [key, output[key]])))
  }
}
if (process.argv[1] === import.meta.filename) {
  if (process.argv.includes('--extract')) {
    const messages = extractMessages(); patchJson(resolve(root, 'src/i18n/messages.json'), messages)
  } else { const selected = process.argv.filter(arg => locales.includes(arg)); await generate(selected.length ? selected : locales) }
}
