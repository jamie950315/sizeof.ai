import { useState } from 'react'
import { createSizingExport, exportSizingCsv, exportSizingMarkdown, type SizingExportInput } from '../lib/export'

interface Props { input: SizingExportInput; label?: string; fileStem: string }

function download(contents: string, type: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

async function copyMarkdown(contents: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(contents)
  const textarea = document.createElement('textarea')
  textarea.value = contents
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

export default function ExportMenu({ input, label = 'Export sizing', fileStem }: Props) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const json = JSON.stringify(createSizingExport(input), null, 2)
  const markdown = exportSizingMarkdown(input)
  return <div className="export-menu">
    <button type="button" aria-expanded={open} aria-label={label} onClick={() => setOpen((current) => !current)}>{label}</button>
    {open && <div role="menu" aria-label={`${label} options`}>
      <button type="button" role="menuitem" aria-label="Download JSON export" onClick={() => download(json, 'application/json;charset=utf-8', `${fileStem}.json`)}>JSON</button>
      <button type="button" role="menuitem" aria-label="Download CSV export" onClick={() => download(exportSizingCsv(input), 'text/csv;charset=utf-8', `${fileStem}.csv`)}>CSV</button>
      <button type="button" role="menuitem" aria-label="Copy Markdown export" onClick={() => void copyMarkdown(markdown).then(() => setCopied(true))}>{copied ? 'COPIED' : 'COPY MARKDOWN'}</button>
    </div>}
  </div>
}
