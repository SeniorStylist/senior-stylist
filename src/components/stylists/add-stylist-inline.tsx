'use client'

// "+ Add stylist" affordance on /stylists (round 6 — bookkeeper self-serve).
// Name + optional ST-code, mirroring the directory add form: an explicit code
// is honored (409 on clash), otherwise the next ST### is generated.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'

// P60 — `facilityId` is passed explicitly by the page (it already knows it) so
// a master's create lands at the facility on screen rather than relying on the
// route's cookie resolution alone.
export function AddStylistInline({ facilityId }: { facilityId?: string } = {}) {
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const trimmedName = name.trim()
    const trimmedCode = code.trim().toUpperCase()
    if (!trimmedName) {
      setError('Enter the stylist name')
      return
    }
    if (trimmedCode && !/^ST\d{3,}$/.test(trimmedCode)) {
      setError('Code must look like ST825')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/stylists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          ...(trimmedCode ? { stylistCode: trimmedCode } : {}),
          ...(facilityId ? { facilityId } : {}),
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(
          res.status === 409
            ? trimmedCode
              ? `Code ${trimmedCode} is already in use — that stylist exists; assign them instead of re-creating`
              : typeof j.error === 'string' ? j.error : 'That stylist already exists'
            : typeof j.error === 'string'
              ? j.error
              : 'Could not add the stylist',
        )
        return
      }
      toast.success(`${trimmedName} added`)
      setOpen(false)
      setName('')
      setCode('')
      router.refresh()
    } catch {
      setError('Network error — please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        + Add stylist
      </Button>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-[var(--shadow-sm)] p-4 w-full sm:w-auto">
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null) }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Stylist name"
          className="w-full sm:w-52 px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
        />
        <input
          type="text"
          value={code}
          onChange={(e) => { setCode(e.target.value); setError(null) }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Code (optional, e.g. ST825)"
          className="w-full sm:w-44 px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 font-mono focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
        />
        <div className="flex gap-2">
          <Button size="sm" onClick={submit} disabled={saving || !name.trim()}>
            {saving ? 'Adding…' : 'Add'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setOpen(false); setError(null) }}
            disabled={saving}
          >
            Cancel
          </Button>
        </div>
      </div>
      {error && <p className="text-xs text-red-600 mt-2" role="alert">{error}</p>}
    </div>
  )
}
