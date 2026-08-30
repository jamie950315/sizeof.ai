import { useMemo, useState } from 'react'
import { engineProfiles, type EngineProfileId, type ServingHardwareKind } from '../data/engine-profiles'
import type { ModelSpec } from '../data/models'
import type { HuggingFaceVariantFormat } from '../lib/huggingface-variants'
import { estimateServingScenario } from '../lib/serving-estimator'
import type { EstimateOptions } from '../lib/estimator'

interface Props {
  model: ModelSpec
  estimateOptions: Omit<EstimateOptions, 'context'>
  artifactFormat: HuggingFaceVariantFormat | null
  hardwareKind: ServingHardwareKind
}

type PresetId = 'chat' | 'coding-agent' | 'long-document' | 'rag'

const examples: Record<PresetId, { promptTokens: number; maxGeneratedTokens: number; concurrency: number }> = {
  chat: { promptTokens: 1024, maxGeneratedTokens: 512, concurrency: 1 },
  'coding-agent': { promptTokens: 2048, maxGeneratedTokens: 512, concurrency: 1 },
  'long-document': { promptTokens: 4096, maxGeneratedTokens: 512, concurrency: 1 },
  rag: { promptTokens: 2048, maxGeneratedTokens: 256, concurrency: 4 },
}

function boundedExample(example: typeof examples[PresetId], nativeContext: number) {
  const generated = Math.max(1, Math.min(example.maxGeneratedTokens, nativeContext - 1))
  return { ...example, promptTokens: Math.max(1, Math.min(example.promptTokens, nativeContext - generated)), maxGeneratedTokens: generated }
}

function formatGiB(value: number | null) {
  return value === null ? '—' : `${value.toFixed(2)} GiB`
}

export default function ServingScenario({ model, estimateOptions, artifactFormat, hardwareKind }: Props) {
  const defaultExample = boundedExample(examples.chat, model.maxContext)
  const [profileId, setProfileId] = useState<EngineProfileId>('vllm')
  const [preset, setPreset] = useState<PresetId>('chat')
  const [promptTokens, setPromptTokens] = useState(defaultExample.promptTokens)
  const [maxGeneratedTokens, setMaxGeneratedTokens] = useState(defaultExample.maxGeneratedTokens)
  const [concurrency, setConcurrency] = useState(defaultExample.concurrency)
  const [batchLabel, setBatchLabel] = useState('')

  const result = useMemo(() => {
    try {
      return { value: estimateServingScenario(model, { ...estimateOptions, profileId, promptTokens, maxGeneratedTokens, concurrency, batchLabel, artifactFormat, hardwareKind }), error: null }
    } catch (reason) {
      return { value: null, error: reason instanceof Error ? reason.message : 'Serving input is invalid.' }
    }
  }, [artifactFormat, batchLabel, concurrency, estimateOptions, hardwareKind, maxGeneratedTokens, model, profileId, promptTokens])
  const profile = engineProfiles.find((candidate) => candidate.id === profileId) ?? engineProfiles[2]

  function applyExample(nextPreset: PresetId) {
    const next = boundedExample(examples[nextPreset], model.maxContext)
    setPreset(nextPreset)
    setPromptTokens(next.promptTokens)
    setMaxGeneratedTokens(next.maxGeneratedTokens)
    setConcurrency(next.concurrency)
  }

  return (
    <section className="serving-scenario" role="group" aria-label="Serving scenario">
      <details>
        <summary>Serving scenario</summary>
        <p>Examples only; editable, not recommended guarantees.</p>
        <div className="serving-input-grid">
          <label>Engine profile
            <select aria-label="Engine profile" value={profileId} onChange={(event) => setProfileId(event.target.value as EngineProfileId)}>
              {engineProfiles.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
            </select>
          </label>
          <label>Workload example
            <select aria-label="Workload example" value={preset} onChange={(event) => applyExample(event.target.value as PresetId)}>
              <option value="chat">chat</option><option value="coding-agent">coding-agent</option><option value="long-document">long-document</option><option value="rag">rag</option>
            </select>
          </label>
          <label>Prompt tokens per request
            <input aria-label="Prompt tokens per request" type="number" min="1" max={model.maxContext} step="1" value={promptTokens} onChange={(event) => setPromptTokens(Number(event.target.value))} />
          </label>
          <label>Maximum generated tokens
            <input aria-label="Maximum generated tokens" type="number" min="1" max={model.maxContext} step="1" value={maxGeneratedTokens} onChange={(event) => setMaxGeneratedTokens(Number(event.target.value))} />
          </label>
          <label>Concurrency
            <input aria-label="Concurrency" type="number" min="1" max="256" step="1" value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))} />
          </label>
          <label>Batch or micro-batch label (optional)
            <input aria-label="Batch or micro-batch label (optional)" type="text" value={batchLabel} onChange={(event) => setBatchLabel(event.target.value)} />
          </label>
        </div>
        <p className="serving-source"><a href={profile.sourceUrl} target="_blank" rel="noreferrer" aria-label={`${profile.label} source`}>{profile.label} source</a> · reviewed {profile.reviewedAt}</p>
        {result.error ? <p className="serving-status" role="status">{result.error}</p> : result.value && (
          <div className="serving-result" role="status">
            {!result.value.applicability.applicable || result.value.kind === 'unavailable' ? <p>{result.value.applicability.reason}</p> : (
              <dl>
                <div><dt>Decode resident lower bound</dt><dd>{formatGiB(result.value.components?.decodeResidentGiB ?? null)}</dd></div>
                <div><dt>Per-request KV</dt><dd>{formatGiB(result.value.components?.perRequestKvGiB ?? null)}</dd></div>
                <div><dt>Total concurrent KV</dt><dd>{formatGiB(result.value.components?.totalConcurrentKvGiB ?? null)}</dd></div>
              </dl>
            )}
            <p><strong>Prefill peak</strong> Not safely derivable from public model metadata.</p>
            <p><strong>Unknown factors</strong> {result.value.unknownFactors.join('; ')}.</p>
          </div>
        )}
      </details>
    </section>
  )
}
