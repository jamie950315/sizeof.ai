import { useState, type CSSProperties } from 'react'
import { translate } from '../i18n/core'
import { costBudget, DEFAULT_HARDWARE_PLAN, hardwareSearch, hardwareSummary, memoryBudget, parseHardwarePlan, storageBudget, type HardwarePlan } from './hardware'
import './hardware.css'

function calculate<T,>(run: () => T): { value: T; error?: never } | { value?: never; error: string } {
  try { return { value: run() } } catch (error) { return { error: error instanceof Error ? error.message : 'Calculation failed.' } }
}

const MAX_DRAWN_DEVICES = 8
const scaleLabel = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1)

/** Capacity ruler: each device is one track, split into usable budget and reserve. */
function MemoryPools({ capacity, perDevice, reserve, devices, label }: { capacity: number; perDevice: number; reserve: number; devices: number; label: string }) {
  const usable = capacity > 0 ? Math.max(0, Math.min(100, perDevice / capacity * 100)) : 0
  const drawn = Math.min(devices, MAX_DRAWN_DEVICES)
  const numbered = devices > 1
  return <div className={`hardware-pools${numbered ? ' numbered' : ''}`} role="img" aria-label={label}>
    <div className="hardware-pool-scale" aria-hidden="true">
      <div className="gauge-scale">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => <span key={ratio} style={{ left: `${ratio * 100}%` }}>{ratio === 1 ? `${scaleLabel(capacity)} GiB` : scaleLabel(capacity * ratio)}</span>)}
      </div>
    </div>
    {Array.from({ length: drawn }, (_, index) => <div className="hardware-pool-row" key={index} aria-hidden="true">
      {numbered && <span className="hardware-pool-index">{index + 1}</span>}
      <div className="hardware-pool-track" style={{ '--usable': `${usable}%` } as CSSProperties}>
        <span className="hardware-pool-usable" />
        {reserve > 0 && <span className="hardware-pool-reserve" />}
      </div>
    </div>)}
    {devices > drawn && <p className="hardware-pool-more" aria-hidden="true">{`+ ${devices - drawn}`}</p>}
  </div>
}

export default function HardwarePage() {
  const [initial] = useState(() => calculate(() => parseHardwarePlan(window.location.search)))
  const [plan, setPlan] = useState<HardwarePlan>(initial.value ?? DEFAULT_HARDWARE_PLAN)
  const [linkError, setLinkError] = useState(initial.error)
  const [tab, setTab] = useState<'memory' | 'storage' | 'cost'>('memory')
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null)
  const memory = calculate(() => memoryBudget(plan)), storage = calculate(() => storageBudget(plan)), cost = calculate(() => costBudget(plan))
  function update(key: keyof HardwarePlan, value: string) { setPlan(p => ({ ...p, [key]: value })); setFeedback(null) }
  function field(key: keyof HardwarePlan, title: string, hint?: string) {
    return <label className="field hardware-field" key={key}><span>{title}</span><input inputMode="decimal" maxLength={32} value={plan[key]} onChange={e => update(key, e.target.value)} />{hint && <small>{hint}</small>}</label>
  }
  async function copy(kind: 'link' | 'summary') {
    try {
      const text = kind === 'link' ? `${window.location.origin}/hardware?${hardwareSearch(plan)}` : hardwareSummary(plan)
      await navigator.clipboard.writeText(text)
      setFeedback({ text: kind === 'link' ? 'Planning link copied.' : 'Worksheet copied.', error: false })
    } catch (error) { setFeedback({ text: `Could not copy. ${error instanceof Error ? error.message : 'Clipboard unavailable.'}`, error: true }) }
  }
  function download() {
    let url: string | undefined
    try {
      const text = hardwareSummary(plan)
      url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
      const a = document.createElement('a'); a.href = url; a.download = 'sizeof-hardware-plan.txt'; a.click()
      setFeedback({ text: 'Worksheet download requested.', error: false })
    } catch (error) { setFeedback({ text: `Could not export. ${error instanceof Error ? error.message : 'Download unavailable.'}`, error: true }) }
    finally { if (url) { const downloadUrl = url; window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000) } }
  }
  return <main className="page hardware-page">
    <header className="page-head"><h1>Hardware lab</h1><p className="lede">Memory, disk space, download time, and running costs. Make the trade-offs visible before choosing your local setup.</p></header>
    {linkError ? <section role="alert" className="platform-alert hardware-link-error"><p>{translate(linkError)} No calculations are shown for this invalid link.</p><button type="button" onClick={() => { setPlan({ ...DEFAULT_HARDWARE_PLAN }); setLinkError(undefined); window.history.replaceState(null, '', '/hardware') }}>Reset plan</button></section> : <>
    <nav className="hardware-tabs" aria-label="Planning tools">{(['memory', 'storage', 'cost'] as const).map(key => <button type="button" key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{key === 'memory' ? 'Memory budget' : key === 'storage' ? 'Storage & download' : 'Running costs'}</button>)}</nav>
    <div className="hardware-grid">
      <section className="hardware-controls" aria-label="Planning inputs">
        {tab === 'memory' && <><h2>Build a usable memory budget</h2><p className="hardware-intro">Capacity is the starting point. Reserve room for the operating system, display, and other applications.</p>
          <label className="field hardware-field"><span>Memory layout</span><select value={plan.memory} onChange={e => update('memory', e.target.value)}><option value="dedicated">Dedicated GPU</option><option value="unified">Unified memory</option><option value="multi">Multiple GPUs</option></select></label>
          <div className="hardware-presets">
            <div className="seg" role="group" aria-label="Capacity examples">{[8, 16, 24, 32, 64, 96].map(n => <button type="button" key={n} aria-pressed={plan.capacity.trim() === String(n)} onClick={() => update('capacity', String(n))}>{n} GiB</button>)}</div>
            <small>Editable capacity examples, not specific device recommendations.</small>
          </div>
          <div className="hardware-fields">{field('capacity', 'Memory per device (GiB)')}{field('reserve', 'Reserved memory per device (GiB)', 'For unified memory, include the OS and all other applications.')}{plan.memory === 'multi' && field('devices', 'Device count', 'Whole devices. This worksheet assumes equal capacities and reserves.')}</div></>}
        {tab === 'storage' && <><h2>Leave room for the whole workflow</h2><p className="hardware-intro">Use a published download size when available. Parameter-based sizes are rough weight estimates only.</p>
          <label className="field hardware-field"><span>Size source</span><select value={plan.source} onChange={e => update('source', e.target.value)}><option value="estimate">Estimate from parameters</option><option value="exact">Enter published size</option></select></label>
          <div className="hardware-fields">{plan.source === 'estimate' ? <>{field('parameters', 'Parameters (billions)', 'Use total parameters for MoE, not active parameters.')}{field('bits', 'Effective bits per weight', 'Include quantization overhead; “4-bit” does not always mean exactly 4 bits.')}</> : field('exact', 'Published size (GiB)', 'All required weight shards combined; 1 GiB = 1.073741824 GB.')}{field('copies', 'Variant count', 'Same-size variants downloaded and retained. Whole numbers only.')}{field('staging', 'Temporary staging copies', 'Extra disk allowance relative to one variant. Not extra downloads.')}{field('mbps', 'Connection speed (Mbps)', 'Megabits per second, not megabytes per second.')}{field('efficiency', 'Network efficiency (%)', 'User assumption for overhead and connection utilization.')}</div></>}
        {tab === 'cost' && <><h2>Compare costs on your own terms</h2><p className="hardware-intro">Enter all prices in the same currency. These are your assumptions, not live market prices.</p>
          <div className="hardware-fields">{field('watts', 'Wall power while running (watts)', 'Use measured whole-system power where possible.')}{field('hours', 'Hours per day', '0–24. Electricity is calculated for 30 days.')}{field('tariff', 'Electricity price per kWh')}{field('purchase', 'Hardware purchase cost', 'Use 0 for hardware you already own.')}{field('apiPrice', 'Blended API price per million tokens', 'Weight input, cached input, and output pricing by your actual usage.')}{field('tokens', 'Monthly usage (million tokens)', 'A comparison scenario; this does not predict local token throughput.')}</div></>}
      </section>
      <section className="hardware-results" aria-label="Planning results" aria-live="polite">
        {tab === 'memory' && (memory.error ? <p role="alert" className="platform-alert">{memory.error}</p> : memory.value && <>
          <p className="hardware-readout-label">Available budget · not a fit guarantee</p>
          <div className="total-number"><span>{memory.value.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span><small>GiB</small></div>
          <MemoryPools capacity={memory.value.capacity} perDevice={memory.value.perDevice} reserve={memory.value.reserve} devices={memory.value.devices} label={`${memory.value.perDevice.toFixed(2)} GiB usable per device, ${memory.value.reserve} GiB reserved`} />
          <dl className="spec"><div className="hardware-key-usable"><dt>Usable per device</dt><dd>{memory.value.perDevice.toFixed(2)} GiB</dd></div><div className="hardware-key-reserve"><dt>Reserved per device</dt><dd>{memory.value.reserve.toFixed(2)} GiB</dd></div><div><dt>Devices</dt><dd>{memory.value.devices}</dd></div></dl>
          <p className="hardware-caution">{plan.memory === 'multi' ? 'Summed memory is not one large GPU. The engine and model must support splitting; each device still needs room for its own weights, cache, and runtime overhead. Interconnect speed also matters.' : plan.memory === 'unified' ? 'Unified memory is shared by CPU and GPU. Not all installed memory is available to the model, and runtime allocation limits vary.' : 'Weights, KV cache, and runtime overhead must all fit within the usable budget. A weight file smaller than your GPU is not proof the model will run.'}</p>
          <a className="hardware-next" href="/">Choose a model and check its memory estimate</a></>)}
        {tab === 'storage' && (storage.error ? <p role="alert" className="platform-alert">{storage.error}</p> : storage.value && <>
          <p className="hardware-readout-label">Peak disk allowance</p>
          <div className="total-number"><span>{storage.value.peakGiB.toFixed(2)}</span><small>GiB</small></div>
          <dl className="spec"><div><dt>One variant · {plan.source === 'exact' ? 'entered size' : 'estimated weights'}</dt><dd>{storage.value.weightsGiB.toFixed(2)} GiB</dd></div><div><dt>Retained variants</dt><dd>{storage.value.retainedGiB.toFixed(2)} GiB</dd></div><div><dt>Download volume</dt><dd>{storage.value.downloadGB.toFixed(2)} GB</dd></div><div><dt>Estimated transfer time</dt><dd>{(storage.value.seconds / 60).toFixed(1)} minutes</dd></div></dl>
          <p className="hardware-caution">Disk allowance excludes the engine, containers, OS, logs, and unrelated files. Staging is extra local space, not extra network transfer. Retries, server limits, and unpacking can take longer. GGUF, MLX, and safetensors variants may have different sizes.</p>
          <a className="hardware-next" href="/docs/quantization">Understand quantization and file formats</a></>)}
        {tab === 'cost' && (cost.error ? <p role="alert" className="platform-alert">{cost.error}</p> : cost.value && <>
          <p className="hardware-readout-label">Electricity per 30 days · your currency</p>
          <div className="total-number"><span>{cost.value.electricity.toFixed(2)}</span></div>
          <dl className="spec"><div><dt>Energy</dt><dd>{cost.value.energy.toFixed(2)} kWh</dd></div><div><dt>API scenario / 30 days</dt><dd>{cost.value.api.toFixed(2)}</dd></div><div><dt>API minus electricity</dt><dd>{cost.value.monthlySaving.toFixed(2)}</dd></div><div><dt>Hardware payback</dt><dd>{cost.value.breakEvenMonths === null ? 'Not reached' : `${cost.value.breakEvenMonths.toFixed(1)} months`}</dd></div></dl>
          <p className="hardware-caution">Payback is purchase cost divided by positive monthly savings. This excludes idle power outside entered hours, cooling, maintenance, hardware depreciation, and your time. Local and hosted models may differ in quality and speed. Confirm your workload can actually finish in the entered hours.</p>
          <a className="hardware-next" href="/docs/benchmarking">Measure your real workload</a></>)}
      </section>
    </div>
    <footer className="hardware-actions"><button type="button" className="btn" onClick={() => void copy('link')}>Copy planning link</button><button type="button" className="btn" onClick={() => void copy('summary')}>Copy worksheet</button><button type="button" className="btn" onClick={download}>Export worksheet</button><a className="btn btn-primary" href="/deploy">Next: deployment guide</a></footer>
    {feedback && <p className={`hardware-feedback${feedback.error ? ' platform-alert' : ''}`} role={feedback.error ? 'alert' : 'status'}>{translate(feedback.text)}</p>}
    </>}
    <aside className="hardware-footnote"><strong>Keep the units straight.</strong> Memory and disk figures here use binary GiB. Network volumes use decimal GB, and connection speeds use decimal Mbps. No model files are downloaded by this tool. <a href="/docs/hardware">Read the hardware guide.</a></aside>
  </main>
}
