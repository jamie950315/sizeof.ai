export interface DocFigure { src: string; width: number; height: number; alt: string; caption: string }
export function docFigures(slug: string): DocFigure[] {
  if (slug === 'getting-started') return [{ src: '/assets/docs/local-workstation.png', width: 1536, height: 1024,
    alt: 'AI-generated illustration of a generic desktop workstation with a closed tower, monitor, keyboard and mouse.',
    caption: 'AI-generated editorial illustration, not a photograph or a verified hardware configuration. Screen text is illustrative; no performance or compatibility is implied.' }]
  if (slug === 'hardware') return [{ src: '/assets/docs/memory-pools.svg', width: 1100, height: 620,
    alt: 'Separate system RAM and GPU VRAM compared with a shared Apple unified-memory pool.',
    caption: 'Manually checked conceptual diagram, not to scale. Dedicated VRAM is not automatically added to system RAM. Unified memory must also accommodate the operating system and other applications.' }]
  return []
}
