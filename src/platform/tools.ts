export interface SiteTool {
  name: string
  href: string
  description: string
}

export interface SiteToolGroup {
  title: string
  tools: SiteTool[]
}

export const toolGroups: SiteToolGroup[] = [
  {
    title: 'Size',
    tools: [
      { name: 'Model explorer', href: '/', description: 'Search public models and inspect the memory behind every configuration.' },
      { name: 'Comparison workspace', href: '/compare', description: 'Compare up to four models, their actual artifacts and the settings you care about.' },
      { name: 'Context budget', href: '/context', description: 'Account for instructions, history, retrieval, tools and output using actual token counts.' },
      { name: 'Hardware planning lab', href: '/hardware', description: 'Plan memory, disk space, download time and running costs with visible assumptions.' },
    ],
  },
  {
    title: 'Run',
    tools: [
      { name: 'Deployment workbench', href: '/deploy', description: 'Turn your operating system, model and engine choices into a local-first runbook.' },
      { name: 'Compatibility evidence', href: '/compatibility', description: 'Check documented platform, format and architecture evidence without treating unknown support as a guarantee.' },
      { name: 'Troubleshooting workbench', href: '/troubleshoot', description: 'Start from the first failing step. Check evidence and choose the next safe action.' },
    ],
  },
  {
    title: 'Keep',
    tools: [
      { name: 'Personal model library', href: '/library', description: 'Keep a shortlist and notes on this browser. Export a backup whenever you need it.' },
      { name: 'Deployment records', href: '/runs', description: 'Keep the exact settings, observed file version and your own success or failure notes together.' },
      { name: 'Measurement notebook', href: '/benchmarks', description: 'Keep raw observations and compare medians only when the declared test conditions match.' },
      { name: 'Model revision changes', href: '/model-changes', description: 'Compare published files, selected architecture fields and license declarations before upgrading.' },
    ],
  },
  {
    title: 'Reference',
    tools: [
      { name: 'Field guide', href: '/docs', description: 'Understand the architecture, make informed tradeoffs, and diagnose your first deployment.' },
      { name: 'Data status', href: '/status', description: 'See reachable search routes, data age and reported backfill status. Matching copies are not proof of completeness.' },
      { name: 'Workspace overview', href: '/start', description: 'Explore the model. Understand the memory. Prepare the deployment. Keep the evidence in view at every step.' },
    ],
  },
]

export const primaryLinks: Array<[label: string, href: string]> = [
  ['Models', '/'],
  ['Compare', '/compare'],
  ['Deploy', '/deploy'],
  ['Hardware', '/hardware'],
  ['Docs', '/docs'],
]
