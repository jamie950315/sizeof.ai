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
}
