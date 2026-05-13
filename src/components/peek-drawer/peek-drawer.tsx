'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { setPeekHandler, type PeekTarget } from '@/lib/peek-drawer'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast'
import { formatDateInTz } from '@/lib/time'
import { getInitials } from '@/lib/get-initials'

interface ResidentPeekData {
  type: 'resident'
  facilityTimezone: string
  resident: {
    id: string
    name: string
    roomNumber: string | null
    facilityName: string
    poaName: string | null
    poaPhone: string | null
    poaEmail: string | null
    lastVisits: Array<{ startTime: string; serviceName: string; stylistName: string }>
    nextVisit: { startTime: string; serviceName: string; stylistName: string } | null
  }
}

interface StylistPeekData {
  type: 'stylist'
  facilityTimezone: string
  stylist: {
    id: string
    name: string
    stylistCode: string
    facilityName: string
    status: string
    availableDays: string[]
    todayCount: number
    weekCount: number
  }
}

type PeekData = ResidentPeekData | StylistPeekData

interface PeekDrawerProps {
  role: string
  isMaster: boolean
}

const SHORT_DATE: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
const LONG_DATE: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }

export function PeekDrawer({ role, isMaster }: PeekDrawerProps) {
  const router = useRouter()
  const { toast } = useToast()
  const isMobile = useIsMobile()

  const [target, setTarget] = useState<PeekTarget | null>(null)
  const [data, setData] = useState<PeekData | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Register module-level open handler once on mount.
  useEffect(() => {
    setPeekHandler((next) => {
      if (clearTimerRef.current) {
        clearTimeout(clearTimerRef.current)
        clearTimerRef.current = null
      }
      setData(null)
      setLoading(true)
      setTarget(next)
      setOpen(true)
    })
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
    clearTimerRef.current = setTimeout(() => {
      setTarget(null)
      setData(null)
      setLoading(false)
      clearTimerRef.current = null
    }, 300)
  }, [])

  // Fetch when target changes.
  useEffect(() => {
    if (!target) return
    const ctrl = new AbortController()
    fetch(`/api/peek?type=${target.type}&id=${encodeURIComponent(target.id)}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          toast.error(body.error ?? 'Could not load profile')
          close()
          return
        }
        const body = (await res.json()) as { data: PeekData }
        setData(body.data)
        setLoading(false)
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return
        toast.error('Could not load profile')
        close()
      })
    return () => ctrl.abort()
  }, [target, toast, close])

  // Escape key for desktop drawer (BottomSheet handles its own escape).
  useEffect(() => {
    if (!open || isMobile) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, isMobile, close])

  const content = renderContent({ data, loading, role, isMaster, router, close })

  if (typeof document === 'undefined') return null

  const ui = isMobile ? (
    <BottomSheet isOpen={open} onClose={close}>
      {content}
    </BottomSheet>
  ) : (
    <>
      <div
        onClick={close}
        className="fixed inset-0 z-[79] bg-black/20 transition-opacity duration-[260ms]"
        style={{
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
        }}
        aria-hidden={!open}
      />
      <aside
        className="fixed right-0 top-0 h-full w-[380px] max-w-[92vw] bg-white z-[80] overflow-y-auto"
        style={{
          boxShadow: '-4px 0 24px rgba(0,0,0,0.08)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 260ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        }}
        aria-hidden={!open}
      >
        <button
          type="button"
          onClick={close}
          className="absolute top-3 right-3 w-9 h-9 rounded-full flex items-center justify-center text-stone-400 hover:bg-stone-100 transition-colors"
          aria-label="Close"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
        {content}
      </aside>
    </>
  )

  // Phase 12Y — portal to body so .main-content's transform-induced containing
  // block doesn't constrain the drawer/backdrop to the scroll area.
  return createPortal(ui, document.body)
}

function renderContent({
  data,
  loading,
  role,
  isMaster,
  router,
  close,
}: {
  data: PeekData | null
  loading: boolean
  role: string
  isMaster: boolean
  router: ReturnType<typeof useRouter>
  close: () => void
}) {
  if (loading || !data) return <LoadingState />

  if (data.type === 'resident') {
    const r = data.resident
    const tz = data.facilityTimezone
    const canViewFullProfile = role !== 'stylist'
    return (
      <div className="p-5 flex flex-col gap-4">
        <div className="flex items-center gap-3 pr-10">
          <div className="w-12 h-12 rounded-full bg-[#F9EFF2] flex items-center justify-center text-[#8B2E4A] font-semibold text-lg shrink-0">
            {getInitials(r.name)}
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-stone-900 truncate">{r.name}</h2>
            <p className="text-sm text-stone-500 truncate">
              {r.roomNumber ? `Room ${r.roomNumber} · ` : ''}{r.facilityName}
            </p>
          </div>
        </div>

        {r.poaName && (
          <div className="rounded-xl bg-stone-50 px-4 py-3">
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-1">POA Contact</p>
            <p className="text-sm font-medium text-stone-900">{r.poaName}</p>
            {r.poaPhone && <p className="text-sm text-stone-500">{r.poaPhone}</p>}
            {r.poaEmail && <p className="text-sm text-stone-500 break-all">{r.poaEmail}</p>}
          </div>
        )}

        {r.lastVisits.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-2">Recent Visits</p>
            <div className="space-y-2">
              {r.lastVisits.map((v, i) => (
                <div key={i} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-stone-700 truncate">{v.serviceName}</span>
                  <span className="text-stone-400 text-xs shrink-0">{formatDateInTz(v.startTime, tz, SHORT_DATE)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {r.nextVisit && (
          <div className="rounded-xl bg-[#F9EFF2] px-4 py-3">
            <p className="text-xs font-semibold text-[#8B2E4A] uppercase tracking-wide mb-1">Next Visit</p>
            <p className="text-sm font-medium text-stone-900">{r.nextVisit.serviceName}</p>
            <p className="text-sm text-stone-500">{formatDateInTz(r.nextVisit.startTime, tz, LONG_DATE)}</p>
          </div>
        )}

        {canViewFullProfile && (
          <button
            type="button"
            onClick={() => {
              router.push(`/residents/${r.id}`)
              close()
            }}
            className="w-full py-2.5 rounded-xl bg-[#8B2E4A] text-white text-sm font-semibold hover:bg-[#72253C] transition-colors"
          >
            View Full Profile →
          </button>
        )}
      </div>
    )
  }

  const s = data.stylist
  const canViewFullProfile = role === 'admin' || role === 'bookkeeper' || isMaster
  return (
    <div className="p-5 flex flex-col gap-4">
      <div className="flex items-center gap-3 pr-10">
        <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center text-stone-600 font-semibold text-lg shrink-0">
          {getInitials(s.name)}
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-stone-900 truncate">{s.name}</h2>
          <p className="text-sm text-stone-500 truncate">
            <span className="font-mono">{s.stylistCode}</span> · {s.facilityName}
          </p>
        </div>
      </div>

      <div>
        <span
          className={
            'px-2.5 py-1 rounded-full text-xs font-semibold ' +
            (s.status === 'active'
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-stone-100 text-stone-500')
          }
        >
          {s.status}
        </span>
      </div>

      {s.availableDays.length > 0 && (
        <div className="rounded-xl bg-stone-50 px-4 py-3">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-1">Works</p>
          <p className="text-sm text-stone-700">{s.availableDays.join(', ')}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-stone-50 px-4 py-3 text-center">
          <p className="text-2xl font-bold text-stone-900">{s.todayCount}</p>
          <p className="text-xs text-stone-500 mt-0.5">Today</p>
        </div>
        <div className="rounded-xl bg-stone-50 px-4 py-3 text-center">
          <p className="text-2xl font-bold text-stone-900">{s.weekCount}</p>
          <p className="text-xs text-stone-500 mt-0.5">This week</p>
        </div>
      </div>

      {canViewFullProfile && (
        <button
          type="button"
          onClick={() => {
            router.push(`/stylists/${s.id}`)
            close()
          }}
          className="w-full py-2.5 rounded-xl bg-[#8B2E4A] text-white text-sm font-semibold hover:bg-[#72253C] transition-colors"
        >
          View Full Profile →
        </button>
      )}
    </div>
  )
}

function LoadingState() {
  return (
    <div className="p-5 flex flex-col gap-4">
      <div className="flex items-center gap-3 pr-10">
        <Skeleton className="w-12 h-12 rounded-full shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-40 rounded" />
          <Skeleton className="h-4 w-28 rounded" />
        </div>
      </div>
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-10 w-full rounded-xl" />
    </div>
  )
}
