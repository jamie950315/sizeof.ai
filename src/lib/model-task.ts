export type ClassifiedTaskKind = 'language' | 'vision-language' | 'image' | 'video' | 'audio' | 'embedding'

const taskFamilies: ReadonlyArray<readonly [ClassifiedTaskKind, readonly string[]]> = [
  ['vision-language', ['image-text-to-text', 'visual-question-answering', 'document-question-answering']],
  ['video', ['text-to-video', 'image-to-video', 'video-generation', 'video-classification']],
  ['audio', [
    'text-to-speech', 'text-to-audio', 'automatic-speech-recognition', 'audio-to-audio',
    'audio-classification', 'voice-cloning', 'voice-activity-detection',
    'speaker-diarization', 'speaker-segmentation', 'music-transcription', 'audio-to-midi', 'tts',
  ]],
  ['image', [
    'text-to-image', 'image-to-image', 'image-generation', 'unconditional-image-generation',
    'image-classification', 'mask-generation', 'image-segmentation', 'object-detection',
    'depth-estimation', 'diffusers',
  ]],
  ['embedding', [
    'visual-document-retrieval', 'sentence-similarity', 'feature-extraction', 'fill-mask',
    'masked-lm', 'bidirectional', 'document-retrieval', 'embedding',
  ]],
  ['language', ['text-generation', 'text2text-generation', 'conversational', 'question-answering', 'summarization', 'translation']],
]

export function classifyKnownModelTask(markers: Iterable<string>): ClassifiedTaskKind | null {
  const values = [...markers]
  for (const [kind, tasks] of taskFamilies) {
    if (tasks.some((task) => values.some((value) => value === task || value.includes(task)))) return kind
  }
  return null
}

export function searchSizingStatusForTask(task: string | null, gated: boolean) {
  if (gated) return 'GATED'
  const kind = task ? classifyKnownModelTask([task.toLowerCase()]) : null
  if (kind === 'language' || kind === 'vision-language') return 'CHECK ON OPEN'
  if (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'embedding') return 'RESOURCE PROFILE'
  return 'UNSPECIFIED'
}
