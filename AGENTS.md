# sizeof.ai Project Notes

## Product

sizeof.ai is a fast, public reference tool for estimating LLM memory requirements across quantizations and context sizes, and for finding models that fit a given VRAM budget.

## Architecture

- React + TypeScript + Vite
- Cloudflare Worker with Static Assets
- Model metadata is versioned in the repository; no database or login in v1
- Calculator logic stays framework-independent and has unit tests

## Current Status

- 2026-08-18: Initial calculator, URL sharing, VRAM recommendations, catalog, methodology, responsive UI, and Cloudflare configuration implemented.
- 2026-08-18: Production deployment is live on `https://sizeof.ai` and `https://www.sizeof.ai` through Cloudflare Workers Static Assets.
- Cloudflare production version: `50728c51-2535-4780-a717-c81570900860`.
- Browser QA covers 1280px desktop and 390px mobile; local artifacts remain ignored under `output/playwright/`.
- 2026-08-18: Hugging Face-compatible `/{owner}/{repo}` detail routes implemented with a revision-locked public metadata API, hybrid-attention-aware VRAM estimates, edge caching, and private/not-found normalization. Production deployment pending final verification.
- 2026-08-18: MLA and KDA hybrid configs now preserve published facts and expose explicit expanded-versus-latent cache modes; Kimi-K3 regression coverage added. Production deployment pending final verification.

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
