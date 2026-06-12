'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useToast } from '@/components/ui/toast'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'

interface FeedbackRow {
  id: string
  category: string
  message: string
  status: string
  role: string | null
  pagePath: string | null
  createdAt: string
  senderName: string
  facilityName: string | null
}

const CATEGORY_CHIP: Record<string, { label: string; cls: string }> = {
  bug: { label: '🐞 Bug', cls: 'bg-red-50 text-red-700 border-red-100' },
  idea: { label: '💡 Idea', cls: 'bg-amber-50 text-amber-700 border-amber-100' },
  praise: { label: '❤️ Praise', cls: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  other: { label: '💬 Other', cls: 'bg-stone-50 text-stone-600 border-stone-200' },
}

const STATUSES = ['new', 'reviewed', 'resolved'] as const

export function FeedbackClient() {
  const { toast } = useToast()
  const [rows, setRows] = useState<FeedbackRow[] | null>(null)
  const [filter, setFilter] = useState<'all' | 'new' | 'reviewed' | 'resolved'>('all')

  useEffect(() => {
    fetch('/api/feedback')
      .then((r) => r.json())
      .then((json) => setRows(Array.isArray(json.data) ? json.data : []))
      .catch(() => {
        setRows([])
        toast.error('Could not load feedback')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setStatus = async (id: string, status: string) => {
    const prev = rows
    setRows((rs) => (rs ?? []).map((r) => (r.id === id ? { ...r, status } : r)))
    const res = await fetch(`/api/feedback/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }).catch(() => null)
    if (!res || !res.ok) {
      setRows(prev)
      toast.error('Failed to update status')
    }
  }

  const visible = (rows ?? []).filter((r) => filter === 'all' || r.status === filter)
  const newCount = (rows ?? []).filter((r) => r.status === 'new').length

  return (
    <div className="page-enter p-4 md:p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-normal text-stone-900" style={{ fontFamily: "'DM Serif Display', serif" }}>
          User Feedback
        </h1>
        <Link href="/master-admin" className="text-xs font-semibold text-[#8B2E4A] hover:underline">
          ← Master Admin
        </Link>
      </div>
      <p className="text-sm text-stone-500 mb-5">
        {rows === null ? 'Loading…' : `${rows.length} submission${rows.length === 1 ? '' : 's'}${newCount > 0 ? ` · ${newCount} new` : ''}`}
      </p>

      <div className="flex gap-1.5 mb-4">
        {(['all', ...STATUSES] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors capitalize ${
              filter === s
                ? 'bg-[#8B2E4A] text-white border-[#8B2E4A]'
                : 'bg-white text-stone-600 border-stone-200 hover:border-stone-300'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {rows === null ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
            </svg>
          }
          title={filter === 'all' ? 'No feedback yet' : `No ${filter} feedback`}
          description="Submissions from the in-app feedback widget appear here."
        />
      ) : (
        <div className="space-y-3">
          {visible.map((r) => {
            const chip = CATEGORY_CHIP[r.category] ?? CATEGORY_CHIP.other
            return (
              <div
                key={r.id}
                className={`bg-white rounded-2xl border shadow-[var(--shadow-sm)] p-4 ${
                  r.status === 'new' ? 'border-[#8B2E4A]/20' : 'border-stone-100'
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className={`text-[10.5px] font-semibold px-2.5 py-1 rounded-full border ${chip.cls}`}>
                    {chip.label}
                  </span>
                  <span className="text-xs font-semibold text-stone-700">{r.senderName}</span>
                  {r.role && <span className="text-[11px] text-stone-400 capitalize">{r.role.replace('_', ' ')}</span>}
                  {r.facilityName && <span className="text-[11px] text-stone-400">· {r.facilityName}</span>}
                  <span className="text-[11px] text-stone-400 ml-auto">
                    {new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
                <p className="text-sm text-stone-800 whitespace-pre-wrap leading-relaxed">{r.message}</p>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-[11px] text-stone-400 font-mono">{r.pagePath ?? ''}</span>
                  <select
                    value={r.status}
                    onChange={(e) => setStatus(r.id, e.target.value)}
                    className="text-xs bg-stone-50 border border-stone-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#8B2E4A] capitalize"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
