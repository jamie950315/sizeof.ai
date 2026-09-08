export interface DocSection {
  id: string
  title: string
  paragraphs: string[]
  bullets?: string[]
  code?: string
}

export interface DocArticle {
  slug: string
  title: string
  description: string
  category: 'Start here' | 'Model fundamentals' | 'Run locally' | 'Operate & measure'
  level: 'Beginner' | 'Advanced'
  sections: DocSection[]
  sources: { label: string; url: string }[]
  related: string[]
}

export const DOCS_REVIEWED_AT = '2026-09-08'
const llama = { label: 'llama.cpp official documentation', url: 'https://github.com/ggml-org/llama.cpp' }
const mlx = { label: 'MLX LM official documentation', url: 'https://github.com/ml-explore/mlx-lm' }
const vllm = { label: 'vLLM quickstart', url: 'https://docs.vllm.ai/en/latest/getting_started/quickstart/' }
const cards = { label: 'Hugging Face model cards', url: 'https://huggingface.co/docs/hub/model-cards' }
const kv = { label: 'Transformers cache strategies', url: 'https://huggingface.co/docs/transformers/en/kv_cache' }
const quant = { label: 'Transformers quantization overview', url: 'https://huggingface.co/docs/transformers/en/quantization/overview' }
const security = { label: 'vLLM security guidance', url: 'https://docs.vllm.ai/en/latest/usage/security/' }

export const docsArticles: DocArticle[] = [
  {
    slug: 'getting-started', title: 'Your first local model', category: 'Start here', level: 'Beginner',
    description: 'Go from a computer and a use case to a small, working local conversation.',
    sections: [
      { id: 'start-small', title: 'Start with one useful task', paragraphs: ['Choose a concrete task: rewrite a paragraph, explain a short function, or summarize a page. Your first milestone is a correct answer on your own machine, not running the largest model that barely loads.', 'Local inference means the model runs on your computer. Downloading its files normally needs a network connection; a local application can still contact external services, so check its settings before using private documents.'], bullets: ['Write down your operating system, GPU model, available VRAM, system RAM, and free disk space.', 'Choose an instruction-tuned text model supported by your runtime. A base model is not automatically a chat assistant.', 'Begin with a short context and one conversation. Add longer prompts and parallel users only after the first run works.'] },
      { id: 'plan', title: 'Check the whole memory budget', paragraphs: ['Search for the exact repository in the model explorer. Select your available memory, intended context, and a compatible quantization. Prefer a published artifact size when one is available.', 'Weights are only part of the budget. Conversation state and runtime workspaces need room too. A lower-bound result is not a promise that the model will fit; it means some runtime-dependent memory is not safely modeled.'] },
      { id: 'run', title: 'Pick a runtime, then verify', paragraphs: ['For Apple silicon, MLX LM is a native option. llama.cpp offers broad local hardware support with GGUF files. vLLM is an option for managed API serving and concurrent workloads. A desktop interface built around a compatible runtime may be easier if you do not want a terminal.', 'Use the matching guide here, follow its official installation link, and test one short prompt. Confirm the runtime actually uses the intended accelerator. Save the model revision, artifact, and working settings before changing anything.'] },
    ], sources: [llama, mlx, vllm, cards], related: ['choose-model', 'hardware', 'troubleshooting'],
  },
  {
    slug: 'choose-model', title: 'Choose a model, not just a size', category: 'Start here', level: 'Beginner',
    description: 'Read model names, licenses, formats, and evidence before committing to a download.',
    sections: [
      { id: 'task', title: 'Match the task and language', paragraphs: ['A bigger parameter count does not guarantee better results for your task. Compare candidates using the same examples in the languages, formats, and domain you actually need. Check the publisher’s evaluations, then run your own small evaluation.', 'Text generation, embeddings, image generation, and adapters solve different problems. An embedding model does not replace a chat model, and a LoRA adapter normally needs its compatible base model.'] },
      { id: 'card', title: 'Read the model card before downloading', paragraphs: ['The model card is where publishers document intended use, training information, limitations, evaluations, and often licensing. Missing information is uncertainty, not permission or proof of quality.'], bullets: ['Verify the original publisher and any declared base model.', 'Check the license itself, including commercial-use and redistribution terms; an open download is not necessarily an unrestricted license.', 'Confirm your runtime supports both the architecture and the exact quantization format.', 'Check whether access requires accepting conditions or authenticating to the repository.'] },
      { id: 'compare', title: 'Make a useful shortlist', paragraphs: ['Compare two or three models at the same context and memory capacity. Keep architecture-dependent caveats visible. A model that fits with headroom and gives reliable answers may be more useful than one that is constantly offloading.', 'Downloads and likes help discovery, but are not quality measurements. Record failure cases as carefully as successes.'] },
    ], sources: [cards, quant], related: ['quantization', 'benchmarking', 'model-files'],
  },
  {
    slug: 'quantization', title: 'Quantization without the guesswork', category: 'Model fundamentals', level: 'Beginner',
    description: 'Understand bit widths, file formats, and why two “4-bit” models can behave differently.',
    sections: [
      { id: 'bits', title: 'What fewer bits actually change', paragraphs: ['Quantization stores model values at lower precision to reduce memory use. It can change accuracy and runtime speed; neither quality loss nor speedup is a fixed percentage.', 'As a first approximation, weight bytes are parameter count × bits per weight ÷ 8. For a hypothetical 8-billion-parameter model at exactly 4 bits, that is 4 billion bytes, or about 3.73 GiB. Real artifacts include scales, metadata, mixed-precision tensors, and other overhead.'] },
      { id: 'formats', title: 'Bits are not a compatibility format', paragraphs: ['GGUF, MLX quantizations, AWQ, and GPTQ are not interchangeable simply because they use a similar bit width. The runtime needs to support the architecture, file format, quantization method, and target hardware together.', 'A filename such as Q4_K_M describes a particular quantization scheme, not a guarantee that every tensor uses exactly four bits. Use the actual full-model artifact size when possible rather than inferring it from the label.'] },
      { id: 'choose', title: 'Choose by measured quality', paragraphs: ['Start with a supported moderate quantization, then test your real prompts. If quality is insufficient, try a higher-precision variant or a different model. If memory is tight, first check whether you have unnecessarily large context or concurrency.', 'Weight quantization and KV-cache quantization are separate controls. Changing one does not automatically change the other. Extreme compression deserves especially careful evaluation.'] },
    ], sources: [quant, llama, mlx], related: ['kv-cache', 'model-files', 'benchmarking'],
  },
  {
    slug: 'kv-cache', title: 'Context length and the KV cache', category: 'Model fundamentals', level: 'Beginner',
    description: 'Why a model can load successfully, then run out of memory during a conversation.',
    sections: [
      { id: 'what', title: 'The conversation has a memory cost', paragraphs: ['During autoregressive generation, an attention model can keep previously computed keys and values instead of recomputing them for every new token. This is the KV cache. It is not a database of facts and does not permanently train the model.', 'The context budget includes instructions, conversation history, retrieved text, tool output, and the generated answer. Reserve room for output rather than filling the entire supported context with the prompt.'] },
      { id: 'formula', title: 'A useful formula, with boundaries', paragraphs: ['For ordinary full-attention layers, an approximate KV payload in bytes is 2 × layers × KV heads × head dimension × tokens × bytes per cache value × independent sequences.', 'This formula is not universal. Sliding-window layers may stop growing at their window limit. MLA can use a different representation, and recurrent or state-space layers have different state. Runtime allocation, block padding, and workspaces add overhead.'] },
      { id: 'tradeoffs', title: 'Reduce memory deliberately', paragraphs: ['Shorten context or reduce concurrent sequences before assuming weights are the problem. A supported quantized cache may save memory but can affect quality or latency. Offloading can save accelerator memory while adding transfer cost.', 'Some engines preallocate a cache budget; others grow it as generation proceeds. A low idle allocation and a successful short prompt do not prove that the maximum workload will fit. Test a representative long prompt.'] },
    ], sources: [kv], related: ['attention', 'troubleshooting', 'benchmarking'],
  },
  {
    slug: 'attention', title: 'Attention and hybrid architectures', category: 'Model fundamentals', level: 'Advanced',
    description: 'Separate architectural memory behavior from the kernel that executes it.',
    sections: [
      { id: 'architecture', title: 'Read the layer topology', paragraphs: ['Full attention, sliding-window attention, and recurrent state do not retain history in the same way. Hybrid models combine layer types, so applying a full-attention formula to every layer can misrepresent memory.', 'Grouped-query attention shares key/value heads across query heads. The number of KV heads, not just the number of query heads, matters for a standard cache estimate. MLA introduces a representation choice whose real allocation depends on runtime support.'] },
      { id: 'backend', title: 'An attention backend is not a new architecture', paragraphs: ['FlashAttention and PyTorch SDPA describe implementations of attention computation. Optimized kernels reduce intermediate memory traffic; they do not magically remove model weights or all retained conversation state.', 'Support depends on model structure, precision, hardware, and installed packages. A configuration flag is not evidence that the desired kernel is active. Inspect startup logs and measure the target workload.'] },
      { id: 'evidence', title: 'Treat a lower bound as incomplete evidence', paragraphs: ['sizeof.ai exposes published topology and separates safe ordinary estimates from runtime-specific lower bounds. Do not convert an unknown recurrent-state allocation into zero.', 'For unfamiliar architectures, use the exact runtime release’s support documentation, then measure peak allocation during prefill and generation. Record the cache mode with the result so another person can reproduce it.'] },
    ], sources: [kv, { label: 'Transformers attention backends', url: 'https://huggingface.co/docs/transformers/en/attention_interface' }], related: ['kv-cache', 'moe', 'benchmarking'],
  },
  {
    slug: 'moe', title: 'MoE: active is not total', category: 'Model fundamentals', level: 'Advanced',
    description: 'Understand expert routing without underestimating the weights that must be stored.',
    sections: [
      { id: 'experts', title: 'A subset of experts works on each token', paragraphs: ['A mixture-of-experts model routes each token through selected expert networks. Active parameters describe the parameters involved in that token’s computation; total parameters include all experts and shared components.', 'Different tokens may select different experts. A model advertised with a small active count can therefore require far more weight storage than a dense model of that active size.'] },
      { id: 'memory', title: 'Budget total resident weights', paragraphs: ['Use total parameters or a verified full-model artifact for the weight budget. Do not calculate resident weights from active parameters alone.', 'Expert offload and expert parallelism can change where weights live and how much communication occurs. These are runtime deployment strategies, not a universal reduction factor. System RAM, accelerator memory, interconnect, and disk traffic must be considered separately.'] },
      { id: 'evaluate', title: 'Evaluate the actual deployment', paragraphs: ['Two MoE models with similar active counts can differ in total experts, shared layers, attention, and communication cost. Compare memory and speed using the exact quantization, runtime, and hardware topology.', 'A low active parameter count is not a tokens-per-second prediction. Measure prompt processing and generation separately, including concurrent load if you intend to serve multiple users.'] },
    ], sources: [{ label: 'Transformers Mixtral architecture documentation', url: 'https://huggingface.co/docs/transformers/main/en/model_doc/mixtral' }], related: ['hardware', 'attention', 'benchmarking'],
  },
  {
    slug: 'hardware', title: 'Plan RAM, VRAM, and disk together', category: 'Start here', level: 'Beginner',
    description: 'Keep separate budgets for storage, system memory, accelerator memory, and headroom.',
    sections: [
      { id: 'budgets', title: 'Three capacities, three different jobs', paragraphs: ['Disk stores downloaded files. System RAM holds application data and may hold offloaded model weights. Discrete GPU VRAM holds accelerator-resident weights, cache, and workspaces. Free disk space does not substitute for VRAM.', 'On Apple silicon, the CPU and GPU share unified memory. Do not count that memory twice. Leave room for macOS, the application, and other processes; the advertised total is not all available to a single model.'] },
      { id: 'units', title: 'Compare the same units', paragraphs: ['A decimal GB is 1,000,000,000 bytes. A GiB is 1,073,741,824 bytes. sizeof.ai uses GiB for memory estimates. A download shown in GB may appear smaller when expressed in GiB without any file being missing.', 'Plan disk space for the selected artifacts, download staging, alternative quantizations, and runtime caches. Do not download every variant in a repository when you only need one complete model.'] },
      { id: 'multi', title: 'More GPUs do not make one invisible pool', paragraphs: ['Adding card capacities is only a first planning number. Your runtime must support the required split, individual layers or tensors must be placeable, and interconnect overhead can dominate.', 'Use existing hardware for a small representative test before buying or renting more. sizeof.ai estimates capacity, not guaranteed compatibility, generation speed, or purchase value.'] },
    ], sources: [llama, mlx, vllm], related: ['getting-started', 'moe', 'model-files'],
  },
  {
    slug: 'model-files', title: 'Download the right model files', category: 'Model fundamentals', level: 'Beginner',
    description: 'Distinguish full models, shards, adapters, projectors, and calibration artifacts.',
    sections: [
      { id: 'formats', title: 'A repository is a package, not one weight file', paragraphs: ['A repository can contain several quantizations, tokenizers, configuration files, documentation, and auxiliary components. Its total storage is not necessarily the memory needed for one selected model.', 'A safetensors checkpoint often spans several shards referenced by an index. A sharded GGUF variant also needs its complete matching shard set. One shard is not the full model, even if its name looks plausible.'] },
      { id: 'auxiliary', title: 'Know what is not a standalone model', paragraphs: ['A LoRA adapter requires a compatible base. A vision projector is a support component. An importance matrix or calibration file helps create a quantization; it is not a complete quantized model.', 'Draft models used for speculative decoding may need a separate target model. Budget the pair according to the runtime rather than treating the draft’s small size as the whole service.'] },
      { id: 'reproduce', title: 'Keep a reproducible manifest', paragraphs: ['Record the owner/repository, revision, exact artifact name, size, and runtime version. Check the publisher’s declared base relationship instead of guessing from similar names.', 'Avoid mixing shards from different revisions. If a file list is incomplete or a base relationship cannot be verified, treat the resulting memory figure as unavailable until the missing evidence is resolved.'] },
    ], sources: [cards, llama, quant], related: ['choose-model', 'quantization', 'troubleshooting'],
  },
  {
    slug: 'llama-cpp', title: 'Run a GGUF model with llama.cpp', category: 'Run locally', level: 'Beginner',
    description: 'A local-first starting point for CPU, GPU, and hybrid inference.',
    sections: [
      { id: 'install', title: 'Install for your hardware', paragraphs: ['Use the official llama.cpp installation or build guide for your operating system and accelerator. A binary without your intended backend may run on CPU even when a GPU is present.', 'Confirm the installed version and available commands before downloading a model. The current upstream README uses the unified llama CLI; older releases commonly expose llama-cli and llama-server instead. Use the help for your installed release, not a mixture of examples from different versions.'], code: 'llama --help\nllama cli --help' },
      { id: 'first-run', title: 'Run the official small-model example', paragraphs: ['The upstream quickstart provides this Hugging Face GGUF example. It downloads model files, so check free disk space and any network charges first. Review the repository and license before use.', 'The model is an installation smoke test, not a recommendation for every task. Confirm sensible output and the active hardware backend in the logs before moving to a larger model.'], code: 'llama cli -hf ggml-org/Qwen3.5-0.8B-GGUF' },
      { id: 'next', title: 'Scale one setting at a time', paragraphs: ['Choose a compatible GGUF quantization, then configure context and GPU offload using your release’s documented options. Record the selected file rather than only the repository.', 'For an API server, follow the upstream server guide and bind it to loopback for the first test. Never assume an example server is safe to expose publicly. Use the serving-security checklist before sharing it.'] },
    ], sources: [llama], related: ['model-files', 'serving-security', 'benchmarking'],
  },
  {
    slug: 'mlx', title: 'Run a model on Apple silicon with MLX', category: 'Run locally', level: 'Beginner',
    description: 'A clean Python environment and a small MLX-compatible model on your Mac.',
    sections: [
      { id: 'install', title: 'Use an isolated environment', paragraphs: ['MLX LM is designed for generating text and fine-tuning language models on Apple silicon. Check its current requirements before installation. An Intel Mac is not the target for this guide.', 'Create a project-specific environment so package changes do not affect unrelated Python tools. Installation and the first generation need network access.'], code: 'python3 -m venv .venv\nsource .venv/bin/activate\npython -m pip install mlx-lm\nmlx_lm.generate --help' },
      { id: 'generate', title: 'Start with an explicitly named artifact', paragraphs: ['The official documentation names this MLX-compatible model as its default. An explicit model argument makes the example reproducible at the repository level; record the revision as well for repeatable evaluations.', 'A Hugging Face repository is not automatically MLX-compatible. Confirm both model architecture and quantization support.'], code: 'mlx_lm.generate --model mlx-community/Llama-3.2-3B-Instruct-4bit --prompt "Explain what a token is in two sentences."' },
      { id: 'memory', title: 'Watch unified-memory pressure', paragraphs: ['Leave memory for macOS and other applications. A model that forces heavy swapping may respond very slowly even if generation eventually succeeds. Close unrelated workloads or select a smaller artifact before changing system-wide limits.', 'Long prompts and retained conversation state also consume memory. The upstream guide documents prefill sizing and cache strategies; test the quality and speed tradeoff rather than assuming a smaller cache is equivalent.'] },
    ], sources: [mlx], related: ['hardware', 'kv-cache', 'troubleshooting'],
  },
  {
    slug: 'vllm', title: 'Serve a model with vLLM', category: 'Run locally', level: 'Advanced',
    description: 'Bring up a loopback-only API before tuning concurrency or opening network access.',
    sections: [
      { id: 'environment', title: 'Match the installation to the accelerator', paragraphs: ['Follow the official installation path for your GPU, operating system, and driver. CUDA, ROCm, and other supported backends have different requirements. Do not assume a generic package install selects the correct combination.', 'Start in an isolated environment. This guide assumes vLLM is installed and the example architecture is supported. It does not provision a cloud machine or enable paid inference services.'] },
      { id: 'start', title: 'Start on loopback', paragraphs: ['The official quickstart uses Qwen2.5-1.5B-Instruct. Binding explicitly to 127.0.0.1 keeps this initial HTTP listener local to the machine. This is a setup example, not a production security configuration.', 'The first launch downloads weights and may compile or warm up components. Read startup errors directly; do not hide a failed load by automatically selecting a different model.'], code: 'vllm serve Qwen/Qwen2.5-1.5B-Instruct --host 127.0.0.1 --port 8000\n# In a second terminal, after startup completes:\ncurl --fail-with-body http://127.0.0.1:8000/v1/models' },
      { id: 'workload', title: 'Test chat, then concurrency', paragraphs: ['A model-list response proves the API is reachable, not that generation is correct. Send a short chat request and verify the model id, output, errors, and memory.', 'Then test realistic prompt lengths and simultaneous requests. Cache preallocation and batching change resource use. A single-user fit estimate must not be treated as a concurrency guarantee.'], code: 'curl --fail-with-body http://127.0.0.1:8000/v1/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -d \'{"model":"Qwen/Qwen2.5-1.5B-Instruct","messages":[{"role":"user","content":"Explain VRAM briefly."}],"max_tokens":64}\'' },
    ], sources: [vllm, security], related: ['serving-security', 'benchmarking', 'kv-cache'],
  },
  {
    slug: 'serving-security', title: 'Before you expose a model server', category: 'Operate & measure', level: 'Advanced',
    description: 'A working local endpoint is not a secured public service.',
    sections: [
      { id: 'boundary', title: 'Keep the default boundary private', paragraphs: ['Bind local experiments to loopback. If another person needs access, prefer an authenticated private network or an authenticated HTTPS gateway with explicit allowed routes.', 'The vLLM security guide warns that API-key coverage does not automatically protect every management or plugin route. A single API-key flag must not be treated as a firewall for the whole process.'], bullets: ['Expose only the inference routes you intend to support.', 'Keep debug, metrics, distributed-worker, and administration interfaces private.', 'Apply authentication, request-size limits, concurrency limits, and timeouts at the access boundary.', 'Verify unauthorized requests are rejected from outside the machine, not just from localhost.'] },
      { id: 'credentials', title: 'Treat model access and application access separately', paragraphs: ['A Hugging Face token lets a server download authorized artifacts. A serving API key controls who can ask that server to generate. They have different purposes and should not be reused.', 'Keep tokens out of browser bundles, shared URLs, screenshots, source control, and command examples. Scope permissions narrowly. Inspect logging so private prompts and authorization headers are not accidentally retained.'] },
      { id: 'trust', title: 'Model loading is a trust decision', paragraphs: ['Do not enable remote-code execution simply to dismiss a warning. Review the repository, pin a revision, and understand the code that will execute. Runtime caches and plugins should be writable only by trusted processes.', 'For multi-user deployments, review cache sharing and isolation as well as authentication. Patch the runtime, limit resource consumption, and retain a tested way to stop or roll back the service.'] },
    ], sources: [security, mlx], related: ['vllm', 'troubleshooting', 'benchmarking'],
  },
  {
    slug: 'troubleshooting', title: 'Find the cause, not a silent fallback', category: 'Operate & measure', level: 'Beginner',
    description: 'Use the first failing stage to distinguish download, loading, memory, and generation problems.',
    sections: [
      { id: 'download', title: 'Download or access failure', paragraphs: ['For a 401 or 403, check token scope and whether the repository requires accepting access terms. For a missing repository or artifact, verify the exact owner, name, revision, and filename. Do not retry indefinitely or switch models without saying so.', 'A partial shard set, insufficient disk space, or interrupted download must be resolved before trusting the resulting model. Keep the first useful error and check free disk space.'] },
      { id: 'oom', title: 'Out of memory: identify when it happens', paragraphs: ['If loading fails, the resident weights and startup allocations may exceed available memory. If a short prompt works but a long one fails, context, prefill workspaces, or concurrency are likely contributors.', 'Reduce one variable at a time: context, concurrent requests, or weight precision. Record actual free memory and other running processes. Do not call an offloaded or smaller-model retry equivalent to the original configuration.'] },
      { id: 'output', title: 'Slow or incorrect output', paragraphs: ['For unexpectedly slow output, confirm the accelerator backend is active and check swapping, offload, thermal constraints, and concurrent workloads. Separate slow model download, slow first-token time, and slow generation.', 'For repeated tokens or nonsense, check the model’s chat template, tokenizer, supported architecture, quantization, and generation settings. Test a simple known prompt before adding retrieval or tools. Capture the model revision, runtime version, exact command, first error, and a non-sensitive reproducer.'] },
    ], sources: [llama, mlx, vllm, kv], related: ['hardware', 'model-files', 'benchmarking'],
  },
  {
    slug: 'benchmarking', title: 'Benchmark a workload you actually use', category: 'Operate & measure', level: 'Advanced',
    description: 'Measure latency, throughput, peak memory, and quality without mixing incomparable runs.',
    sections: [
      { id: 'metrics', title: 'Measure more than tokens per second', paragraphs: ['Time to first token captures how long someone waits before the answer begins. Prompt processing measures prefill. Decode speed describes generated tokens after prefill. End-to-end latency also includes queuing and transport.', 'Report peak memory and error rate alongside speed. A high throughput number with failed requests or poor answers is not a successful deployment. No estimated memory figure on sizeof.ai is a measured performance benchmark.'] },
      { id: 'protocol', title: 'Use a small repeatable protocol', paragraphs: ['Fix the model revision, artifact, runtime version, hardware, context, prompt, output limit, and concurrency. Warm up separately and label cold-start measurements. Repeat the run rather than selecting the fastest sample.'], bullets: ['Test a short prompt, a representative prompt, and a long prompt within supported limits.', 'Separate cached-prefix and uncached runs; they measure different work.', 'Use the same output-length policy and note early end-of-sequence behavior.', 'Measure single-user latency and your intended concurrent load separately.', 'Retain raw observations and report the median and tail latency when sample size is meaningful.'] },
      { id: 'tools', title: 'Use runtime tooling, then the real application', paragraphs: ['llama.cpp includes dedicated benchmark tooling; MLX LM documents generation and benchmark options; vLLM provides serving-oriented tools. Confirm flags with the installed version’s help.', 'A synthetic benchmark isolates compute but does not cover your full application. Follow it with real prompts and explicit correctness checks. Record environmental differences before comparing results from different people.'] },
    ], sources: [llama, mlx, vllm], related: ['troubleshooting', 'quantization', 'serving-security'],
  },
  {
    slug: 'api', title: 'Use the sizeof.ai estimate API', category: 'Operate & measure', level: 'Advanced',
    description: 'Reproduce a memory estimate and handle uncertainty explicitly in your own tools.',
    sections: [
      { id: 'request', title: 'Start with an explicit testnet request', paragraphs: ['The public estimate endpoint describes model memory; it does not run the model or generate text. This example targets testnet, where the platform features are being validated.', 'Use the canonical owner/repository identifier. context uses 1024-token steps, vram is in GiB, and quant is a supported calculator identifier. q4_k_m is an estimate configuration, not a claim that the repository includes a verified GGUF artifact.'], code: 'curl --fail-with-body --get "https://testnet.sizeof.ai/api/v1/estimate" \\\n  --data-urlencode "model=Qwen/Qwen2.5-1.5B-Instruct" \\\n  --data-urlencode "quant=q4_k_m" \\\n  --data-urlencode "context=4096" \\\n  --data-urlencode "vram=16"' },
      { id: 'response', title: 'Read the result state before the number', paragraphs: ['The response uses schema sizeof-estimate/v1. result.state can be estimate, lower-bound, or unavailable. Only an ordinary estimate can carry a normal fit classification. A lower bound does not establish that the model fits.', 'Keep evidence, provenance, configuration, generatedAt, and the disclaimer with exported results. Distinguish published artifact weight sizes from hypothetical precision estimates. Null values are unknown or inapplicable, not zero.'] },
      { id: 'failures', title: 'Make failure visible to callers', paragraphs: ['Check HTTP status before parsing a success payload. Invalid or duplicate parameters are rejected; upstream problems should remain visible rather than being turned into an empty success. Public estimates reject stale metadata rather than quietly publishing an outdated fit.', 'Cache responsibly, avoid retry loops, and use a small bounded retry only for transient failures. No availability guarantee or unlimited free quota is implied. For a real deployment decision, verify on the target hardware and runtime.'] },
    ], sources: [{ label: 'Live testnet estimate endpoint', url: 'https://testnet.sizeof.ai/api/v1/estimate?model=Qwen%2FQwen2.5-1.5B-Instruct&context=4096&vram=16' }], related: ['evidence', 'benchmarking', 'kv-cache'],
  },
  {
    slug: 'evidence', title: 'Read a memory estimate honestly', category: 'Start here', level: 'Beginner',
    description: 'Know what is published, calculated, runtime-dependent, or still unknown.',
    sections: [
      { id: 'layers', title: 'Published facts and estimates are different', paragraphs: ['A file’s published byte size is evidence about that artifact. A parameter-count calculation is an estimate of weight storage. Runtime memory adds cache, workspaces, allocation behavior, and other components.', 'sizeof.ai keeps these distinctions visible. Changing a precision estimate does not create a real downloadable quantization, and a supported context in a model config does not prove acceptable quality at that length.'] },
      { id: 'states', title: 'Three states, three interpretations', paragraphs: ['An ordinary estimate applies a supported calculation with stated assumptions. A lower bound includes known components but cannot safely account for all runtime-dependent memory. Unavailable means there is not enough trustworthy information for the requested total.', 'Do not rank an unavailable model as zero GiB or treat a lower bound below capacity as a safe fit. Missing metadata is a reason to inspect the source and measure, not to invent a convenient default.'] },
      { id: 'freshness', title: 'Freshness and completeness are separate', paragraphs: ['The search catalog stores discoverable model names and ranking information. Model details are fetched and cached separately. A name appearing in search does not establish runtime support or current artifact completeness.', 'A cached detail response can be older than its repository. Inspect freshness warnings and source links. The final check is a successful representative workload on the exact hardware and runtime you will use.'] },
    ], sources: [cards, kv], related: ['getting-started', 'api', 'benchmarking'],
  },
  {
    slug: 'reproducible-deployments', title: 'Repeat a deployment without changing the model', category: 'Operate & measure', level: 'Advanced',
    description: 'Fix the model download to a commit, preserve the environment, and distinguish configuration differences from measured improvements.',
    sections: [
      { id: 'pin-model', title: 'A model name is not an immutable version', paragraphs: ['A repository default branch and a release tag can change. A saved observation of its commit is useful evidence, but does not force a later command to download that commit. Use the full commit identifier in the download step and keep the local destination separate for each repository and revision.', 'In the deployment workbench, selecting a published single-file GGUF fills the model commit. The generated Hugging Face CLI command uses --revision and --local-dir; the following engine command reads that local path rather than fetching the default branch. Run the download first and stop if it fails. An unavailable commit is not permission to substitute a newer one.'] },
      { id: 'environment', title: 'Model pinning is only one part of reproducibility', paragraphs: ['The model commit does not fix the runtime, Python packages, driver, operating system, device configuration, or sampling behavior. Record their actual versions and the exact artifact. This site does not install or freeze your environment, inspect local modifications, or guarantee bit-identical generated text.', 'For a split model, every required shard must be accounted for; the current fixed GGUF recipe deliberately accepts only a single file. MLX and vLLM repository downloads include all files at the commit, which can require more disk space than one weight variant. Review access terms and installation instructions before running any command.'] },
      { id: 'compare-evidence', title: 'Keep configuration changes separate from performance claims', paragraphs: ['Save a deployment record before changing settings, then another after the test. Select both records to see exactly which configuration, artifact facts, or user reports differ. A changed success status is not evidence of faster generation or lower peak memory.', 'Use the measurement notebook for actual observations. Keep the model revision, runtime version, hardware, precision, context, real prompt token count, concurrency, load state and workload policy aligned before combining samples. Unknown values stay unknown. If you time decoding from the first token to the last, count only the tokens produced within that interval; do not divide the entire output length by a different timing interval.'] },
    ],
    sources: [{ label: 'Hugging Face CLI downloads and revisions', url: 'https://huggingface.co/docs/huggingface_hub/guides/cli#download-a-specific-revision' }, llama, mlx, vllm],
    related: ['benchmarking', 'model-files', 'troubleshooting'],
  },
]

export function findDocArticle(slug: string): DocArticle | undefined {
  return docsArticles.find((article) => article.slug === slug)
}

export function searchDocs(query: string, level = 'All'): DocArticle[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return docsArticles.filter((article) => {
    if (level !== 'All' && article.level !== level) return false
    const text = [article.title, article.description, article.category, ...article.sections.flatMap((section) => [section.title, ...section.paragraphs, ...(section.bullets ?? [])])].join(' ').toLowerCase()
    return terms.every((term) => text.includes(term))
  })
}

export function docsBasePath(hostname: string): string {
  return hostname === 'docs.sizeof.ai' ? '' : '/docs'
}

export function docHref(slug: string, basePath = '/docs'): string {
  return `${basePath}/${slug}`
}
