import { useState } from 'react'
import { validateHardwareProfile, type HardwareKind, type HardwareProfile } from '../lib/hardware-profile'

interface Props {
  profile: HardwareProfile | null
  onApply: (profile: HardwareProfile) => void
  onClear: () => void
}

export default function HardwareProfileControls({ profile, onApply, onClear }: Props) {
  const [kind, setKind] = useState<HardwareKind>(profile?.kind ?? 'discrete-gpu')
  const [label, setLabel] = useState(profile?.label ?? '')
  const [capacityGiB, setCapacityGiB] = useState(String(profile?.capacityGiB ?? 32))
  const [reservedGiB, setReservedGiB] = useState(String(profile?.reservedGiB ?? 0))
  const [validationError, setValidationError] = useState<string | null>(null)

  function save() {
    const capacity = Number(capacityGiB)
    const reserved = Number(reservedGiB)
    const candidate = validateHardwareProfile({ kind, label: label.trim(), capacityGiB: capacity, reservedGiB: reserved })
    if (!candidate) {
      setValidationError('Enter a valid hardware profile before applying it.')
      return
    }
    setValidationError(null)
    onApply(candidate)
  }

  return (
    <fieldset className="hardware-profile" aria-describedby="hardware-profile-note">
      <legend>Local hardware profile</legend>
      <p id="hardware-profile-note">Saved only in this browser. No hardware is auto-detected.</p>
      <label htmlFor="hardware-kind">Profile kind</label>
      <select id="hardware-kind" value={kind} onChange={(event) => setKind(event.target.value as HardwareKind)}>
        <option value="discrete-gpu">Discrete GPU</option>
        <option value="unified-memory">Unified memory</option>
      </select>
      <label htmlFor="hardware-label">Label</label>
      <input id="hardware-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Example: workstation GPU" />
      <div className="hardware-memory-inputs">
        <label htmlFor="hardware-capacity">Total memory (GiB)</label>
        <input id="hardware-capacity" type="number" min="1" value={capacityGiB} onChange={(event) => setCapacityGiB(event.target.value)} />
        <label htmlFor="hardware-reserved">Reserved memory (GiB)</label>
        <input id="hardware-reserved" type="number" min="0" value={reservedGiB} onChange={(event) => setReservedGiB(event.target.value)} />
      </div>
      <div className="hardware-profile-actions">
        <button type="button" onClick={save}>Apply local profile</button>
        {profile && <button type="button" onClick={onClear}>Clear profile</button>}
      </div>
      {validationError && <p role="alert">{validationError}</p>}
      {profile && <p className="hardware-profile-summary">{profile.label}: {profile.capacityGiB} GiB total, {profile.reservedGiB} GiB reserved.</p>}
    </fieldset>
  )
}
