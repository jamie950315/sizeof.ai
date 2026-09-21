/// <reference types="node" />
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const locales = ['zh-CN', 'zh-TW', 'ja', 'es', 'ru', 'de', 'fr', 'pt', 'ko', 'ar', 'hi', 'id']
const directory = resolve(import.meta.dirname, 'locales')
const messages: Record<string, string> = JSON.parse(readFileSync(resolve(import.meta.dirname, 'messages.json'), 'utf8'))
const placeholders = (value: string) => [...value.matchAll(/\{\d+\}/g)].map(match => match[0]).sort()
const xmlText = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"')
const intentionallyUntranslated = (value: string) => /^(?:Hugging Face|LM Studio Community|AMD GPU|NVIDIA GPU|WSL2 Linux|Bash \/ Zsh|MLX LM · Apple Silicon|Audio VAE \/ FP32|Video VAE(?: \/ FP16)?|San Jose|Muse Glimmer(?: 30B)?|KAT-Coder V2\.5 Dev|Qwen3\.8 27B \+ Ornith 1\.5 35B A3B|MLX OptiQ \{0\}-bit\{1\}|\{0\} \| sizeof\.ai Docs|\| sizeof\.ai Docs)$/.test(value)
  || /^(?:-H |-d |python3 -m venv |Invoke-RestMethod |User-agent: \*|public, max-age=|llama(?: --help| cli(?: --help| -hf ))|\{0\} \{1\} --ctx-size )/.test(value)
  || /^(?:llama\.cpp · GGUF|model-change-kind model-change-\{0\}|- Total: \{0\} GiB)$/.test(value)

describe('complete checked-in localization coverage', () => {
  it('ships every promised language without extra or missing locale catalogs', () => {
    expect(readdirSync(directory).filter(file => file.endsWith('.json')).map(file => file.slice(0, -5)).sort()).toEqual([...locales].sort())
    expect(Object.keys(messages).length).toBeGreaterThan(1000)
  })

  it('has no legacy override catalog or character-substitution translation pass', () => {
    expect(existsSync(resolve(import.meta.dirname, 'reviewed'))).toBe(false)
    const maintenance = readFileSync(resolve(import.meta.dirname, '../../scripts/i18n-catalog.mjs'), 'utf8')
    expect(maintenance).not.toContain('cleanTranslation')
    expect(maintenance).not.toContain("locale === 'zh-TW'")
    expect(maintenance).not.toMatch(/\.replace\([^\n]*(?:模特|重量|背景|語境|運行時|本地|多式聯運)/)
  })

  for (const locale of locales) {
    it(`${locale} translates every extracted message and preserves all dynamic placeholders`, () => {
      const catalog: Record<string, string> = JSON.parse(readFileSync(resolve(directory, `${locale}.json`), 'utf8'))
      expect(Object.keys(messages).filter(key => !Object.hasOwn(catalog, key)), 'missing messages').toEqual([])
      expect(Object.keys(catalog).filter(key => !Object.hasOwn(messages, key)), 'obsolete messages').toEqual([])
      const invalid = Object.keys(messages).filter(key => typeof catalog[key] !== 'string' || !catalog[key].trim() || JSON.stringify(placeholders(key)) !== JSON.stringify(placeholders(catalog[key])))
      expect(invalid).toEqual([])
      const untranslatedProse = Object.keys(messages).filter(key => catalog[key] === key && /[A-Za-z]{3}.*\s+[A-Za-z]{3}/.test(key) && !intentionallyUntranslated(key))
      expect(untranslatedProse, 'untranslated complete messages').toEqual([])
      for (const key of ['Language', 'Choose language', 'Private notes', 'LOWER BOUND', 'Where does model memory live?', 'Choose your language. Your choice stays with you across the site.']) {
        expect(catalog[key], `${locale}: ${key}`).toBeTruthy()
      }
    })

    it(`${locale} diagram localizes all published prose while preserving static geometry`, () => {
      const source = readFileSync(resolve(import.meta.dirname, '../../public/assets/docs/memory-pools.svg'), 'utf8')
      const localized = readFileSync(resolve(import.meta.dirname, `../../public/assets/docs/memory-pools.${locale}.svg`), 'utf8')
      const catalog: Record<string, string> = JSON.parse(readFileSync(resolve(directory, `${locale}.json`), 'utf8'))
      const nodes = (svg: string) => [...svg.matchAll(/<(?:text|title|desc)\b[^>]*>([^<]*)<\/(?:text|title|desc)>/g)].map(match => xmlText(match[1]))
      const originals = nodes(source)
      const translations = nodes(localized)
      expect(translations.length).toBe(originals.length)
      originals.forEach((original, index) => expect(translations[index]).toBe(catalog[original] ?? original))
      expect(localized.match(/<(?:rect|path)\b[^>]*>/g)).toEqual(source.match(/<(?:rect|path)\b[^>]*>/g))
      expect(localized).not.toMatch(/<script|\bonload=|\bonerror=|\b(?:href|src)=/i)
    })
  }
})
