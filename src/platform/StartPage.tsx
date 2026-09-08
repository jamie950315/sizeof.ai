import { useState } from 'react'

const tools = [
  { number: '01', name: 'Model explorer', href: '/', description: 'Search public models and inspect the memory behind every configuration.', label: 'FIND A MODEL' },
  { number: '02', name: 'Deployment workbench', href: '/deploy', description: 'Turn your operating system, model and engine choices into a local-first runbook.', label: 'PREPARE TO RUN' },
  { number: '03', name: 'Hardware planning lab', href: '/hardware', description: 'Plan memory, disk space, download time and running costs with visible assumptions.', label: 'CHECK YOUR BUDGET' },
  { number: '04', name: 'Comparison workspace', href: '/compare', description: 'Compare up to four models, their actual artifacts and the settings you care about.', label: 'COMPARE OPTIONS' },
  { number: '05', name: 'Personal model library', href: '/library', description: 'Keep a shortlist and notes on this browser. Export a backup whenever you need it.', label: 'KEEP YOUR RESEARCH' },
  { number: '06', name: 'Field guide', href: '/docs', description: 'Understand the architecture, make informed tradeoffs, and diagnose your first deployment.', label: 'LEARN THE DETAILS' },
]

export default function StartPage() {
  const [level, setLevel] = useState<'beginner' | 'advanced'>('beginner')
  return <main className="platform-main">
    <section className="platform-intro"><div><p className="platform-eyebrow">A WORKSPACE FOR LOCAL MODELS</p><h1>From a model name<br />to a working plan.</h1><p className="platform-lead">Explore the model. Understand the memory. Prepare the deployment. Keep the evidence in view at every step.</p>
      <div className="platform-actions"><a className="platform-primary" href="/deploy">Build a deployment plan ↗</a><a href="/">Explore models →</a></div></div>
      <aside className="platform-path"><span className="platform-eyebrow">CHOOSE YOUR STARTING POINT</span><div className="platform-toggle"><button aria-pressed={level === 'beginner'} onClick={() => setLevel('beginner')}>First local model</button><button aria-pressed={level === 'advanced'} onClick={() => setLevel('advanced')}>Advanced workflow</button></div>
        {level === 'beginner' ? <ol><li><a href="/docs/getting-started">Learn what runs on your computer</a><small>Hardware, memory, and the first successful response.</small></li><li><a href="/hardware">Make a realistic resource budget</a><small>Leave room for the OS and the rest of your workload.</small></li><li><a href="/deploy">Generate a safe local deployment plan</a><small>Review commands first. Nothing is executed by this site.</small></li></ol>
          : <ol><li><a href="/compare">Compare artifacts and context tradeoffs</a><small>Keep lower bounds separate from safe-fit estimates.</small></li><li><a href="/docs/benchmarking">Measure your actual runtime</a><small>Record prefill, decode, concurrency and peak memory.</small></li><li><a href="/docs/api">Integrate estimates into your tooling</a><small>Public API, CLI, badges and MCP.</small></li></ol>}
      </aside></section>
    <section aria-labelledby="platform-tools"><div className="platform-section-title"><h2 id="platform-tools">One workspace. Six useful entry points.</h2><span>NO ACCOUNT REQUIRED</span></div><div className="platform-tool-grid">{tools.map((tool) => <a className="platform-tool" href={tool.href} key={tool.href}><span>{tool.number} / {tool.label}</span><h3>{tool.name} <b aria-hidden="true">↗</b></h3><p>{tool.description}</p></a>)}</div></section>
    <section className="platform-principles" aria-label="How to read this platform"><h2>Know what the numbers mean.</h2><div><h3>Estimate ≠ benchmark</h3><p>Memory calculations cannot predict tokens per second or verify that an architecture is supported by an engine.</p></div><div><h3>Lower bound ≠ confirmed fit</h3><p>Some runtime memory is unknown. A number below your capacity is not a guarantee.</p></div><div><h3>Local means local</h3><p>Generated commands bind to your computer by default. Library notes stay in this browser; no account or server sync is implied.</p></div></section>
  </main>
}
