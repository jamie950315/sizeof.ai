import { useState } from 'react'
import { translate } from '../i18n/core'
import { toolGroups } from './tools'
import './start.css'

export default function StartPage() {
  const [level, setLevel] = useState<'beginner' | 'advanced'>('beginner')
  return <main className="page start-page">
    <header className="page-head start-head">
      <h1>Workspace overview</h1>
      <p className="lede">Explore the model. Understand the memory. Prepare the deployment. Keep the evidence in view at every step.</p>
      <div className="start-actions"><a className="btn btn-tape" href="/deploy">Build a deployment plan</a><a className="btn" href="/">Explore models</a></div>
    </header>

    <div className="start-layout">
      <aside className="start-path-panel panel" aria-labelledby="start-path-title">
        <h2 id="start-path-title">Choose your starting point</h2>
        <div className="seg" role="group" aria-label="Choose your starting point">
          <button type="button" aria-pressed={level === 'beginner'} onClick={() => setLevel('beginner')}>First local model</button>
          <button type="button" aria-pressed={level === 'advanced'} onClick={() => setLevel('advanced')}>Advanced workflow</button>
        </div>
        {level === 'beginner' ? <ol className="start-steps">
          <li><a href="/docs/getting-started">Learn what runs on your computer</a><small>Hardware, memory, and the first successful response.</small></li>
          <li><a href="/hardware">Make a realistic resource budget</a><small>Leave room for the OS and the rest of your workload.</small></li>
          <li><a href="/deploy">Generate a safe local deployment plan</a><small>Review commands first. Nothing is executed by this site.</small></li>
        </ol> : <ol className="start-steps">
          <li><a href="/compare">Compare artifacts and context tradeoffs</a><small>Keep lower bounds separate from safe-fit estimates.</small></li>
          <li><a href="/docs/benchmarking">Measure your actual runtime</a><small>Record prefill, decode, concurrency and peak memory.</small></li>
          <li><a href="/docs/api">Integrate estimates into your tooling</a><small>Public API, CLI, badges and MCP.</small></li>
        </ol>}
      </aside>

      <section className="start-index" aria-labelledby="platform-tools">
        <div className="section-title"><h2 id="platform-tools">All tools</h2><p>No account required</p></div>
        <div className="start-groups">
          {toolGroups.map((group) => <section className="start-group" key={group.title} aria-labelledby={`start-group-${group.title}`}>
            <h3 id={`start-group-${group.title}`}>{translate(group.title)}</h3>
            <ul>
              {group.tools.filter((tool) => tool.href !== '/start').map((tool) => <li key={tool.href}>
                <h4 className="start-tool"><a href={tool.href}>{translate(tool.name)}</a><span className="start-path" aria-hidden="true">{tool.href}</span></h4>
                <p>{translate(tool.description)}</p>
              </li>)}
            </ul>
          </section>)}
        </div>
      </section>
    </div>

    <section className="start-principles" aria-labelledby="start-principles-title">
      <h2 id="start-principles-title">Know what the numbers mean</h2>
      <dl>
        <div><dt>Estimate ≠ benchmark</dt><dd>Memory calculations cannot predict tokens per second or verify that an architecture is supported by an engine.</dd></div>
        <div><dt>Lower bound ≠ confirmed fit</dt><dd>Some runtime memory is unknown. A number below your capacity is not a guarantee.</dd></div>
        <div><dt>Local means local</dt><dd>Generated commands bind to your computer by default. Library notes stay in this browser; no account or server sync is implied.</dd></div>
      </dl>
    </section>
  </main>
}
