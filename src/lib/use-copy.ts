import { useEffect, useRef, useState } from 'react'

export function useCopy() {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function copy(text: string) {
    window.clearTimeout(timer.current)
    setCopied(false)
    setCopyError(null)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      timer.current = window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopyError('Could not copy. Check browser clipboard permissions and try again.')
    }
  }

  return { copied, copyError, copy }
}
