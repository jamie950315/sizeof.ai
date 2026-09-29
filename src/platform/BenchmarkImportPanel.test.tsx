import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import BenchmarkImportPanel from './BenchmarkImportPanel'
import { readBenchmarks } from './benchmark'
beforeEach(() => localStorage.clear())
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const json = JSON.stringify([{ n_prompt: 0, n_gen: 128, n_depth: 0, samples_ns: [2_000_000_000] }])
async function upload(body = json) {
  fireEvent.change(screen.getByLabelText('Benchmark tool JSON'), { target: { files: [{ size: body.length, text: async () => body }] } })
  await waitFor(() => expect(screen.queryByText('Reading local result…')).not.toBeInTheDocument())
}
function setup() {
  for (const [label, value] of [['Imported model ID', 'owner/model'], ['Imported hardware / driver / OS', 'GPU'], ['Imported quantization / exact file', 'model.gguf'], ['Imported context capacity', '4096'], ['Imported concurrency', '1'], ['Imported load state', 'warm'], ['Imported workload / settings', 'synthetic workload'], ['Measurement date (ISO 8601 with timezone)', '2026-09-08T00:00:00Z']]) fireEvent.change(screen.getByLabelText(label), { target: { value } })
}
it('previews without saving, requires setup/confirmation, then preserves unknowns', async () => {
  const saved = vi.fn(); render(<BenchmarkImportPanel disabled={false} onSaved={saved} />); fireEvent.click(screen.getByText('Import benchmark tool results'))
  await upload(); expect(readBenchmarks()).toEqual([]); expect(screen.getByText(/1 observations · 0 reported/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Import confirmed observations' })).toBeDisabled()
  setup(); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Import confirmed observations' }))
  expect(saved).toHaveBeenCalledOnce(); expect(readBenchmarks()[0]).toMatchObject({ runtime: 'llama-bench', ttftMs: null, totalSeconds: null, runtimeVersion: '' })
  expect(screen.getByRole('status')).toHaveTextContent('merged locally')
})
it('rejects aggregate and oversize results without storing data', async () => {
  render(<BenchmarkImportPanel disabled={false} onSaved={vi.fn()} />); fireEvent.click(screen.getByText('Import benchmark tool results'))
  await upload('{"mean_ttft_ms":20}'); expect(screen.getByRole('alert')).toHaveTextContent('aggregate-only'); expect(readBenchmarks()).toEqual([])
  fireEvent.change(screen.getByLabelText('Benchmark tool JSON'), { target: { files: [{ size: 3_000_000, text: vi.fn() }] } })
  expect(screen.getByRole('alert')).toHaveTextContent('2 MB')
})
it('shows storage failures and keeps preview for recovery', async () => {
  render(<BenchmarkImportPanel disabled={false} onSaved={vi.fn()} />); fireEvent.click(screen.getByText('Import benchmark tool results')); await upload(); setup()
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded') })
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Import confirmed observations' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Quota exceeded'); expect(readBenchmarks()).toEqual([])
  expect(screen.getByLabelText('Imported model ID')).toHaveValue('owner/model')
})
it('changes to setup require renewed confirmation', async () => {
  render(<BenchmarkImportPanel disabled={false} onSaved={vi.fn()} />); fireEvent.click(screen.getByText('Import benchmark tool results')); await upload(); setup(); fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.change(screen.getByLabelText('Imported workload / settings'), { target: { value: 'changed' } })
  expect(screen.getByRole('button', { name: 'Import confirmed observations' })).toBeDisabled()
})
