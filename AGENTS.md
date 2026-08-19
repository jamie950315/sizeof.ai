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
- Cloudflare production version: `1900429f-6b77-47d5-a9f8-f7cfc86ea337`.
- Browser QA covers 1280px desktop and 390px mobile; local artifacts remain ignored under `output/playwright/`.
- 2026-08-18: Hugging Face-compatible `/{owner}/{repo}` detail routes are live with a revision-locked public metadata API, hybrid-attention-aware VRAM estimates, edge caching, and private/not-found normalization.
- 2026-08-18: MLA and KDA hybrid configs now preserve published facts and expose explicit expanded-versus-latent cache modes; Kimi-K3 regression coverage and production browser verification passed.
- 2026-08-18: Hugging Face trending Top 100 production audit completed: all 100 API lookups returned 200 with matching ids. Safe VRAM estimates improved from 38 to 63; metadata-only results fell from 62 to 37. Of 27 repository names containing GGUF, 23 now have safe estimates. GGUF base-config inheritance is revision-locked and parameter-count-gated; sidecar, MTP, LoRA, PEFT, and adapter artifacts remain metadata-only when a full-model estimate cannot be trusted.
- 2026-08-19: Model detail pages now expose modality-aware resource profiles for language, vision-language, image, video, audio, embedding/retrieval, adapter, workflow, and other repositories. Published tensor footprint and total repository storage are shown independently from runtime estimates.
- 2026-08-19: Hugging Face trending ranks 101–200 audit rerun completed against the live integration: 100/100 lookups succeeded, 61 expose safe VRAM estimates, 39 remain metadata-only, and 50 expose detected repository variants. Metadata-only reasons were 28 modality-specific, 3 missing-parameters, 3 adapter-only, 3 workflow-artifact, and 2 encoder-model.
- 2026-08-19: Multi-artifact repositories now expose selectable GGUF, MLX, EXL2/EXL3, NInfer, and packed safetensors variants using revision-locked file sizes. Sharded GGUF files are grouped, built-in MTP variants are labeled, and projectors remain support artifacts.
- 2026-08-19: Declared metadata lineage takes precedence over repository naming. Directory artifact manifests and NInfer manifests can supply base relationships; repositories without a declared base are treated as self-contained when their own config or bounded GGUF metadata supplies safe architecture facts. True MTP sidecars are modeled as base weights plus addon weights.
- 2026-08-20: Non-text-generation pages now use static published-weight profiles rather than LLM KV-cache calculations. Vision, video, audio, VAE, and encoder pages hide autoregressive context and KV fields; unknown workflows ask for artifact identification instead of inventing a VRAM figure.
- 2026-08-20: VAE profiles combine a declared, verified base plus VAE weights when available (including canonical-ID casing differences), otherwise report the VAE artifact alone. Kijai/MiniMax-H3-TAE, Wan-AI/Wan2.2-Animate-2-14B, Inner-Reflections/MiniMax-H3-Looping-Sketch-Anime, LiquidAI/LFM2.5-Encoder-350M, and workflow artifacts were verified locally and on the public API.
- 2026-08-20: Base-model pages now prefer verified quantizations from trusted community publishers, led by unsloth, and use published artifact sizes. Pages explicitly distinguish community artifacts from hypothetical bit-per-weight fallback estimates.
- 2026-08-20: Community quantizations are integrated into the original Memory profile button grid instead of a separate artifact section, so quantization, context, KV precision, and VRAM remain adjustable together.
- 2026-08-20: Community artifact selection now uses a Hugging Face-style bit-grouped chip browser inside Memory profile, exposing every detected full-model quantization and its published GiB size while preserving context controls.
- 2026-08-20: Memory profile now defaults to the original hypothetical bit-per-weight estimate and offers publisher tabs for verified community artifacts. Unsloth, bartowski, and mlx-community variants remain separated by source; MLX precision and OptiQ labels are derived from their declared repository names.
- 2026-08-20: Community source tabs are capped at four and ordered by current ecosystem priority: Unsloth, LM Studio Community, mlx-community, then Bartowski. Other legacy quantization publishers are no longer discovered as source tabs.
- Cloudflare production version: `091450d1-d55e-467c-a3a5-15b68e2c1dc1`.

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
