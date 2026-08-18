# sizeof.ai

sizeof.ai is a fast reference tool for estimating the VRAM required to run large language models at different weight quantizations, context sizes, and KV-cache precisions. It also recommends the strongest catalog models that fit a selected VRAM budget.

## Features

- VRAM calculator with separate weight, KV-cache, and runtime estimates
- Seven common GGUF weight quantizations from FP16 to Q2_K
- Configurable context window and KV-cache precision
- Shareable calculator state in the URL
- Model recommendations for 8–80 GiB VRAM budgets
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

The Worker reads public Hugging Face metadata plus the model's revision-locked `config.json`, normalizes common and nested text architectures, and caches the result at the Cloudflare edge. Models without enough machine-readable architecture data still receive a metadata page, but no VRAM estimate is shown.

## Estimation model

Weight memory uses the model parameter count and an approximate effective bits-per-weight value for each GGUF quantization. KV-cache memory is calculated for batch size one from:

```text
layers × KV heads × head dimension × 2 (K and V) × context × bytes per cache value
```

For MLA models, cache memory depends on the inference engine. The model detail page exposes both the repository-style expanded K/V layout and the optimized compressed-latent layout instead of presenting one engine-dependent value as universal. Published facts such as context length and layer count remain visible even when the repository does not expose enough data for an estimate. Repository-native quantization is labeled separately; GGUF choices remain hypothetical sizing scenarios.

The total adds 10% of weights plus KV cache as workspace and a fixed 0.5 GiB runtime allowance. Results are planning estimates, not guarantees: inference engine, GPU offload, batch size, flash attention, multimodal projectors, and driver allocations can change real usage.

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
