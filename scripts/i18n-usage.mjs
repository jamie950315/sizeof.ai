/**
 * Generate translator usage notes: where each catalog message appears, what kind of
 * UI element renders it, and a display-width budget for space-constrained elements.
 *
 *   node scripts/i18n-usage.mjs          # print a summary
 *   node scripts/i18n-usage.mjs --write  # write src/i18n/usage-notes.json
 *   node scripts/i18n-usage.mjs --check  # exit 1 when the checked-in notes are stale
 */
import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { normalizeJsx } from './i18n-catalog.mjs'

const traverse = traverseModule.default ?? traverseModule
const root = resolve(import.meta.dirname, '..')
const messages = JSON.parse(readFileSync(resolve(root, 'src/i18n/messages.json'), 'utf8'))

/** Pages a translator can open to see the message in context. Order matters: first match wins. */
export const PAGES = [
  ['home', 'Home calculator (/)', /^src\/(?:App\.tsx|main\.tsx)$/],
  ['model-detail', 'Model detail (/{owner}/{repo})', /^src\/ModelDetailPage\.tsx$/],
  ['compare', 'Compare (/compare)', /^src\/ComparePage\.tsx$/],
  ['start', 'Start (/start)', /^src\/platform\/(?:StartPage\.tsx|tools\.ts)$/],
  ['deploy', 'Deploy runbook (/deploy)', /^src\/platform\/(?:DeployPage\.tsx|deployment\.ts|ArtifactPicker\.tsx|artifact-picker\.ts)$/],
  ['hardware', 'Hardware planner (/hardware)', /^src\/platform\/(?:HardwarePage\.tsx|hardware\.ts)$/],
  ['library', 'Library (/library)', /^src\/platform\/(?:LibraryPage\.tsx|library\.ts|SaveModelButton\.tsx)$/],
  ['runs', 'Run history (/runs)', /^src\/platform\/(?:RunHistoryPage\.tsx|run-history\.ts|RunComparison\.tsx|run-diff\.ts|SaveRunForm\.tsx)$/],
  ['troubleshoot', 'Troubleshoot (/troubleshoot)', /^src\/platform\/(?:TroubleshootPage\.tsx|troubleshooting\.ts)$/],
  ['benchmarks', 'Benchmarks (/benchmarks)', /^src\/platform\/(?:BenchmarkPage\.tsx|benchmark(?:-import)?\.ts|BenchmarkImportPanel\.tsx)$/],
  ['status', 'Status (/status)', /^src\/platform\/StatusPage\.tsx$/],
  ['compatibility', 'Compatibility (/compatibility)', /^src\/platform\/(?:CompatibilityPage\.tsx|compatibility\.ts)$/],
  ['context-budget', 'Context budget (/context)', /^src\/platform\/(?:ContextBudgetPage\.tsx|context-budget\.ts)$/],
  ['model-changes', 'Model changes (/model-changes)', /^src\/platform\/ModelChangesPage\.tsx$/],
  ['docs', 'Documentation (/docs)', /^src\/docs\//],
  ['chrome', 'Site navigation, language footer, page metadata', /^(?:src\/platform\/Platform(?:Nav|Router)\.tsx|src\/i18n\/|index\.html$)/],
  ['calculator-components', 'Shared calculator components (home, model detail, compare)', /^src\/components\//],
  ['estimator-data', 'Shared estimator labels and model data (all calculator pages, exports)', /^src\/(?:lib|data)\//],
  ['worker', 'Worker API errors, server-rendered docs and metadata', /^worker\//],
  ['diagrams', 'Documentation diagrams (SVG labels)', /^public\/assets\/docs\//],
]

/**
 * Display-width budget for constrained elements, relative to the English width.
 * Width counts East Asian wide characters as 2 columns and combining marks as 0.
 */
export const BUDGETS = {
  button: { factor: 1.8, slack: 10 },
  'table-header': { factor: 1.8, slack: 10 },
  option: { factor: 2, slack: 12 },
  label: { factor: 2, slack: 12 },
  heading: { factor: 2.2, slack: 14 },
}

export function displayWidth(text) {
  let width = 0
  for (const char of text.normalize('NFC')) {
    const code = char.codePointAt(0)
    if (/\p{Mn}|\p{Me}|\p{Cf}/u.test(char)) continue
    width += (code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3)
      || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe4f) || (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6) ? 2 : 1
  }
  return width
}

export function widthBudget(kind, source) {
  const budget = BUDGETS[kind]
  if (!budget) return null
  const width = displayWidth(source.replace(/\{\d+\}/g, ''))
  return Math.max(Math.ceil(width * budget.factor), width + budget.slack)
}

const attributeKinds = {
  'aria-label': 'accessibility', 'aria-description': 'accessibility', 'aria-valuetext': 'accessibility',
  title: 'tooltip', alt: 'accessibility', placeholder: 'placeholder', label: 'label',
}
const elementKinds = {
  button: 'button', th: 'table-header', option: 'option', label: 'label', legend: 'label', dt: 'label',
  h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading', summary: 'heading', caption: 'heading',
  a: 'link', td: 'table-cell',
}
const propertyKinds = {
  label: 'label', shortLabel: 'label', name: 'label', title: 'heading', heading: 'heading', caption: 'heading',
  button: 'button', action: 'button', cta: 'button', placeholder: 'placeholder', error: 'error', message: 'body',
}
const kindRank = ['button', 'table-header', 'option', 'label', 'heading', 'placeholder', 'tooltip', 'accessibility', 'link', 'table-cell', 'error', 'body', 'export', 'diagram', 'api']

function classify(path, file) {
  if (file.startsWith('worker/')) return 'api'
  let child = null
  let current = path
  while (current) {
    const node = current.node
    if (current.isJSXAttribute()) return attributeKinds[node.name.name] ?? 'body'
    if (current.isJSXElement()) {
      const name = node.openingElement.name.name
      if (elementKinds[name]) return elementKinds[name]
    }
    if (current.isObjectProperty() && child && node.value === child.node) {
      const kind = propertyKinds[node.key.name ?? node.key.value]
      if (kind) return kind
    }
    if (current.isNewExpression() && node.callee.name === 'Error') return 'error'
    if (current.isThrowStatement()) return 'error'
    if (current.isCallExpression() && node.callee.property?.name === 'join') return 'export'
    if (current.isFunction() || current.isProgram()) break
    child = current
    current = current.parentPath
  }
  return /\/(?:export|share-card)\.ts$/.test(file) ? 'export' : 'body'
}

function sourceFiles(dir, files = []) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, item.name)
    if (item.isDirectory()) { if (!['locales', 'test'].includes(item.name)) sourceFiles(path, files); continue }
    if (/\.tsx?$/.test(item.name) && !/\.(?:test|spec)\./.test(item.name) && !item.name.endsWith('.d.ts')) files.push(path)
  }
  return files
}

function jsxKey(children) {
  const inline = new Set(['a', 'br', 'button', 'code', 'em', 'kbd', 'small', 'span', 'strong'])
  if (!children.some(child => child.type === 'JSXExpressionContainer' || child.type === 'JSXElement')) return null
  let slot = 0
  let key = ''
  for (const child of children) {
    if (child.type === 'JSXText') key += normalizeJsx(child.value)
    else if (child.type === 'JSXElement' && (child.openingElement.selfClosing || inline.has(child.openingElement.name.name))) key += `{${slot++}}`
    else if (child.type === 'JSXExpressionContainer' && child.expression.type !== 'JSXEmptyExpression') key += `{${slot++}}`
    else return null
  }
  return key.trim()
}

export function collectUsage() {
  const usage = new Map(Object.keys(messages).map(key => [key, { kinds: new Set(), pages: new Set(), files: new Set() }]))
  const record = (text, file, kind) => {
    const candidates = new Set([text, text.trim()])
    if (text.includes('\n')) for (const part of text.split('\n')) {
      const raw = part.trim()
      candidates.add(raw)
      candidates.add(raw.replace(/^\s*(?:#{1,6}\s+|[-*]\s+(?:\[[ x]\]\s*)?|\d+\.\s+)/, ''))
    }
    for (const candidate of candidates) {
      const entry = usage.get(candidate)
      if (!entry) continue
      entry.kinds.add(text.includes('\n') && candidate !== text.trim() ? 'export' : kind)
      entry.files.add(file)
      entry.pages.add(PAGES.find(([, , pattern]) => pattern.test(file))?.[0] ?? 'other')
    }
  }
  for (const path of [...sourceFiles(resolve(root, 'src')), ...sourceFiles(resolve(root, 'worker'))]) {
    const file = relative(root, path)
    const ast = parse(readFileSync(path, 'utf8'), { sourceType: 'module', plugins: ['typescript', 'jsx'], errorRecovery: true })
    traverse(ast, {
      StringLiteral(p) { record(p.node.value, file, classify(p, file)) },
      TemplateLiteral(p) {
        const key = p.node.quasis.map((part, index) => (part.value.cooked ?? '') + (index < p.node.expressions.length ? `{${index}}` : '')).join('')
        record(key, file, classify(p, file))
      },
      JSXText(p) { const text = normalizeJsx(p.node.value); if (text) record(text, file, classify(p, file)) },
      JSXElement(p) { const key = jsxKey(p.node.children); if (key) record(key, file, classify(p, file)) },
      JSXFragment(p) { const key = jsxKey(p.node.children); if (key) record(key, file, classify(p, file)) },
    })
  }
  // Seeded by the extractor rather than found in source: the language picker and its loading states.
  for (const key of ['Language', 'Choose language', 'Translation unavailable. Please try again.', 'Loading translation…']) record(key, 'src/i18n/LanguageFooter.tsx', key.length < 20 ? 'label' : 'body')
  const html = readFileSync(resolve(root, 'index.html'), 'utf8')
  for (const match of html.matchAll(/<title>([^<]+)<\/title>|<meta\s+name="description"\s+content="([^"]+)"/g)) record(match[1] || match[2], 'index.html', match[1] ? 'heading' : 'body')
  const diagrams = resolve(root, 'public/assets/docs')
  for (const name of readdirSync(diagrams).filter(file => /^[a-z0-9]+(?:-[a-z0-9]+)*\.svg$/.test(file))) {
    const svg = readFileSync(resolve(diagrams, name), 'utf8')
    for (const match of svg.matchAll(/<(text|title|desc)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
      record(match[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim(), `public/assets/docs/${name}`, 'diagram')
    }
  }
  return usage
}

export function buildNotes() {
  const usage = collectUsage()
  const pages = Object.fromEntries([...PAGES.map(([id, title]) => [id, { title, messages: {} }]), ['other', { title: 'Not located in source (internal or generated)', messages: {} }]])
  for (const [key, entry] of usage) {
    const kinds = [...entry.kinds].sort((a, b) => kindRank.indexOf(a) - kindRank.indexOf(b))
    const kind = kinds[0] ?? 'internal'
    const note = { kind, maxWidth: widthBudget(kind, key), where: [...entry.files].sort().slice(0, 3) }
    if (kinds.length > 1) note.alsoUsedAs = kinds.slice(1)
    for (const page of entry.pages.size ? entry.pages : ['other']) pages[page].messages[key] = note
  }
  for (const page of Object.values(pages)) page.messages = Object.fromEntries(Object.entries(page.messages).sort(([a], [b]) => a.localeCompare(b)))
  return {
    $comment: 'Generated by scripts/i18n-usage.mjs. maxWidth is a display-width budget (East Asian wide = 2 columns) for space-constrained elements; null means wrapping prose.',
    budgets: BUDGETS,
    pages,
  }
}

if (process.argv[1] === import.meta.filename) {
  const notes = buildNotes()
  const target = resolve(root, 'src/i18n/usage-notes.json')
  if (process.argv.includes('--check')) {
    const current = JSON.stringify(notes, null, 2) + '\n'
    if (readFileSync(target, 'utf8') !== current) {
      console.error('src/i18n/usage-notes.json is stale. Run: node scripts/i18n-usage.mjs --write')
      process.exit(1)
    }
    process.exit(0)
  }
  if (process.argv.includes('--write')) writeFileSync(target, JSON.stringify(notes, null, 2) + '\n')
  for (const [id, page] of Object.entries(notes.pages)) {
    const kinds = {}
    for (const note of Object.values(page.messages)) kinds[note.kind] = (kinds[note.kind] ?? 0) + 1
    console.log(id.padEnd(22), String(Object.keys(page.messages).length).padStart(4), JSON.stringify(kinds))
  }
}
