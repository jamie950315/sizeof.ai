# Project review — 2026-09-08

## Scope and method

Reviewed the Worker/API/cache/credential boundary, Hugging Face metadata and artifact parsing, React search/detail/comparison flows and local state, estimator/planner/resource evidence, exports/CLI/Action/MCP, and the dual-region Python index/snapshot services. Independent reviewers owned separate areas; integration included regression tests, local Workers execution, live testnet requests, browser interaction, VPS health/logs, and production isolation checks. This is a point-in-time review, not a proof that no undiscovered defects remain.

## Corrected findings

- Partial tree pagination and malformed responses could silently become incomplete artifact totals. They now fail explicitly; optional 404/private metadata remains distinct from upstream outages.
- Individual incomplete shards and calibration `imatrix.gguf` files could be offered as complete models. They are excluded. Nested variant groups and case-sensitive file identities remain distinct.
- Unbounded/chunked upstream bodies could exhaust memory despite a missing or misleading Content-Length. Reads are bounded and canceled on overflow; requests have deadlines.
- Request-object headers could be overwritten when adding HF credentials. Headers are preserved, credentials are restricted to HTTPS on the HF origin, and cross-origin signed-CDN redirects strip credentials.
- Invalid numeric geometry, artifact sizes, and nonfinite fit values could produce invalid or false-safe estimates. Invalid data is rejected. Fixed-size artifacts no longer appear to support arbitrary inverse precision changes.
- Partial-attention curated models were offered as safe fits. They are lower bounds, excluded from safe recommendations, with no public API fit claim.
- Old search responses could race newer text; malformed 200 responses could look like no matches. Requests are canceled and validated, and errors are displayed with bounded service details.
- Copy, export, and hardware-save failures could claim success. Feedback now reflects actual outcomes; missing comparison artifacts cannot silently use estimated weights.
- Manual 5000-token detail URLs could reset to 8192. Supported integer contexts round-trip, and controls respect the existing 16M limit.
- Search synchronization failures were invisible in health; malformed continuation links could count as crawl completion. Health exposes degradation while retaining the last working snapshot; malformed links fail.
- Index builds repeatedly sorted overlapping buckets and held an extra SQLite row list. One ordering is reused and rows are consumed incrementally. A synthetic 100k-model benchmark measured 0.347s before vs 0.178s after; this is not a claimed global latency improvement.
- CLI/MCP now validate successful response identity/state and share the existing Action validator. CLI output is terminal-safe and help is available without network calls.

## Simplifications

Removed unused/conflicting search ranking paths and unused crawl stopping options; unified model-response loading and UI clipboard behavior; reused response validation; replaced per-layer allocation/iteration with arithmetic counting. No framework migration or speculative dependency additions.

## Verification and boundaries

- TypeScript/UI/Worker/CLI/MCP tests, Python service tests, production build/typecheck, and testnet deployment dry-run.
- Live search, model metadata, public estimate, browser desktop/mobile flows, CLI requests, snapshot convergence and degraded/recovered health.
- Production homepage remains unchanged. Production was not deployed.
- Two replicas agreeing does not prove a complete live Hugging Face catalog: the existing five-known-pages discovery cutoff remains heuristic, and periodic full deletion/rename reconciliation is not implemented.
- Regional search retains the existing public ingress configuration. The San Jose public-hostname improvement previously deferred by the user is not included.
- A blocked third-party Cloudflare analytics beacon in the test browser is environmental and not an application exception.
