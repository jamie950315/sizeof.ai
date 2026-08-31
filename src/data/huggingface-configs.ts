export const curatedHuggingFaceConfigs: Record<string, Record<string, unknown>> = {
  'meta-llama/Llama-3.1-8B-Instruct': {
    architectures: ['LlamaForCausalLM'],
    model_type: 'llama',
    hidden_size: 4096,
    num_hidden_layers: 32,
    num_attention_heads: 32,
    num_key_value_heads: 8,
    head_dim: 128,
    max_position_embeddings: 131072,
  },
  // Revision-checked against the official config at a4e59da52a7bc87ae7251dd5545c0dd437c44b68.
  // This fallback is used only when the live revision-locked config request is unavailable.
  'meta-models/Muse-Glimmer-30B': {
    architectures: ['MuseGlimmerForConditionalGeneration'],
    model_type: 'muse_glimmer',
    text_config: {
      model_type: 'muse_glimmer_text',
      num_hidden_layers: 52,
      hidden_size: 6656,
      num_attention_heads: 32,
      num_key_value_heads: 2,
      head_dim: 128,
      max_position_embeddings: 131072,
      sliding_window: 2048,
      layer_types: Array.from({ length: 52 }, (_, index) => (index + 1) % 4 === 0
        ? 'full_attention'
        : 'sliding_attention'),
    },
  },
}
