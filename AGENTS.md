# sizeof.ai Project Notes

## Product

sizeof.ai is a fast, public reference tool for estimating LLM memory requirements across quantizations and context sizes, and for finding models that fit a given VRAM budget.

## Architecture

- React + TypeScript + Vite
- Cloudflare Worker with Static Assets
- Model metadata is versioned in the repository; no database or login in v1
- Calculator logic stays framework-independent and has unit tests

## Current Status

- 2026-08-18: Architecture approved. Initial implementation in progress.

## Commands

- `npm run dev`: local Vite development server
- `npm test`: unit and component tests
- `npm run build`: production build
- `npm run deploy`: deploy the Worker and static assets

## Working Agreements

- Keep README.md in English.
- Treat VRAM values as estimates and expose assumptions and formulas.
- Cite primary model sources in catalog data.
- Never commit Cloudflare credentials or local Wrangler state.
- Run tests, build, and a real local smoke test before declaring completion.
