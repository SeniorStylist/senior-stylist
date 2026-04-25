'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useTransition } from 'react'

interface Props {
  facilityCode: string
  facilityName: string
  residents: { residentId: string; residentName: string }[]
}

export function PortalHeader({ facilityCode, facilityName, residents }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const currentResidentId = search.get('residentId') ?? residents[0]?.residentId ?? ''

  const onResidentChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const params = new URLSearchParams(search.toString())
    params.set('residentId', e.target.value)
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`)
    })
  }

  const onSignOut = async () => {
    try {
      await fetch('/api/portal/logout', { method: 'POST' })
    } catch {
      // best-effort
    }
    window.location.href = `/family/${encodeURIComponent(facilityCode)}/login`
  }

  return (
    <div className="relative z-10 flex items-center gap-2 text-white">
      {residents.length > 1 ? (
        <select
          value={currentResidentId}
          onChange={onResidentChange}
          disabled={isPending}
          className="text-xs font-semibold bg-white/15 hover:bg-white/25 text-white rounded-full px-3 py-1.5 border border-white/20 focus:outline-none focus:ring-2 focus:ring-white/40"
          style={{ colorScheme: 'dark' }}
          aria-label="Switch resident"
        >
          {residents.map((r) => (
            <option key={r.residentId} value={r.residentId} className="text-stone-800">
              {r.residentName}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-xs text-white/80 truncate max-w-[140px]" title={facilityName}>
          {facilityName}
        </span>
      )}
      <button
        type="button"
        onClick={onSignOut}
        className="text-xs font-semibold text-white/85 hover:text-white px-2 py-1.5"
      >
        Sign out
      </button>
    </div>
  )
}
