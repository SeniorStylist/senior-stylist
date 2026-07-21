'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useToast } from '@/components/ui/toast'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'

interface FeedbackMeta {
  viewport?: string
  screen?: string
  dpr?: number
  timezone?: string
  language?: string
  standalone?: boolean
  online?: boolean
}

interface FeedbackRow {
  id: string
  category: string
  message: string
  status: string
  role: string | null
  pagePath: string | null
  meta: FeedbackMeta | null
  createdAt: string
  senderName: string
  facilityName: string | null
  // P37 — two-way replies
  reply: string | null
  repliedAt: string | null
  replyReadAt: string | null
}

function metaSummary(meta: FeedbackMeta | null): string | null {
  if (!meta) return null
  const parts: string[] = []
  if (meta.viewport) parts.push(meta.viewport)
  if (meta.standalone) parts.push('PWA')
  if (meta.timezone) parts.push(meta.timezone)
  if (meta.language) parts.push(meta.language)
  if (meta.online === false) parts.push('offline')
  return parts.length > 0 ? parts.join(' · ') : null
}

const CATEGORY_CHIP: Record<string, { label: string; cls: string }> = {
  bug: { label: '🐞 Bug', cls: 'bg-red-50 text-red-700 border-red-100' },
  idea: { label: '💡 Idea', cls: 'bg-amber-50 text-amber-700 border-amber-100' },
  praise: { label: '❤️ Praise', cls: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  other: { label: '💬 Other', cls: 'bg-stone-50 text-stone-600 border-stone-200' },
}

const STATUSES = ['new', 'reviewed', 'resolved'] as const

function EmailSettingsCard() {
  const { toast } = useToast()
  const [email, setEmail] = useState('')
  const [saved, setSaved] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/feedback/settings')
      .then((r) => r.json())
      .then((j) => {
        const v = j.data?.feedbackEmail ?? ''
        setEmail(v)
        setSaved(v)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/feedback/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedbackEmail: email.trim() || null }),
      })
      if (!res.ok) { toast.error('Failed to save email'); return }
      setSaved(email.trim())
      toast.success('Notification email saved')
    } catch {
      toast.error('Failed to save email')
    } finally {
      setSaving(false)
    }
  }

  const isDirty = email.trim() !== saved

  return (
    <div className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-4 mb-6">
      <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1">Notification Email</p>
      <p className="text-xs text-stone-400 mb-3">
        New feedback submissions are emailed here. Leave blank to use the default master admin address.
      </p>
      {loading ? (
        <div className="h-9 rounded-xl bg-stone-100 animate-pulse w-full max-w-sm" />
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com (optional)"
            className="flex-1 min-w-0 max-w-sm px-3 py-2 rounded-xl border border-stone-200 text-sm bg-stone-50 focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]/50 focus:bg-white transition-all"
          />
          <button
            type="button"
            onClick={save}
            disabled={!isDirty || saving}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 shadow-[0_2px_6px_rgba(139,46,74,0.18)] hover:-translate-y-[1px] disabled:shadow-none disabled:translate-y-0"
            style={{ backgroundColor: '#8B2E4A' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  )
}

export function FeedbackClient() {
  const { toast } = useToast()
  const [rows, setRows] = useState<FeedbackRow[] | null>(null)
  const [filter, setFilter] = useState<'all' | 'new' | 'reviewed' | 'resolved'>('all')
  // P37 — reply composer: which row is open + its draft text
  const [replyingId, setReplyingId] = useState<string | null>(null)
  const [replyDraft, setReplyDraft] = useState('')
  const [sendingReply, setSendingReply] = useState(false)

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

  // P37 — send a reply; a reply to a 'new' item also flips it to 'reviewed'.
  const sendReply = async (row: FeedbackRow) => {
    const reply = replyDraft.trim()
    if (!reply || sendingReply) return
    setSendingReply(true)
    const prev = rows
    const statusAfter = row.status === 'new' ? 'reviewed' : row.status
    setRows((rs) =>
      (rs ?? []).map((r) =>
        r.id === row.id ? { ...r, reply, repliedAt: new Date().toISOString(), status: statusAfter } : r,
      ),
    )
    try {
      const res = await fetch(`/api/feedback/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply, ...(row.status === 'new' ? { status: 'reviewed' } : {}) }),
      })
      if (!res.ok) throw new Error()
      setReplyingId(null)
      setReplyDraft('')
      toast.success('Reply sent — they\'ll get a notification')
    } catch {
      setRows(prev)
      toast.error('Failed to send reply')
    } finally {
      setSendingReply(false)
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

      <EmailSettingsCard />

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

                {/* P37 — existing reply (with read receipt) */}
                {r.reply && replyingId !== r.id && (
                  <div className="mt-3 bg-[#F9EFF2] border-l-4 border-[#8B2E4A] rounded-xl px-4 py-3">
                    <p className="text-[10.5px] font-semibold text-[#8B2E4A] uppercase tracking-wide mb-1">
                      Your reply
                      {r.repliedAt
                        ? ` · ${new Date(r.repliedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                        : ''}
                      {r.replyReadAt ? ' · ✓ seen' : ' · not seen yet'}
                    </p>
                    <p className="text-sm text-stone-800 whitespace-pre-wrap leading-relaxed">{r.reply}</p>
                  </div>
                )}

                {/* P37 — reply composer */}
                {replyingId === r.id && (
                  <div className="mt-3 space-y-2">
                    <textarea
                      autoFocus
                      value={replyDraft}
                      onChange={(e) => setReplyDraft(e.target.value.slice(0, 2000))}
                      rows={3}
                      placeholder="e.g. Fixed! Try scanning your sheet again — it should work now."
                      className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all resize-none"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => { setReplyingId(null); setReplyDraft('') }}
                        className="text-xs font-semibold text-stone-500 hover:text-stone-700 px-3 py-2"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => sendReply(r)}
                        disabled={!replyDraft.trim() || sendingReply}
                        className="text-xs font-semibold text-white bg-[#8B2E4A] hover:bg-[#72253C] rounded-xl px-4 py-2 disabled:opacity-50 transition-colors"
                      >
                        {sendingReply ? 'Sending…' : 'Send reply'}
                      </button>
                    </div>
                    <p className="text-[10.5px] text-stone-400">
                      They&apos;ll get an in-app notification, a push, and an email copy.
                    </p>
                  </div>
                )}

                <div className="flex items-center justify-between mt-3 gap-3">
                  <div className="min-w-0">
                    <span className="block text-[11px] text-stone-400 font-mono truncate">{r.pagePath ?? ''}</span>
                    {metaSummary(r.meta) && (
                      <span className="block text-[10.5px] text-stone-400 truncate">{metaSummary(r.meta)}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {replyingId !== r.id && (
                      <button
                        type="button"
                        onClick={() => { setReplyingId(r.id); setReplyDraft('') }}
                        className="text-xs font-semibold text-[#8B2E4A] border border-[#D4A0B0] bg-[#F9EFF2] hover:bg-[#F2E0E6] rounded-lg px-3 py-1.5 transition-colors"
                      >
                        {r.reply ? 'Reply again' : 'Reply…'}
                      </button>
                    )}
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
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
