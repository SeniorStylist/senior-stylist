'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { DefaultTipPicker, type DefaultTipValue } from '@/components/residents/default-tip-picker'

interface ResidentRow {
  id: string
  name: string
  roomNumber: string | null
  defaultTipType: string | null
  defaultTipValue: number | null
}

interface Props {
  residents: ResidentRow[]
  facilityCode: string
}

export function ProfileClient({ residents }: Props) {
  return (
    <div className="px-4 py-6 max-w-[640px] mx-auto pb-32">
      <h1
        className="text-2xl font-normal text-stone-900 mb-1"
        style={{ fontFamily: "'DM Serif Display', serif" }}
      >
        Profile
      </h1>
      <p className="text-sm text-stone-500 mb-6">Tip preferences for the residents you support.</p>

      {residents.length === 0 ? (
        <p className="text-sm text-stone-500">No residents linked to this account.</p>
      ) : (
        <div className="space-y-4">
          {residents.map((r) => (
            <ResidentCard key={r.id} resident={r} />
          ))}
        </div>
      )}
    </div>
  )
}

function ResidentCard({ resident }: { resident: ResidentRow }) {
  const { toast } = useToast()
  const [tip, setTip] = useState<DefaultTipValue>({
    type: (resident.defaultTipType as 'percentage' | 'fixed' | null) ?? null,
    value: resident.defaultTipValue ?? null,
  })
  const [saving, setSaving] = useState(false)

  const initialTip: DefaultTipValue = {
    type: (resident.defaultTipType as 'percentage' | 'fixed' | null) ?? null,
    value: resident.defaultTipValue ?? null,
  }
  const dirty = tip.type !== initialTip.type || tip.value !== initialTip.value

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/portal/residents/${resident.id}/tip-default`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultTipType: tip.type, defaultTipValue: tip.value }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success('Saved')
        // Mutate the local "initial" baseline by reassigning resident in place
        resident.defaultTipType = tip.type
        resident.defaultTipValue = tip.value
      } else {
        toast.error(j.error ?? 'Failed to save')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)]">
      <div className="mb-4">
        <p className="text-base font-semibold text-stone-900">{resident.name}</p>
        {resident.roomNumber && <p className="text-xs text-stone-500">Room {resident.roomNumber}</p>}
      </div>

      <DefaultTipPicker value={tip} onChange={setTip} disabled={saving} />

      <div className="mt-4 flex justify-end">
        <Button onClick={handleSave} disabled={!dirty || saving} variant="primary">
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
