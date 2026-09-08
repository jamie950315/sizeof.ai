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
- 2026-08-20: Estimated weight controls use neutral bit labels from 16bit through 1bit instead of GGUF-specific names. The existing effective-bit assumptions remain unchanged, with an explicit 1 bit/weight extreme-compression estimate added.
- 2026-08-20: Context controls now use 1024-token spinner boundaries, expose quick selections through 256K, and compare used memory with the selected VRAM capacity. The used bar keeps its weight/KV/runtime detail, leaves unused capacity grey, and applies a gradual orange warning tint from 80% usage upward.
- 2026-08-20: Hugging Face model detail calculators now use the same 1024-token context controls and full-VRAM memory chart as the home calculator, including gradual risk tinting above 80% usage.
- 2026-08-20: Context arrow controls now continue midpoint-aware dynamic context levels beyond 256K, so 256K increases through 384K to 512K and reversing direction returns to the matching neighboring level.
- 2026-08-20: Memory bars now keep the model weights, KV cache, and runtime buffer visually readable even when context usage dominates; the used region receives a full orange risk tint above 80%, unused VRAM remains grey, and over-capacity states show the offloaded GiB amount at the bar's top right.
- 2026-08-20: The over-capacity `OFFLOAD` label now uses the same 12px text size as the memory breakdown values.
- 2026-08-20: Memory-bar calculations normalize invalid or missing numeric inputs to finite values so shared chart helpers cannot emit `NaN%` widths or warning states.
- 2026-08-20: Memory weights retain the original acid-green base at safe usage; only the gradual orange risk overlay changes the bar and matching breakdown swatches as VRAM usage rises.
- 2026-08-20: Model weights now gain a dedicated progressive red tint only after VRAM capacity is exceeded, while safe usage retains the original acid-green color.
- 2026-08-21: Model-weight bars and their breakdown swatches now use the same warning and offload overlay stack, producing pixel-identical colors in safe and over-capacity states.
- 2026-08-22: Homepage examples now track current popular Hugging Face text-output models with only estimator-safe cache layouts. Qwen3.8-27B is the default demonstration as the current Base-only trending leader below 40B; hybrid and local/sliding cache exclusions are disclosed in the methodology.
- 2026-08-22: Frontier architecture support now separates MoE total and active parameters, identifies integrated and sidecar MTP, models DFlash/EAGLE draft pair static weights, and exposes full/sliding/linear/KDA/recurrent/SSM topology without presenting runtime-specific state as a safe fit estimate.
- 2026-08-22: Speculative target lookups use canonical Hugging Face ids and revision-locked artifact sizes, degrade safely to draft-only profiles, and remain excluded from ordinary community quantization discovery.
- 2026-08-22: Model API responses now use version-isolated Cloudflare Workers Caching with a 24-hour fresh window and seven-day stale refresh/error fallback. Browser caching remains five minutes, failed API responses are never cached, and the legacy per-data-center `hf-model-v24` Cache API layer has been removed.
- 2026-08-22: A free-plan Workers KV model cache now sits between Workers Caching and Hugging Face. Successful model responses are retained for 30 days, refreshed after 24 hours, and may serve as stale fallback for transient failures only until the response is eight days old; missing or private models never use stale data.
- 2026-08-22: Homepage Hugging Face search now submits only on Search or Enter/Return, prioritizes exact and official-author matches, supports author and model-type filters, and loads cursor-paginated results in 12-model batches with cross-page deduplication and re-sorting. The built-in Model Index remains independently visible.
- 2026-08-22: Hugging Face search and model-detail requests now authenticate with the `HF_TOKEN` Cloudflare secret. Public endpoints explicitly reject private top-level repositories and exclude private community, VAE-base, speculative-target, and quantized/adapter-base metadata from public estimates and caches.
- 2026-08-22: Homepage and Hugging Face model-detail calculators now default to 32 GiB VRAM while preserving all selectable VRAM capacities.
- Cloudflare production version: `39c0e2ac-1a85-4cc4-8978-7cd0b741382b` (deployed 2026-08-22).
- 2026-08-30: Frontend redesigned around a slogan-free search-first model explorer and a three-panel model workspace. The shared palette now uses graphite, steel, cool white, and cobalt; fit status remains green, while memory weights, KV cache, and runtime use cobalt, violet, and teal. Desktop, tablet, and mobile layouts preserve DOM reading order and avoid horizontal overflow.
- Cloudflare production version: `25edd26f-8409-42ad-9afc-ea300a21d669` (deployed 2026-08-30).
- 2026-08-30: Homepage model rows now update the selected calculator in place, while `SIZE IT` opens the matching model detail page in a new tab. Model detail facts, resource profile, artifacts, and architecture now share the redesigned panel system without legacy full-width sections.
- Cloudflare production version: `e91a536b-c318-432d-98dc-8484b52e19be` (deployed 2026-08-30).
- 2026-08-30: Model detail pages now use the selected three-panel tool layout: identity and published facts on the left, configuration with compact architecture key/value rows in the center, and the memory result on the right. The legacy lower-page architecture tile grid was removed, and short desktop viewports keep each panel independently scrollable.
- Cloudflare production version: `abf5f10c-b797-4971-a400-b597209fbca4` (deployed 2026-08-30).
- 2026-08-30: The model-detail configuration column now removes spacer-driven gaps and uses compact desktop controls so the full default Qwen3.8-27B configuration and architecture fit without scrolling at 1280x800. Detail-page VRAM choices now include 8, 12, 36, 96, 128, 192, 256, 384, and 512 GiB alongside the existing presets.
- Cloudflare production version: `f70d2b73-1661-4c3b-a83f-a33b082c47d8` (deployed 2026-08-30).
- 2026-08-30: Model-detail configuration spacing was relaxed to a middle-density rhythm after visual review: controls, section gaps, and architecture rows use more vertical space while the default Qwen3.8-27B view still fits without center-column scrolling at 1280x800.
- Cloudflare production version: `de0a98ce-49b3-4047-8dce-5fe0d93fc845` (deployed 2026-08-30).
- 2026-08-30: Community quantization source tabs and artifact buttons now use the redesigned graphite, steel, cool-white, and cobalt palette for idle, hover, selected, and size-label states; the legacy olive button colors were removed.
- Cloudflare production version: `7e7535b5-bc9f-4cc8-bfa4-f994fd7d03f9` (deployed 2026-08-30).
- 2026-08-30: Quantization source changes now animate the Estimated grid and community artifact tiers with a short staggered reveal. Memory-bar used, remaining, weight, KV, runtime, warning, and offload visuals transition smoothly when quantization or capacity changes, while `prefers-reduced-motion` disables all motion.
- Cloudflare production version: `3ee16a8b-47ce-496e-ba40-7c2166ef4749` (deployed 2026-08-30).
- 2026-08-30: Lower-bound model detail estimates now show the same device-fit status as ordinary estimates while retaining the lower-bound warning. The homepage selected-model result now includes the animated memory bar directly below total GiB without the detailed breakdown rows.
- Cloudflare production version: `fd5491ea-0fe7-4f32-9f35-a4fdb6e9f567` (deployed 2026-08-30).
- 2026-08-30: Short desktop and narrow mobile homepage layouts now compact only the calculator's vertical spacing so the animated memory bar remains visible directly below the total GiB without scrolling the sticky result column.
- Cloudflare production version: `eee51d69-eed7-48e8-9705-6dbbd89a11da` (deployed 2026-08-30).
- 2026-08-30: The homepage calculator now stretches to the exact height of the adjacent Model Index on desktop. Compact control and result spacing keeps the memory bar, configuration preset, Copy Link action, and estimate note visible without an inner scroll area at 1024–1505px desktop widths.
- Cloudflare production version: `6d8d533b-fa70-4f5e-8b9a-19ab6f294f79` (deployed 2026-08-30).
- 2026-08-30: Homepage calculator spacing was relaxed without breaking exact Model Index alignment. The shorter estimate disclaimer now sits at the bottom of the result panel with preserved padding, while all controls, the memory bar, configuration, and Copy Link remain visible without internal scrolling.
- Cloudflare production version: `a1d8b665-1115-4f4a-be20-fc154344c2e2` (deployed 2026-08-30).
- 2026-08-30: Homepage and model-detail calculators now share one VRAM capacity list. The homepage calculator and VRAM fit strip include workstation and multi-GPU capacities through 512 GiB, while the 32 GiB default remains unchanged.
- Cloudflare production version: `f92be8ce-1399-4318-b912-230a7ac1aa5b` (deployed 2026-08-30).
- 2026-08-30: The obsolete lime bracketed-S favicon was replaced with the selected cobalt VRAM-frame mark. Browser-tab assets now include dedicated 16px and 32px PNGs plus a 180px Apple touch icon, and the old SVG is no longer referenced by the page.
- Cloudflare production version: `3d4e767d-bdaa-4402-842b-f687ac5b4cfa` (deployed 2026-08-30).
- 2026-08-31: Six-phase planning preview deployed only to `https://testnet.sizeof.ai` as the isolated `sizeof-ai-testnet` Worker. It includes evidence-aware fit planning, local hardware profiles, 2–4 model comparison, exports/share/indexing, conservative engine serving scenarios, and the testnet API/CLI/Action/MCP ecosystem. Public API, badge/embed, robots/sitemap, desktop 1280×800, mobile 390×844, CLI, and MCP checks passed; production remained on its existing Worker version and API response.
- Cloudflare testnet version: `6ce49d13-e0c7-4502-a3e7-c40fd15cd23d` (deployed 2026-08-31).
- 2026-09-01: Testnet comparison UX now uses compact hover labels on homepage compare icons, accepts curated choices plus Hugging Face or sizeof.ai model URLs, restores top navigation, provides per-model quantization, context, and VRAM bars, removes card-order arrows, and uses a valid Qwen/Ornith recommendation. Muse-Glimmer-30B now retains revision-checked hybrid-attention facts through a versioned cache fallback and exposes a runtime-specific lower bound. Desktop 1280×800, mobile 390×844, public API, and production-isolation checks passed.
- Cloudflare testnet version: `e5fe9a24-dd40-4c95-b3c3-04739e917c66` (deployed 2026-09-01).
- 2026-09-03: Testnet Hugging Face lookups can rotate across multiple API keys. The four enterprise keys remain disabled behind `HF_ENTERPRISE_KEYS_ENABLED=false` and were not uploaded or called. Existing production `HF_TOKEN` was not changed. Desktop/API checks passed on testnet; production Worker version and homepage/API hashes were unchanged.
- Cloudflare testnet version: `8bc80fc9-2d61-4b01-ac0c-4186cbf3ee0a` (deployed 2026-09-03).
- 2026-09-03: Finance approved the four enterprise Hugging Face keys. They are stored only on `sizeof-ai-testnet`, `HF_ENTERPRISE_KEYS_ENABLED=true`, and live testnet search plus uncached model lookups succeeded. Direct key checks confirmed four distinct valid accounts. Production still uses only the original `HF_TOKEN` and was not deployed.
- Cloudflare testnet version: `8d5a89e9-f897-4ede-ad9b-94541dbdc964` (deployed 2026-09-03).
- 2026-09-03: Homepage Hugging Face search updates as you type. One-character queries are allowed, previous name/link result pages are cached in the browser session, and architecture/spec details still load from the existing model API. A full Hub name dump is not stored locally because the Hub has 2M+ models. Desktop typeahead on testnet and production isolation checks passed.
- Cloudflare testnet version: `ea6ce05b-47b3-4aa4-8ad5-64b8fca371ad` (deployed 2026-09-03).
- 2026-09-03: Testnet search races Osaka and San Jose name indexes and uses the first successful response, with Hugging Face as fallback. The public site stays on Cloudflare. Live testnet queries returned the Osaka index; San Jose is indexing in parallel. Production was unchanged.
- Cloudflare testnet version: `67f8a69f-635b-491d-b147-7447f97ff73e` (deployed 2026-09-03).
- 2026-09-05: Osaka and San Jose each store about 3.04 million public model names on disk (~875 MB). Search was slow because every query scanned the full list (3–5 s locally, which exceeded the Worker wait and fell back to Hugging Face). Prefix indexes now answer in milliseconds; testnet `Qwen`/`Q` queries return the Osaka index.
- 2026-09-05: Search edge-case tests cover one-character ranking, owner/name exactness, filters, pagination, empty indexes, token pooling, and Worker race/fallback. Full `owner/name` queries now match through the owner index as well as the name index. Osaka and San Jose search APIs were rebuilt; Cloudflare testnet Worker was not redeployed. Production homepage hash remained `c6900a49382143aede43fcdf74203f15ad073211232d0286afc1dbddb1d7ddeb`.
- 2026-09-05: Short prefixes no longer promote exact two- or three-character names over popular matches, and `owner/name` queries use the author list directly. Index refreshes now update top downloads, then ingest newly created Hugging Face models instead of stopping after the first 5,000 popular rows. Live testnet `Qw`/`Qwen/Qwen3` queries return Osaka in about 1 ms locally; Osaka ingested 1,166 new names on the first created-at pass.
- Cloudflare testnet version: `c42a50e5-4f44-4c60-a833-46ef6116a07f` (deployed 2026-09-05).
- 2026-09-05: Index backfill now walks Hugging Face downloads, createdAt, and lastModified lists to the end once, then keeps all later models by created time regardless of popularity. Osaka and San Jose indexers were rebuilt to start that backfill.
- 2026-09-08: Search-list reconciliation replaces independent crawlers with Osaka as the sole publisher and San Jose as a verified snapshot replica. Both APIs serve completed generations; `/health` exposes `generation`. Replica checks every minute and retains its previous data on errors. Publication, transfer, and memory reload cause a short convergence window, not simultaneous switching. Snapshot routes require the existing search bearer token. Use `services/search-index/compose.primary.yml` with profile `primary` on Osaka and `compose.replica.yml` with profile `replica` on San Jose; do not restart the old San Jose indexer. Current source is `https://ccsearch.0ruka.dev/__sizeof_index`; production Worker and testnet Worker code are unchanged.
- Network/page failures now retry with bounded backoff, then retry the crawl after five minutes; repeated cursors never count as completed backfills. Only successful crawls update the success timestamp or publish. The existing five-known-pages discovery cutoff is still heuristic: two matching replicas do not prove full live-Hub completeness or automatic removal of every deleted/private/renamed model. Pre-reconciliation database backups are retained on both VPS hosts under `/data/before-reconciliation-20260908.sqlite`.
- Verification covers 392 website tests, 52 search-index/snapshot tests, build/typecheck, authenticated replica downloads, unauthenticated snapshot rejection, and real primary-to-replica refreshes. Search tests use fresh Response objects per fetch and wait for asynchronous URL serialization to avoid false failures.

## Current review release (2026-09-08)

- Testnet Worker `9d76eb15-ff4b-43cf-a8d7-e60420b4599a` contains the comprehensive correctness/error-visibility review. Production is unchanged. Full findings and remaining boundaries are in `REVIEW.md`.
- Model KV namespace v4 rejects earlier partial-artifact results. Upstream bodies/deadlines/redirects are bounded; cross-origin artifact redirects strip credentials. Incomplete listings/shards and imatrix calibration data cannot produce full-model weight estimates. Configured index outages return explicit 503 rather than HF fallback; invalid requests fail before network/cache access.
- Interactive stale metadata is visibly labeled, no-store, and permitted only for transient upstream failures. Public estimate/badge/embed reject stale results. Invalid calculations are not relabeled as missing metadata. Runtime-specific models show lower bounds with no safe-fit claim; copied/saved/exported actions report actual failures.
- Osaka and San Jose run reviewed service code: one shared ranking order, incremental SQLite row loading, explicit reload/sync health, validated cursors and continuation links. Verified both served generation `fa0beb204b96a19a7fff5578d671ec93f2e39151375a7fbdfef87021dd9cb27f`, 3,054,836 models at review time. Existing old-model completeness limitations remain.
- Verification: 462 JS/TS tests and 61 Python tests, Node 24.10.0 build/typecheck, local Worker smoke, desktop/mobile browser search/detail/comparison and simulated failure feedback, live public API/CLI, and unchanged production homepage hash. Browser artifacts remain ignored under `output/playwright/`.

## Current platform release (2026-09-08)

- Testnet version `e155c3a2-5c4b-48cb-9fa1-824f479a6bda` adds `/start`, `/deploy`, `/hardware`, `/library`, `/docs` and shared navigation. Production remains unchanged. New workspaces are lazy-loaded; model-detail pages can seed a deployment or save a model.
- Deployment workbench generates reviewed local-only llama.cpp/MLX/vLLM templates with platform checks, validation, startup checklist, API probes, sharing and Markdown export. It does not execute commands or verify arbitrary runtime/model compatibility. Hardware worksheets cover dedicated/unified/multi-device reserves, storage/download time and user-priced electricity/API cost comparisons, not speed predictions.
- Model library is browser-local, capped at 200 models and 4 MB backups; notes/tags, comparison selection, export/merge, undo and corrupted-storage recovery are included. Never store credentials there. Imports merge against current stored data and preserve existing notes.
- Independent `sizeof-ai-docs` Worker version `e936a57a-3e3b-48d5-8ce1-e12e2255b142` serves `https://docs.sizeof.ai` using `wrangler.docs.jsonc`, with no HF credentials or model KV binding. Sixteen reviewed guides live in `src/docs/content.ts`; the same registry drives searchable UI, HTML without JavaScript, `.md` articles, sitemap and llms.txt. Mobile guide navigation collapses by default.
- Static resource exclusions are enabled only for testnet/docs (`run_worker_first` negative asset rules), preserving main production config. Platform/docs deployment commands are distinct; do not deploy production without explicit permission.
- Verified 552 JS/TS tests + 61 Python tests, Node 24 build/typecheck and both deployment dry-runs. Live checks include docs HTML/Markdown/404, search, deployment templates, model prefill, library reload, desktop/mobile layouts and unchanged production homepage hash. Runtime inference for generated runbooks is not tested on every target platform.

## Commands

- `npm run dev`: local Vite development server
- `npm test`: unit and component tests
- `npm run test:search-index`: VPS model-name index unit tests
- `npm run build`: production build
- `npm run deploy`: deploy the Worker and static assets
- `npm run deploy:testnet`: deploy the isolated `sizeof-ai-testnet` Worker to `testnet.sizeof.ai`
- `npm run deploy:docs`: build and deploy the isolated documentation Worker to `docs.sizeof.ai`
- `npm run cf:check:docs`: documentation deployment dry-run
- `npx wrangler dev --port 8790`: run the complete Worker, API, and static site locally when 8787 is occupied by Executor

## Working Agreements

- Keep README.md in English.
- Treat VRAM values as estimates and expose assumptions and formulas.
- Cite primary model sources in catalog data.
- Never commit Cloudflare credentials or local Wrangler state.
- After every website feature or fix, deploy the current changes to Cloudflare production and verify the public domains and visible production page; a commit or push alone is not completion. Record the deployed Cloudflare version in this file.
- The current six-phase stream deploys only to `testnet.sizeof.ai` until production is explicitly approved.
- Hugging Face requests rotate across the active API key pool. Enterprise keys are enabled on testnet only (`HF_ENTERPRISE_KEYS_ENABLED=true` plus `HF_TOKEN_ENTERPRISE_1` through `HF_TOKEN_ENTERPRISE_4`). Do not copy those secrets to production or enable the flag there without explicit approval.
- Run tests, build, and a real local smoke test before declaring completion.
