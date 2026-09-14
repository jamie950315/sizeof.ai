import { EXPORT_DISCLAIMER } from './export'
import { translate } from '../i18n/core'

export interface ShareCardModel {
  id: string
  configuration: string
  capacityGiB: number
  totalGiB?: number | null
  lowerBound: boolean
}

export interface ShareCardInput {
  models: ShareCardModel[]
  generatedAt: string
}

function escapeXml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function text(value: string, limit: number) {
  return escapeXml(value.replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, limit))
}

function number(value: number | null | undefined, fallback = '—') {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 4096
    ? value.toFixed(2).replace(/\.00$/, '')
    : fallback
}

export function renderShareCard(input: ShareCardInput) {
  const models = input.models.slice(0, 4)
  const height = 170 + models.length * 74
  const rows = models.map((model, index) => {
    const y = 112 + index * 74
    const status = text(translate(model.lowerBound ? 'LOWER BOUND' : 'ESTIMATE'), 100)
    return `<g><text x="40" y="${y}" class="model">${text(model.id, 120)}</text><text x="40" y="${y + 22}" class="detail">${text(model.configuration, 120)} · ${number(model.totalGiB)} GiB / ${number(model.capacityGiB)} GiB</text><text x="760" y="${y}" text-anchor="end" class="status">${status}</text></g>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${height}" viewBox="0 0 800 ${height}" role="img" aria-label="${text(translate('sizeof.ai memory estimate'), 150)}"><style>.bg{fill:#101622}.title{font:700 28px Arial,sans-serif;fill:#fff}.model{font:700 20px Arial,sans-serif;fill:#fff}.detail{font:16px Arial,sans-serif;fill:#c7d2e5}.status{font:700 14px Arial,sans-serif;fill:#77e6bb}.foot{font:14px Arial,sans-serif;fill:#c7d2e5}</style><rect class="bg" width="800" height="${height}" rx="24"/><text x="40" y="52" class="title">sizeof.ai · ${text(translate('MEMORY ESTIMATE'), 150)}</text><text x="40" y="78" class="detail">${text(input.generatedAt, 40)}</text>${rows}<text x="40" y="${height - 28}" class="foot">${text(translate(EXPORT_DISCLAIMER), 250)}</text></svg>`
}
