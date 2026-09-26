# Documentation visuals

All documentation figures are hand-authored SVG diagrams. No generated imagery is used.

- `public/assets/docs/memory-budget.svg` (getting-started): conceptual "what fills your memory" diagram. Two bars stack model weights (solid ink), KV cache (diagonal hatch) and runtime buffers (dots) against a GPU memory capacity marker: a short context fits with headroom, a long context exceeds capacity. Proportions are illustrative, not measured, and imply no specific model, device or runtime.
- `public/assets/docs/memory-pools.svg` (hardware): non-proportional educational diagram of separate system RAM and GPU VRAM versus Apple shared physical memory. It does not describe CUDA managed-memory behavior, allocator limits, interconnect wiring or bandwidth.

## Authoring rules

- Both diagrams use the site's paper/ink palette and the same pattern language as the memory gauge (solid = weights, hatch = KV cache, dots = runtime), so they read without colour. An embedded `<style>` switches colours with `prefers-color-scheme`; page CSS variables are not available inside an `<img>`.
- Every visible label is a plain English `<text>` element (plus `<title>`/`<desc>`). `scripts/i18n-catalog.mjs` extracts them into the message catalog and `scripts/localize-diagrams.mjs` writes `<name>.<locale>.svg` copies without touching shapes.
- Layout hints on `<text>`: `data-fit` is the maximum label width (longer translations are condensed with `textLength`), `data-rtl-x` is the right edge used for right-to-left locales. Start-anchored labels need `data-rtl-x`.
- Do not edit the generated `*.<locale>.svg` files by hand; change the English source and regenerate after the catalogs contain the labels.
