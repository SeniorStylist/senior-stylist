'use client'

// "Bookkeeper-added services" panel for the /services page. Lists ad-hoc services
// bookkeepers created while logging (source='ocr_import') — which are hidden from
// families/staff/scheduling — and lets an admin promote one into the real price
// list. Renders nothing when there are none, so it never clutters the page.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUpCircle, ChevronDown } from 'lucide-react'
import { useToast } from '@/components/ui/toast'

interface AdhocService {
  id: string
  name: string
  priceCents: number
  source?: string
}

export function AdhocServicesPanel() {
  const router = useRouter()
  const { toast } = useToast()
  const [items, setItems] = useState<AdhocService[]>([])
  const [open, setOpen] = useState(false)
  const [promotingId, setPromotingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/services?includeAdhoc=1')
        const j = await res.json().catch(() => ({}))
        if (cancelled || !res.ok) return
        setItems((j.data ?? []).filter((s: AdhocService) => s.source === 'ocr_import'))
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (items.length === 0) return null

  async function promote(id: string) {
    setPromotingId(id)
    try {
      const res = await fetch(`/api/services/${id}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (res.ok) {
        setItems((prev) => prev.filter((s) => s.id !== id))
        toast.success('Promoted to the price list — set its price in the list above')
        router.refresh()
      } else {
        const j = await res.json().catch(() => ({}))
        toast.error(j.error || 'Could not promote')
      }
    } finally {
      setPromotingId(null)
    }
  }

  return (
    <div className="mt-8 rounded-2xl border border-stone-100 bg-white shadow-[var(--shadow-sm)]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <span className="text-sm font-semibold text-stone-700">
          Bookkeeper-added services <span className="text-stone-400">({items.length})</span>
        </span>
        <ChevronDown size={16} className={`text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-5 pb-5">
          <p className="text-xs text-stone-500 mb-3">
            These were created while logging from scanned sheets. They&apos;re only visible on the
            scan review and daily log — not to families or staff. Promote one to add it to the real
            price list.
          </p>
          <ul className="space-y-2">
            {items.map((s) => (
              <li key={s.id} className="flex items-center justify-between rounded-xl border border-stone-100 px-3 py-2.5">
                <span className="text-sm font-medium text-stone-900">{s.name}</span>
                <button
                  onClick={() => promote(s.id)}
                  disabled={promotingId === s.id}
                  className="inline-flex items-center gap-1 text-sm font-semibold text-[#8B2E4A] disabled:opacity-50"
                >
                  <ArrowUpCircle size={15} />
                  {promotingId === s.id ? 'Promoting…' : 'Promote to price list'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
