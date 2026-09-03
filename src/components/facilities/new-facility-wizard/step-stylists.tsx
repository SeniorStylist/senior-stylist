'use client'

// P57 — Step 3 (manage tier only): staff the facility. Pick EXISTING stylists
// by name/ST-code, create new ones, or upload the stylist sheet. Every pick
// carries day chips (default = the facility's days) so availability exists
// from day one — that's what drives request auto-assignment and the family
// date pickers.

import { useRef, useState } from 'react'
import { Users, Upload } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { EmptyState } from '@/components/ui/empty-state'
import { DAY_CHIPS, DAY_TO_DOW, DOW_TO_DAY, type WorkingHours } from '@/lib/facility-options'
import { cn } from '@/lib/utils'
import { StylistTypeahead } from './stylist-typeahead'
import { Card, Field, InlineError, StepIntro, WIZ_INPUT } from './wizard-ui'
import type { CreatedFacility, DirectoryStylist, PickedStylist, WizardCaps, WizardState } from './wizard-types'

interface Props {
  caps: WizardCaps
  facility: CreatedFacility
  hours: WorkingHours
  value: WizardState['stylists']
  onChange: (next: WizardState['stylists']) => void
  error: string | null
  onError: (msg: string | null) => void
}

export function defaultDows(hours: WorkingHours): number[] {
  return DAY_CHIPS.filter((d) => hours.days.includes(d)).map((d) => DAY_TO_DOW[d])
}

function DayChips({ days, onChange }: { days: number[]; onChange: (next: number[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {DAY_CHIPS.map((d) => {
        const dow = DAY_TO_DOW[d]
        const on = days.includes(dow)
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? days.filter((x) => x !== dow) : [...days, dow].sort())}
            className={cn(
              'min-h-[32px] px-2.5 rounded-full text-xs font-semibold border transition-colors',
              on ? 'bg-[#8B2E4A] text-white border-[#8B2E4A]' : 'bg-white text-stone-500 border-stone-200 hover:bg-stone-50',
            )}
          >
            {d}
          </button>
        )
      })}
    </div>
  )
}

export function StepStylists({ caps, facility, hours, value, onChange, error, onError }: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCode, setNewCode] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [directory, setDirectory] = useState<DirectoryStylist[]>(caps.stylistDirectory)

  const pickedIds = new Set(value.picked.map((p) => p.id))

  const pick = (s: DirectoryStylist) => {
    if (pickedIds.has(s.id)) return
    onChange({ ...value, picked: [...value.picked, { ...s, days: defaultDows(hours) }] })
    onError(null)
  }
  const remove = (id: string) => onChange({ ...value, picked: value.picked.filter((p) => p.id !== id) })
  const setDays = (id: string, days: number[]) =>
    onChange({ ...value, picked: value.picked.map((p) => (p.id === id ? { ...p, days } : p)) })

  const openCreate = (typed: string) => {
    setNewName(typed)
    setNewCode('')
    setCreateError(null)
    setCreateOpen(true)
  }

  const createStylist = async () => {
    const name = newName.trim()
    const code = newCode.trim().toUpperCase()
    if (!name) return setCreateError('Enter the stylist’s name')
    if (code && !/^ST\d{3,}$/.test(code)) return setCreateError('Code must look like ST825')
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/stylists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ...(code ? { stylistCode: code } : {}), facilityId: facility.id }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCreateError(
          res.status === 409
            ? `${code || 'That code'} is already in use — that stylist exists. Close this and pick them from the list instead.`
            : typeof j.error === 'string'
              ? j.error
              : 'Could not create the stylist',
        )
        return
      }
      const created = j.data as { id: string; name: string; stylistCode: string; color?: string | null }
      const row: DirectoryStylist = {
        id: created.id,
        name: created.name,
        stylistCode: created.stylistCode,
        color: created.color ?? '#8B2E4A',
        homeFacilityId: facility.id,
      }
      setDirectory((d) => [row, ...d])
      // The create already assigned them here (route inserts the assignment
      // row); keep them in `picked` so the day chips seed availability.
      onChange({ ...value, picked: [...value.picked, { ...row, days: defaultDows(hours) }] })
      setCreateOpen(false)
    } catch {
      setCreateError('Network error — try again')
    } finally {
      setCreating(false)
    }
  }

  const uploadSheet = async (file: File) => {
    setUploading(true)
    onError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('facilityId', facility.id)
      fd.append('defaultDays', JSON.stringify(defaultDows(hours)))
      const res = await fetch('/api/stylists/import', { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        onError(typeof j.error === 'string' ? j.error : 'Could not read that sheet')
        return
      }
      const d = j.data as { imported: number; updated: number; assigned: number; availabilityCreated: number; errors?: { row: number; message: string }[] }
      onChange({
        ...value,
        imported: { imported: d.imported, updated: d.updated, assigned: d.assigned, availabilityCreated: d.availabilityCreated },
      })
      if (d.errors && d.errors.length > 0) {
        onError(`${d.errors.length} row${d.errors.length === 1 ? '' : 's'} skipped — first: row ${d.errors[0].row}: ${d.errors[0].message}`)
      }
    } catch {
      onError('Network error — the sheet was not uploaded')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <>
      <StepIntro
        title="Who works here?"
        blurb="Pick stylists you already have, create new ones, or upload the stylist sheet. You can skip this and staff it later."
      />
      <div className="space-y-5">
        <InlineError message={error} />

        {value.picked.length > 0 ? (
          <Card className="p-0 overflow-hidden" >
            <div className="px-4 py-3 border-b border-stone-100 bg-stone-50/60">
              <p className="text-[11px] text-stone-400 uppercase tracking-wide font-semibold">
                Working at {facility.name} · {value.picked.length}
              </p>
            </div>
            <ul className="divide-y divide-stone-100" data-tour="wizard-stylist-picked">
              {value.picked.map((p: PickedStylist) => (
                <li key={p.id} className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-center gap-3 min-w-0 sm:w-56">
                    <Avatar name={p.name} color={p.color} size="md" />
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-semibold text-stone-900 leading-snug truncate">{p.name}</p>
                      <p className="text-[11.5px] text-stone-500 leading-snug mt-0.5 font-mono">{p.stylistCode}</p>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <DayChips days={p.days} onChange={(days) => setDays(p.id, days)} />
                    {p.days.length === 0 && <p className="text-xs text-amber-700 mt-1">No days — they won’t be auto-assigned requests.</p>}
                  </div>
                  <button type="button" onClick={() => remove(p.id)} className="text-sm text-stone-400 hover:text-red-600 self-start sm:self-center">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        ) : value.imported ? null : (
          <Card>
            <EmptyState
              icon={<Users size={20} />}
              title="No stylists yet"
              description="Families can’t request visits until at least one stylist works here."
            />
          </Card>
        )}

        {value.imported && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Sheet imported — {value.imported.imported} new, {value.imported.updated} updated, {value.imported.assigned} assigned here
            {value.imported.availabilityCreated > 0 ? `, ${value.imported.availabilityCreated} working days set` : ''}.
          </div>
        )}

        <Card className="space-y-3">
          <p className="text-sm font-semibold text-stone-700">Add a stylist</p>
          <StylistTypeahead directory={directory} excludeIds={pickedIds} onPick={pick} onCreateNew={openCreate} inputClassName={WIZ_INPUT} />
        </Card>

        <Card className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <p className="text-sm font-semibold text-stone-700">Have a stylist sheet?</p>
            <p className="text-xs text-stone-500 mt-0.5">
              Upload the exported spreadsheet (.xlsx or .csv). Every row is assigned to {facility.name} with the days above.
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void uploadSheet(f)
            }}
          />
          <Button type="button" variant="secondary" size="lg" loading={uploading} onClick={() => fileRef.current?.click()}>
            <Upload size={16} /> Upload sheet
          </Button>
        </Card>
      </div>

      <Modal open={createOpen} onClose={() => !creating && setCreateOpen(false)} title="New stylist">
        <div className="space-y-4">
          <Field label="Name" htmlFor="new-stylist-name">
            <input
              id="new-stylist-name"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Tatyana Prima"
              autoFocus
              className={WIZ_INPUT}
            />
          </Field>
          <Field label="Stylist code (optional)" htmlFor="new-stylist-code" hint="Leave blank to use the next free ST-code.">
            <input
              id="new-stylist-code"
              type="text"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value.toUpperCase())}
              placeholder="ST833"
              className={`${WIZ_INPUT} font-mono uppercase`}
            />
          </Field>
          {createError && (
            <p role="alert" className="text-sm text-red-600">
              {createError}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button type="button" onClick={createStylist} loading={creating}>
              Create & add
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

export function pickedSummary(picked: PickedStylist[]): string {
  return picked.map((p) => `${p.name} (${p.days.map((d) => DOW_TO_DAY[d]).join(' ') || 'no days'})`).join(', ')
}
