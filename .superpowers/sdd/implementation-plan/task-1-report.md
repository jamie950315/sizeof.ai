# Task 1 Report — Isolated Testnet Deployment Contract

## Result

- Testnet Worker environment: `sizeof-ai-testnet`
- Testnet custom domain: `testnet.sizeof.ai` only
- Worker environment marker: `ENVIRONMENT: "testnet"`
- Isolated KV binding: `MODEL_CACHE`
- Testnet KV namespace ID: `0a07ede1f0744dd696857d5bea6d2441`
- Production KV namespace ID intentionally not reused: `64daa9eb377a4098969912297dbecbef`
- Implementation commit: `0501644` (`chore: add isolated testnet Worker configuration`)

## Red Evidence

Created `src/testnet-config.test.ts` before configuration changes, then ran:

```text
rtk npm test -- src/testnet-config.test.ts
```

The focused test failed as intended because `config.env?.testnet` was `undefined` and therefore could not match the required isolated Worker configuration.

## Changes

- Added `env.testnet` to `wrangler.jsonc` with a distinct Worker name, testnet-only custom domain, explicit environment marker, isolated `MODEL_CACHE`, and repeated static-assets binding.
- Added `cf:check:testnet` and build-first `deploy:testnet` scripts; both specify `--env testnet`.
- Kept top-level production routes and the existing `deploy` script unchanged.
- Generated `worker-configuration.d.ts` with `wrangler types --env testnet`, including `ENVIRONMENT: "testnet"`.
- Added a configuration regression test that reads the config/package text and verifies route isolation, cache-ID separation, environment marker, and scripts.

## KV Namespace

Created with:

```text
rtk npx wrangler kv namespace create sizeof-ai-testnet-model-cache --env testnet
```

Wrangler created the remote namespace titled `testnet-sizeof-ai-testnet-model-cache` and returned ID `0a07ede1f0744dd696857d5bea6d2441`.

## Verification

| Command | Result |
| --- | --- |
| `rtk npm test -- src/testnet-config.test.ts` | RED: failed because testnet configuration was absent. |
| `rtk npx wrangler types --env testnet` | Generated the Worker types with the testnet marker. |
| `rtk npm test -- src/testnet-config.test.ts` | GREEN: 1 test file and 1 test passed. |
| `rtk npm run typecheck` | Passed. |
| `rtk npm run build` | Passed; Vite built 1,807 modules. |
| `rtk npm run cf:check:testnet` | Passed dry-run; only testnet KV, assets, and marker were bound. |
| `rtk git diff --check` | Passed with no whitespace errors. |
| `rtk npx wrangler types --env testnet --check` | Passed; generated types are current. |

## Concerns

- No Worker deployment was run, by design. Task 8 must deploy only through `npm run deploy:testnet` and record the resulting testnet version.
- Pre-existing dirty redesign and favicon files were not staged or included in the implementation commit.
