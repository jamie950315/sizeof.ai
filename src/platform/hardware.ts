export type HardwarePlan = {
  memory: 'dedicated' | 'unified' | 'multi'
  capacity: string; reserve: string; devices: string
  source: 'estimate' | 'exact'
  parameters: string; bits: string; exact: string; copies: string; staging: string
  mbps: string; efficiency: string
  watts: string; hours: string; tariff: string; purchase: string; apiPrice: string; tokens: string
}

export const DEFAULT_HARDWARE_PLAN: HardwarePlan = {
  memory: 'dedicated', capacity: '24', reserve: '2', devices: '2',
  source: 'estimate', parameters: '8', bits: '4.5', exact: '5', copies: '2', staging: '1',
  mbps: '100', efficiency: '80', watts: '250', hours: '4', tariff: '0.15', purchase: '0', apiPrice: '2', tokens: '1',
}

export function numberInput(value: string, label: string, min = 0, max = 1e9, integer = false): number {
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) throw new Error(`${label}: enter a finite, non-negative number.`)
  const n = Number(value)
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw new Error(`${label}: enter ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}.`)
  }
  return n
}

export function memoryBudget(p: HardwarePlan) {
  const capacity = numberInput(p.capacity, 'Memory per device', 0.1, 1048576)
  const reserve = numberInput(p.reserve, 'Reserved memory', 0, capacity)
  const devices = p.memory === 'multi' ? numberInput(p.devices, 'Device count', 1, 1024, true) : 1
  return { capacity, reserve, devices, perDevice: capacity - reserve, total: (capacity - reserve) * devices }
}

export function storageBudget(p: HardwarePlan) {
  const weightsGiB = p.source === 'exact' ? numberInput(p.exact, 'Published size', 0.000001, 1e9)
    : numberInput(p.parameters, 'Parameters', 0.000001, 1e6) * 1e9 * numberInput(p.bits, 'Effective bits per weight', 0.1, 64) / 8 / 2 ** 30
  const copies = numberInput(p.copies, 'Variant count', 1, 1000, true)
  const staging = numberInput(p.staging, 'Temporary staging copies', 0, 10)
  const mbps = numberInput(p.mbps, 'Connection speed', 0.001, 1e7)
  const efficiency = numberInput(p.efficiency, 'Network efficiency', 1, 100) / 100
  return { weightsGiB, retainedGiB: weightsGiB * copies, peakGiB: weightsGiB * (copies + staging),
    downloadGB: weightsGiB * copies * 2 ** 30 / 1e9,
    seconds: weightsGiB * copies * 2 ** 30 * 8 / (mbps * 1e6 * efficiency) }
}

export function costBudget(p: HardwarePlan) {
  const energy = numberInput(p.watts, 'Wall power', 0, 1e6) / 1000 * numberInput(p.hours, 'Hours per day', 0, 24) * 30
  const electricity = energy * numberInput(p.tariff, 'Electricity price', 0, 1e6)
  const api = numberInput(p.apiPrice, 'Blended API price', 0, 1e6) * numberInput(p.tokens, 'Monthly million tokens', 0, 1e9)
  const purchase = numberInput(p.purchase, 'Hardware purchase cost', 0, 1e9)
  const monthlySaving = api - electricity
  return { energy, electricity, api, monthlySaving, breakEvenMonths: monthlySaving > 0 ? purchase / monthlySaving : null }
}

export function parseHardwarePlan(search: string): HardwarePlan {
  if (search.length > 4096) throw new Error('This planning link is too long. Reset the plan to continue.')
  const params = new URLSearchParams(search)
  const plan = { ...DEFAULT_HARDWARE_PLAN }
  for (const key of Object.keys(plan) as (keyof HardwarePlan)[]) {
    const values = params.getAll(key)
    if (values.length > 1) throw new Error(`Duplicate planning field: ${key}.`)
    const value = values[0]
    if (value === undefined) continue
    if (value.length > 32) throw new Error(`Planning field is too long: ${key}.`)
    if (key === 'memory') {
      if (!['dedicated', 'unified', 'multi'].includes(value)) throw new Error('Unknown memory layout in planning link.')
      plan.memory = value as HardwarePlan['memory']
    } else if (key === 'source') {
      if (value !== 'exact' && value !== 'estimate') throw new Error('Unknown size source in planning link.')
      plan.source = value
    } else plan[key] = value
  }
  return plan
}

export function hardwareSearch(p: HardwarePlan): string {
  memoryBudget(p); storageBudget(p); costBudget(p)
  return new URLSearchParams(p).toString()
}

export function hardwareSummary(p: HardwarePlan): string {
  const m = memoryBudget(p), s = storageBudget(p), c = costBudget(p)
  return `sizeof.ai hardware worksheet\n\nMemory layout: ${p.memory}\nUsable budget: ${m.total.toFixed(2)} GiB (${m.perDevice.toFixed(2)} GiB per device)\nWeight size (${p.source}): ${s.weightsGiB.toFixed(2)} GiB\nRetained variants: ${s.retainedGiB.toFixed(2)} GiB\nPeak disk allowance: ${s.peakGiB.toFixed(2)} GiB\nDownload: ${s.downloadGB.toFixed(2)} GB, ${(s.seconds / 60).toFixed(1)} minutes\nElectricity per 30 days: ${c.electricity.toFixed(2)} currency units\nAPI comparison per 30 days: ${c.api.toFixed(2)} currency units\nHardware payback: ${c.breakEvenMonths === null ? 'not reached with these inputs' : `${c.breakEvenMonths.toFixed(1)} months`}\n\nInputs: ${hardwareSearch(p)}\n\nEstimates, not a compatibility or speed guarantee. Weight size excludes runtime memory. Multi-GPU memory is not automatically pooled. All prices are user inputs in one currency; throughput and equivalent output quality are not validated.\n`
}
