/** Build-time translation of public checked-in copy only. No runtime translation requests. */
import * as ts from 'typescript/unstable/ast'
import { API } from 'typescript/unstable/sync'
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, relative, dirname } from 'node:path'

export const locales = ['zh-CN', 'zh-TW', 'ja', 'es', 'ru', 'de', 'fr', 'pt', 'ko', 'ar', 'hi', 'id']
const root = resolve(import.meta.dirname, '..')
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
    && (/[\s]/.test(text) || /^[A-Za-z][A-Za-z -]*$/.test(text))
    && !/^(?:import |export |curl |python |pip |npm |npx |uv |git |docker |hf |llama-server |vllm |mlx_lm)/.test(text)
    && !/<(?:!DOCTYPE|html|script|style|svg)\b/i.test(text)
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
        if (ts.isJsxText(node)) add(normalizeJsx(node.text))
        else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node.text)
        else if (ts.isTemplateExpression(node)) {
          add(node.head.text + node.templateSpans.map((span, i) => `{${i}}${span.literal.text}`).join(''))
        }
        node.forEachChild(walk)
      }
      walk(source)
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
export function cleanTranslation(source, text, locale) {
  text = text.trim().replace(/[｛{]\s*(\d+)\s*[｝}]/g, '{$1}')
  const expected = [...source.matchAll(/\{\d+\}/g)].map(match => match[0]).sort().join('|')
  const actual = [...text.matchAll(/\{\d+\}/g)].map(match => match[0]).sort().join('|')
  if (expected !== actual) throw new Error('Placeholder mismatch')
  if (/^(?:B|K|M|T|L|[KMGT]i?B|GIB|KV|VRAM|RAM|CPU|GPU|LLM|MLA|MTP|SSM|KDA|VAE|FP\d+|BF\d+|INT\d+|GGUF|MLX|EXL\d|NInfer|vLLM|OpenAI|OpenBMB|Qwen|sizeof|sizeof\.ai|\.ai|KAT-Coder|Hugging Face|Unsloth|Bartowski|LM Studio Community|mlx-community|llama\.cpp|LlamaForCausalLM|MistralForCausalLM|MuseGlimmerForConditionalGeneration)$/.test(source)
    || /^(?:--|-[A-Za-z] |Access-Control-|Cloudflare-CDN-|Content-|Cache-Control|Proxy-Authorization|Referrer-Policy|Retry-After|Set-Cookie|User-[Aa]gent|X-|Allow:|Sitemap:|; Secure)/.test(source)) return source
  if (locale === 'zh-TW' || locale === 'zh-CN') {
    const traditional = locale === 'zh-TW'
    text = text.replace(/模特兒|模特儿|模特/g, '模型').replace(/擁抱臉|拥抱脸|抱臉|抱脸/g, 'Hugging Face')
    if (/models?/i.test(source)) text = text.replace(/型號|型号/g, '模型')
    if (/weights?/i.test(source)) text = text.replace(/重量/g, traditional ? '權重' : '权重')
    if (/context/i.test(source)) text = text.replace(/背景|語境|语境/g, '上下文')
    if (/runtime/i.test(source)) text = text.replace(/運行時|運行時間|运行时|运行时间/g, traditional ? '執行階段' : '运行时')
    if (/\bapply\b/i.test(source)) text = text.replace(/申請|申请/g, traditional ? '套用' : '应用')
    if (/\bshell\b/i.test(source)) text = text.replace(/外殼|外壳/g, traditional ? '殼層' : 'Shell')
    if (/\blocal\b/i.test(source) && traditional) text = text.replace(/本地/g, '本機')
    if (/multimodal/i.test(source)) text = text.replace(/多式聯運|多式联运/g, traditional ? '多模態' : '多模态')
    if (/tokens?/i.test(source) && !/credential|access|auth|hugging face|api key/i.test(source)) text = text.replace(/令牌/g, traditional ? '詞元' : '词元')
    if (/calculator/i.test(source)) text = text.replace(/計算機|计算机/g, traditional ? '計算器' : '计算器')
    if (traditional) text = text.replace(/內存|記憶空間/g, '記憶體').replace(/緩存/g, '快取').replace(/軟件/g, '軟體').replace(/硬件/g, '硬體')
    const glossary = traditional
      ? { 'memory profile': '記憶體設定', 'model weights': '模型權重', 'weights': '權重', 'context': '上下文', 'runtime': '執行階段', 'runtime buffer': '執行階段緩衝區', 'apply': '套用', 'shell': '殼層', 'local models': '本機模型', 'model index': '模型索引', 'models': '模型', 'model': '模型', 'memory': '記憶體', 'language': '語言', 'choose language': '選擇語言' }
      : { 'memory profile': '内存设置', 'model weights': '模型权重', 'weights': '权重', 'context': '上下文', 'runtime': '运行时', 'runtime buffer': '运行时缓冲区', 'apply': '应用', 'shell': 'Shell', 'local models': '本地模型', 'model index': '模型索引', 'models': '模型', 'model': '模型', 'memory': '内存', 'language': '语言', 'choose language': '选择语言' }
    Object.assign(glossary, traditional ? { 'arch': '架構', 'architecture': '架構', 'calculator': '計算器', 'my library': '我的模型庫', 'llm memory, measured': 'LLM 記憶體估算', 'hugging face models': 'Hugging Face 模型', 'multimodal': '多模態' } : { 'arch': '架构', 'architecture': '架构', 'calculator': '计算器', 'my library': '我的模型库', 'llm memory, measured': 'LLM 内存估算', 'hugging face models': 'Hugging Face 模型', 'multimodal': '多模态' })
    const canonical = glossary[source.toLowerCase().replace(/\.$/, '')]
    if (canonical) text = canonical + (source.endsWith('.') ? '。' : '')
  }
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
    const output = Object.fromEntries(keys.map(key => [key, cleanTranslation(key, previous[key], locale)]))
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
