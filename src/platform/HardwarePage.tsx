import { useState } from 'react'
import { costBudget, DEFAULT_HARDWARE_PLAN, hardwareSearch, hardwareSummary, memoryBudget, parseHardwarePlan, storageBudget, type HardwarePlan } from './hardware'
import './hardware.css'

function calculate<T,>(run: () => T): { value: T; error?: never } | { value?: never; error: string } {
  try { return { value: run() } } catch (error) { return { error: error instanceof Error ? error.message : 'Calculation failed.' } }
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
    return <label className="hardware-field" key={key}><span>{title}</span><input inputMode="decimal" maxLength={32} value={plan[key]} onChange={e => update(key, e.target.value)} /><small>{hint}</small></label>
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
  return <main className="hardware-page">
    <header className="hardware-intro"><span className="hardware-eyebrow">PLAN BEFORE YOU DOWNLOAD</span><h1>Hardware lab<span>.</span></h1><p>Memory, disk space, download time, and running costs. Make the trade-offs visible before choosing your local setup.</p></header>
    {linkError ? <section role="alert" className="hardware-error"><p>{linkError} No calculations are shown for this invalid link.</p><button onClick={() => { setPlan({ ...DEFAULT_HARDWARE_PLAN }); setLinkError(undefined); window.history.replaceState(null, '', '/hardware') }}>Reset plan</button></section> : <>
    <nav className="hardware-tabs" aria-label="Planning tools">{(['memory', 'storage', 'cost'] as const).map((key, i) => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}><small>0{i + 1}</small>{key === 'memory' ? 'Memory budget' : key === 'storage' ? 'Storage & download' : 'Running costs'}</button>)}</nav>
    <div className="hardware-workspace">
      <section className="hardware-controls" aria-label="Planning inputs">
        {tab === 'memory' && <><h2>Build a usable memory budget</h2><p>Capacity is the starting point. Reserve room for the operating system, display, and other applications.</p><label className="hardware-field"><span>Memory layout</span><select value={plan.memory} onChange={e => update('memory', e.target.value)}><option value="dedicated">Dedicated GPU</option><option value="unified">Unified memory</option><option value="multi">Multiple GPUs</option></select></label><div className="hardware-presets" aria-label="Capacity examples">{[8, 16, 24, 32, 64, 96].map(n => <button key={n} onClick={() => update('capacity', String(n))}>{n} GiB</button>)}</div><small>Editable capacity examples, not specific device recommendations.</small>{field('capacity', 'Memory per device (GiB)')}{field('reserve', 'Reserved memory per device (GiB)', 'For unified memory, include the OS and all other applications.')}{plan.memory === 'multi' && field('devices', 'Device count', 'Whole devices. This worksheet assumes equal capacities and reserves.')}</>}
        {tab === 'storage' && <><h2>Leave room for the whole workflow</h2><p>Use a published download size when available. Parameter-based sizes are rough weight estimates only.</p><label className="hardware-field"><span>Size source</span><select value={plan.source} onChange={e => update('source', e.target.value)}><option value="estimate">Estimate from parameters</option><option value="exact">Enter published size</option></select></label>{plan.source === 'estimate' ? <>{field('parameters', 'Parameters (billions)', 'Use total parameters for MoE, not active parameters.')}{field('bits', 'Effective bits per weight', 'Include quantization overhead; “4-bit” does not always mean exactly 4 bits.')}</> : field('exact', 'Published size (GiB)', 'All required weight shards combined; 1 GiB = 1.073741824 GB.')}{field('copies', 'Variant count', 'Same-size variants downloaded and retained. Whole numbers only.')}{field('staging', 'Temporary staging copies', 'Extra disk allowance relative to one variant. Not extra downloads.')}{field('mbps', 'Connection speed (Mbps)', 'Megabits per second, not megabytes per second.')}{field('efficiency', 'Network efficiency (%)', 'User assumption for overhead and connection utilization.')}</>}
        {tab === 'cost' && <><h2>Compare costs on your own terms</h2><p>Enter all prices in the same currency. These are your assumptions, not live market prices.</p>{field('watts', 'Wall power while running (watts)', 'Use measured whole-system power where possible.')}{field('hours', 'Hours per day', '0–24. Electricity is calculated for 30 days.')}{field('tariff', 'Electricity price per kWh')}{field('purchase', 'Hardware purchase cost', 'Use 0 for hardware you already own.')}{field('apiPrice', 'Blended API price per million tokens', 'Weight input, cached input, and output pricing by your actual usage.')}{field('tokens', 'Monthly usage (million tokens)', 'A comparison scenario; this does not predict local token throughput.')}</>}
      </section>
      <section className="hardware-results" aria-label="Planning results" aria-live="polite">
        {tab === 'memory' && (memory.error ? <p role="alert" className="hardware-error">{memory.error}</p> : memory.value && <><span className="hardware-eyebrow">AVAILABLE BUDGET · NOT A FIT GUARANTEE</span><div className="hardware-number">{memory.value.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}<small>GiB</small></div><div className="hardware-meter" role="img" aria-label={`${memory.value.perDevice.toFixed(2)} GiB usable per device, ${memory.value.reserve} GiB reserved`}><span style={{ width: `${memory.value.perDevice / memory.value.capacity * 100}%` }} /></div><dl><div><dt>Usable per device</dt><dd>{memory.value.perDevice.toFixed(2)} GiB</dd></div><div><dt>Reserved per device</dt><dd>{memory.value.reserve.toFixed(2)} GiB</dd></div><div><dt>Devices</dt><dd>{memory.value.devices}</dd></div></dl><p className="hardware-caution">{plan.memory === 'multi' ? 'Summed memory is not one large GPU. The engine and model must support splitting; each device still needs room for its own weights, cache, and runtime overhead. Interconnect speed also matters.' : plan.memory === 'unified' ? 'Unified memory is shared by CPU and GPU. Not all installed memory is available to the model, and runtime allocation limits vary.' : 'Weights, KV cache, and runtime overhead must all fit within the usable budget. A weight file smaller than your GPU is not proof the model will run.'}</p><a href="/">Choose a model and check its memory estimate →</a></>)}
        {tab === 'storage' && (storage.error ? <p role="alert" className="hardware-error">{storage.error}</p> : storage.value && <><span className="hardware-eyebrow">PEAK DISK ALLOWANCE</span><div className="hardware-number">{storage.value.peakGiB.toFixed(2)}<small>GiB</small></div><dl><div><dt>One variant · {plan.source === 'exact' ? 'entered size' : 'estimated weights'}</dt><dd>{storage.value.weightsGiB.toFixed(2)} GiB</dd></div><div><dt>Retained variants</dt><dd>{storage.value.retainedGiB.toFixed(2)} GiB</dd></div><div><dt>Download volume</dt><dd>{storage.value.downloadGB.toFixed(2)} GB</dd></div><div><dt>Estimated transfer time</dt><dd>{(storage.value.seconds / 60).toFixed(1)} minutes</dd></div></dl><p className="hardware-caution">Disk allowance excludes the engine, containers, OS, logs, and unrelated files. Staging is extra local space, not extra network transfer. Retries, server limits, and unpacking can take longer. GGUF, MLX, and safetensors variants may have different sizes.</p><a href="/docs/quantization">Understand quantization and file formats →</a></>)}
        {tab === 'cost' && (cost.error ? <p role="alert" className="hardware-error">{cost.error}</p> : cost.value && <><span className="hardware-eyebrow">ELECTRICITY PER 30 DAYS · YOUR CURRENCY</span><div className="hardware-number">{cost.value.electricity.toFixed(2)}</div><dl><div><dt>Energy</dt><dd>{cost.value.energy.toFixed(2)} kWh</dd></div><div><dt>API scenario / 30 days</dt><dd>{cost.value.api.toFixed(2)}</dd></div><div><dt>API minus electricity</dt><dd>{cost.value.monthlySaving.toFixed(2)}</dd></div><div><dt>Hardware payback</dt><dd>{cost.value.breakEvenMonths === null ? 'Not reached' : `${cost.value.breakEvenMonths.toFixed(1)} months`}</dd></div></dl><p className="hardware-caution">Payback is purchase cost divided by positive monthly savings. This excludes idle power outside entered hours, cooling, maintenance, hardware depreciation, and your time. Local and hosted models may differ in quality and speed. Confirm your workload can actually finish in the entered hours.</p><a href="/docs/benchmarking">Measure your real workload →</a></>)}
      </section>
    </div>
    <footer className="hardware-actions"><button onClick={() => void copy('link')}>Copy planning link</button><button onClick={() => void copy('summary')}>Copy worksheet</button><button onClick={download}>Export worksheet</button><a href="/deploy">Next: deployment guide →</a></footer>{feedback && <p role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
    </>}
    <aside className="hardware-footnote"><strong>Keep the units straight.</strong> Memory and disk figures here use binary GiB. Network volumes use decimal GB, and connection speeds use decimal Mbps. No model files are downloaded by this tool. <a href="/docs/hardware">Read the hardware guide.</a></aside>
  </main>
}
