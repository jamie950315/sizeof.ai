import type { EvidenceEntry } from '../lib/evidence'

interface Props {
  entries: EvidenceEntry[]
}

export default function EvidenceDrawer({ entries }: Props) {
  const counts = entries.reduce<Record<EvidenceEntry['kind'], number>>((total, entry) => {
    total[entry.kind] += 1
    return total
  }, { verified: 0, derived: 0, unknown: 0 })

  return (
    <details className="evidence-drawer">
      <summary>Evidence: {counts.verified} verified, {counts.derived} derived, {counts.unknown} unknown</summary>
      <ul aria-label="Estimate evidence">
        {entries.map((entry) => (
          <li key={entry.id} className={`evidence-${entry.kind}`} data-evidence-kind={entry.kind}>
            <strong>{entry.kind.toUpperCase()} / {entry.label}</strong>
            <p>{entry.detail}</p>
            {(entry.revision || entry.repositoryUpdatedAt || entry.fetchedAt) && <small>
              {entry.revision ? `Revision ${entry.revision}` : ''}
              {entry.revision && (entry.repositoryUpdatedAt || entry.fetchedAt) ? ' · ' : ''}
              {entry.repositoryUpdatedAt ? `Repository updated ${entry.repositoryUpdatedAt}` : ''}
              {entry.repositoryUpdatedAt && entry.fetchedAt ? ' · ' : ''}
              {entry.fetchedAt ? `Observed ${entry.fetchedAt}` : ''}
            </small>}
            {entry.sourceUrl && <a href={entry.sourceUrl} target="_blank" rel="noreferrer">View source</a>}
          </li>
        ))}
      </ul>
    </details>
  )
}
