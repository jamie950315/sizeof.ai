# sizeof.ai

sizeof.ai is a fast reference tool for estimating the VRAM required to run large language models at different weight quantizations, context sizes, and KV-cache precisions. It also recommends the strongest catalog models that fit a selected VRAM budget.

## Testnet review status

The current roadmap and review fixes are deployed only to `testnet.sizeof.ai`; production is unchanged. Model cache namespace v5 requires current artifact manifests. Configured search indexes fail explicitly instead of silently switching to Hugging Face. Validated stale model metadata is labeled on interactive pages only after transient upstream failure; malformed data never uses stale fallback, and public estimates/badges/embeds reject stale metadata with 503.

Model listing reads are bounded and reject incomplete pagination. Incomplete weight shards and importance-matrix calibration files are not offered as complete model weights. Runtime-specific lower bounds never claim a verified fit. Copy/export/storage failures are visible rather than reported as success. See [REVIEW.md](REVIEW.md) for review coverage and validation boundaries.

## Features

### Local deployment platform (testnet)

- `/start`: beginner and advanced entry paths with shared navigation across the platform.
- `/deploy`: reviewed llama.cpp, MLX LM and vLLM command templates; OS/hardware compatibility checks, safe local-only endpoints, startup checklist, API smoke requests, share links and Markdown runbooks. These commands are not executed by the site and are not a promise that a given model/engine/device combination works.
- `/hardware`: dedicated/unified/multi-GPU memory budgets, disk and download worksheets, and user-priced electricity/API break-even comparisons. No invented throughput or live pricing claims.
- `/library`: up to 200 saved model names with tags/notes, selection for comparison, import/export, removal undo and corrupt-storage recovery. Browser-local only; never store API keys in notes. Backups are bounded to 4 MB.
- `/docs`: searchable 17-guide knowledge base, experience filters, article navigation and original sources. Also independently hosted at `https://docs.sizeof.ai`, where articles render without JavaScript and provide `.md`, `/llms.txt`, and `/sitemap.xml` endpoints.

Workspaces and docs are loaded on demand. Static assets bypass the application Worker on testnet and docs. The docs Worker has no Hugging Face secrets or model-cache binding. Model-detail pages link directly to deployment planning and saving a shortlist.

### Deployment follow-through

- The deployment workbench queries the existing model metadata API on demand to pick a published GGUF, including its actual community repository, paths, sizes and observed revision. Complete shard groups expose every filename and their total size; incomplete groups are rejected. This is metadata validation, not a weight download or runtime compatibility test.
- `/runs` stores up to 100 browser-local deployment snapshots with 2 MB backup limits, observed artifact facts, user-entered runtime/hardware details, and planned/succeeded/failed outcomes. Outcomes are user reports. Select two records to inspect exact configuration, artifact and user-report differences; differences do not establish performance improvement. Reopening preserves a requested model commit but regenerates current command templates. Changes to launch settings reset unsaved record fields.
- `/troubleshoot` provides 6 failure stages and 12 symptom paths with evidence checks, possible causes, safe next steps and stopping conditions. Private notes exist only in page memory and are excluded from links, copied checklists and exports. No diagnostic input is uploaded or executed.
- Documentation includes a labeled AI-generated generic workstation illustration and a manually checked memory-pool diagram. Full image paths and the built-in generation prompt are recorded in `src/docs/IMAGE-SOURCES.md`. Neither image is a hardware specification or performance measurement.

### Reproducible model downloads and measured observations

- A full 40-character model commit enables a separate `hf download --revision ... --local-dir ...` step. The engine then opens that local file/directory. Repository and revision get separate portable directories. Pinned GGUF supports one file or a validated complete shard group; the launch command opens the first shard. MLX/vLLM downloads the full repository at that revision. Runtime, dependency, driver and hardware versions are **not** pinned or installed by the site. Stop if download fails; never silently replace the commit.
- Pinned single-file plan URLs use `v=2`; complete shard plans use `v=3`; legacy unpinned links remain `v=1`. Shard plans require a fixed revision, at most 64 files, a manifest within 6,000 characters and a URL within 8,192 characters. Earlier URL versions reject shard fields. Deployment backups write version 3 and read valid legacy versions 1 and 2; old clients reject newer backups instead of stripping evidence.
- `/benchmarks` is a browser-local measurement notebook, not a benchmark runner. It stores up to 200 observations within 2 MB, supports JSON import/export and optional setup prefill from a local run. Only a requested pinned revision is prefilled; observed metadata alone is not treated as a measured model version.
- Record the actual prompt token count, matching decode token/time interval, TTFT, total time and peak memory; blank values remain unknown. Groups require matching recorded setup/load state/workload and prompt count. Missing model revision, runtime version or prompt count isolates a sample. Failure rows contribute to error rate but not successful speed/latency medians. No percentile or independently verified performance claim is made. `loadState` replaces the earlier ambiguous cold/warm `temperature` field; legacy backups remain readable.
- Comparison exports include private notes and error summaries, and measurement backups include workload/hardware labels. Review them before sharing. No measurements or record contents are uploaded.

### Evidence and planning tools

- `/status` and `GET /api/status`: bounded, privacy-safe region health, model-name counts, generation alignment, sync freshness and backfill evidence. Matching copies are not proof of complete Hub coverage. Historical backfill completion dates remain unknown unless recorded. San Jose now uses its dedicated Cloudflare Tunnel at `sizeof-search-us.0ruka.dev`; testnet no longer depends on the unreliable Tailscale Funnel public route.
- `/compatibility`: separate documented, unsupported and unknown evidence for operating systems, backends, formats and model families, with primary sources and review dates. Family evidence is not a guarantee for an arbitrary model.
- `/context`: allocate system, history, user, documents, tools, overhead and reserved output token counts against a context limit. Share/export validated budgets; no guessed character-to-token conversion or uploaded prompt text.
- `/model-changes` and `GET /api/model-changes?model=owner/repo&before=40hex&after=40hex`: compare immutable public model revisions (after defaults to current), complete file manifests, selected configuration facts and declared licenses. Bounds are 1,000 files and 1 MB per upstream JSON; incomplete results fail explicitly. Blob identifiers are compared when available; unknown content stays unknown. This is not a full legal-text or behavior comparison.
- `/benchmarks` can preview and explicitly confirm local tool JSON imports (2 MB/200 rows). vLLM requires detailed per-request arrays with coherent completion counts; llama-bench requires a single generation-only configuration with explicit `n_prompt=0`, `n_depth=0` and raw `samples_ns`. Aggregate-only reports are rejected. Unit conversions preserve measurement scope, and no HTTP latency or memory is invented. Imported response text, error bodies and file paths are not retained. UI validation uses labeled synthetic fixtures, not claimed hardware benchmarks.

- VRAM calculator with separate weight, KV-cache, and runtime estimates
- Eight weight-precision estimates from 16 bits through 1 bit per weight
- Configurable context window and KV-cache precision
- Shareable calculator state in the URL
- Shared VRAM capacities from 8–512 GiB, with safe-fit recommendations only where justified
- Searchable, source-linked model catalog
- Dynamic Hugging Face model detail pages by replacing `huggingface.co` with `sizeof.ai`
- Engine-aware MLA cache estimates with expanded-reference and compressed-latent modes
- Responsive, accessible interface with no account or tracking requirement

## Hugging Face URL shortcut

Any public Hugging Face model URL with an owner and repository path can be opened on sizeof.ai by replacing the domain:

```text
https://huggingface.co/Qwen/Qwen3.8-27B
https://sizeof.ai/Qwen/Qwen3.8-27B
```

The Worker reads public Hugging Face metadata plus the model's revision-locked `config.json`, normalizes common and nested text architectures, and caches the result at the Cloudflare edge. GGUF repositories use the Hub's logical parameter metadata; when a full quantized repository lacks a usable config, sizeof.ai may inherit a revision-locked config from its explicit `base_model:quantized` relationship. Adapter and LoRA repositories never use this fallback. Models without enough machine-readable architecture data still receive a metadata page, but no VRAM estimate is shown.

## Estimation model

Weight memory uses the model parameter count and an approximate effective bits-per-weight value for each GGUF quantization. KV-cache memory is calculated for batch size one from:

```text
layers × KV heads × head dimension × 2 (K and V) × context × bytes per cache value
```

For MLA models, cache memory depends on the inference engine. The model detail page exposes both the repository-style expanded K/V layout and the optimized compressed-latent layout instead of presenting one engine-dependent value as universal. Published facts such as context length and layer count remain visible even when the repository does not expose enough data for an estimate. Repository-native quantization is labeled separately; GGUF choices remain hypothetical sizing scenarios.

The total adds 10% of weights plus KV cache as workspace and a fixed 0.5 GiB runtime allowance. Results are planning estimates, not guarantees: inference engine, GPU offload, batch size, flash attention, multimodal projectors, and driver allocations can change real usage.

## Testnet preview

The public ecosystem interfaces below are a testnet preview at `https://testnet.sizeof.ai`. Their schemas and commands may change before a stable release. They require no account, credential, or telemetry setup, and every result retains its evidence and estimate disclaimer.

### Public API

`GET /api/v1/estimate` returns the versioned `sizeof-estimate/v1` schema. The model is required; all other inputs are bounded and optional.

```bash
curl 'https://testnet.sizeof.ai/api/v1/estimate?model=Qwen%2FQwen3.8-27B&quant=q4_k_m&context=8192&kv=q8_0&vram=32'
```

The response includes canonical model facts, the selected configuration and capacity, an estimate/lower-bound/unavailable state, fit and inverse-planner results when safe, provenance, evidence, a reproducible detail URL, and the disclaimer. Add `engine=vllm&prompt=2048&generated=256&concurrency=4` to request a conservative serving scenario. The API never treats a serving result as a benchmark.

### CLI

The checked-in CLI uses only Node.js built-ins and defaults to the testnet API:

```bash
node ./cli/sizeof.mjs Qwen/Qwen3.8-27B --quant q4_k_m --context 8192 --kv q8_0 --vram 32
node ./cli/sizeof.mjs Qwen/Qwen3.8-27B --json
```

Use `SIZEOF_API_BASE` or `--base-url` for a trusted local/test endpoint. The explicit flag takes precedence. Non-success responses return a non-zero exit status without printing arbitrary upstream bodies.

### GitHub Action

The repository includes a composite Action that runs the checked-in CLI, writes a concise Step Summary, and exposes `status` and `total` outputs:

```yaml
- id: memory
  uses: your-org/sizeof.ai@your-pinned-ref
  with:
    model: Qwen/Qwen3.8-27B
    quant: q4_k_m
    context: '8192'
    vram: '32'
```

Pin a reviewed commit while this interface remains a preview.

### Badge and embed

The badge is a bounded, script-free SVG generated from the same estimate core:

```text
https://testnet.sizeof.ai/badge/v1/estimate.svg?model=Qwen%2FQwen3.8-27B&vram=32
```

The accessible static card has no script and links to the reproducible detail page:

```html
<iframe title="Qwen memory estimate" src="https://testnet.sizeof.ai/embed/v1/estimate?model=Qwen%2FQwen3.8-27B&amp;vram=32"></iframe>
```

### MCP

The stdio MCP server exposes `estimate`, `compare` (two to four models), and `find_fit`. Its network destination is process configuration only; individual tool calls cannot choose a URL.

```json
{
  "mcpServers": {
    "sizeof-testnet": {
      "command": "node",
      "args": ["/absolute/path/to/sizeof.ai/mcp/server.mjs"],
      "env": { "SIZEOF_API_BASE": "https://testnet.sizeof.ai" }
    }
  }
}
```

The server performs no filesystem writes, shell execution, credential handling, or telemetry.

## Development

Node.js 24 or later is recommended.

```bash
nvm use
npm install
npm run dev
```

Quality checks:

```bash
npm test
npm run typecheck
npm run build
npm run cf:check
```

## Cloudflare deployment

Current platform work stays on testnet. Deploy documentation independently; do not use the production command without explicit approval:

```bash
npm run deploy:testnet
npm run deploy:docs
```

`wrangler.docs.jsonc` owns only `docs.sizeof.ai`. The documentation source is in `src/docs/content.ts`. Add a guide there with unique section IDs, related guides, reviewed primary sources, and explicit limits; route metadata and machine-readable versions use the same registry.

The site deploys as a Cloudflare Worker with Static Assets. The Worker serves a same-origin model metadata API for dynamic Hugging Face detail pages. The Wrangler configuration includes the `sizeof.ai` and `www.sizeof.ai` custom domains, so no Pi or separate origin server is required.

```bash
npx wrangler login
npm run deploy
```

Cloudflare creates and manages the required proxied DNS records when the custom domains are attached. Do not add an AAAA or CNAME record to a separate origin.

## Model data

Model architecture data lives in `src/data/models.ts`. Each entry links to its primary Hugging Face model page. Keep parameter count, layer count, KV-head count, head dimension, and native context synchronized when adding or updating a model.

## License

No license has been selected yet.
