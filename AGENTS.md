# sizeof.ai Project Notes

## Product

sizeof.ai is a fast, public reference tool for estimating LLM memory requirements across quantizations and context sizes, and for finding models that fit a given VRAM budget.

## Architecture

- React + TypeScript + Vite
- Cloudflare Worker with Static Assets
- Curated catalog data and gated-model fallbacks are versioned in the repository; public Hugging Face model metadata is fetched live
- Calculator logic stays framework-independent and has unit tests

## Current Status

- 2026-08-18: Initial calculator, URL sharing, VRAM recommendations, catalog, methodology, responsive UI, and Cloudflare configuration implemented.
- 2026-08-18: Production deployment is live on `https://sizeof.ai` and `https://www.sizeof.ai` through Cloudflare Workers Static Assets.
- Cloudflare production version: `a25b5660-4c07-487c-9925-7628626653a4`.
- Browser QA covers 1280px desktop and 390px mobile; local artifacts remain ignored under `output/playwright/`.
- 2026-08-18: Hugging Face-compatible `/{owner}/{repo}` detail routes are live with a revision-locked public metadata API, hybrid-attention-aware VRAM estimates, edge caching, and private/not-found normalization.
- 2026-08-18: MLA and KDA hybrid configs now preserve published facts and expose explicit expanded-versus-latent cache modes; Kimi-K3 regression coverage and production browser verification passed.
- 2026-08-18: Hugging Face trending Top 100 production audit completed: all 100 API lookups returned 200 with matching ids. Safe VRAM estimates improved from 38 to 63; metadata-only results fell from 62 to 37. Of 27 repository names containing GGUF, 23 now have safe estimates. GGUF base-config inheritance is revision-locked and parameter-count-gated; sidecar, MTP, LoRA, PEFT, and adapter artifacts remain metadata-only when a full-model estimate cannot be trusted.
- 2026-08-19: Model detail pages now expose modality-aware resource profiles for language, vision-language, image, video, audio, embedding/retrieval, adapter, workflow, and other repositories. Published tensor footprint and total repository storage are shown independently from runtime estimates.
- 2026-08-19: Hugging Face trending ranks 101–200 production audit completed: 100/100 API lookups returned 200 with matching ids. The final safety pass produced 51 trusted LLM estimates and 49 metadata-only profiles; it added four trustworthy estimates while withdrawing five unsafe estimates from the pre-fix 52/48 baseline.
- 2026-08-19: Packed quantized safetensors use revision-locked logical base parameters only when a machine-readable base relation, SHA, bounded chain, compatible lineage, and parameter ratio all pass. Encoder/retrieval and modality-specific models never use the autoregressive KV-cache formula. Gated Llama 3.1 8B uses a versioned curated architecture fallback; ambiguous multi-variant, sidecar, custom-format, and unverified-base repositories remain metadata-only.

## Commands

- `npm run dev`: local Vite development server
- `npm test`: unit and component tests
- `npm run build`: production build
- `npm run deploy`: deploy the Worker and static assets
- `npx wrangler dev --port 8790`: run the complete Worker, API, and static site locally when 8787 is occupied by Executor

## Working Agreements

- Keep README.md in English.
- Treat VRAM values as estimates and expose assumptions and formulas.
- Cite primary model sources in catalog data.
- Never commit Cloudflare credentials or local Wrangler state.
- Run tests, build, and a real local smoke test before declaring completion.
