'use client'

// P37 — the submitter's view of their feedback + replies from the team.

import { MessageSquare } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'

export interface MyFeedbackItem {
  id: string
  category: string
  message: string
  status: string
  reply: string | null
  repliedAt: string | null
  unread: boolean
  createdAt: string
}

const CATEGORY_CHIP: Record<string, { label: string; cls: string }> = {
  bug: { label: '🐞 Bug', cls: 'bg-red-50 text-red-700 border-red-100' },
  idea: { label: '💡 Idea', cls: 'bg-amber-50 text-amber-700 border-amber-100' },
  praise: { label: '❤️ Love it', cls: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  other: { label: '💬 Other', cls: 'bg-stone-50 text-stone-600 border-stone-200' },
}

const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  new: { label: 'Received', cls: 'bg-stone-50 text-stone-600 border-stone-200' },
  reviewed: { label: 'Being looked at', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  resolved: { label: '✓ Resolved', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function MyFeedbackClient({ items }: { items: MyFeedbackItem[] }) {
  return (
    <div className="page-enter p-4 md:p-6 max-w-3xl mx-auto">
      <PageHeader
        icon={MessageSquare}
        title="My Feedback"
        subtitle="Notes you've sent to the team, and their replies"
      />

      {items.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
              </svg>
            }
            title="No feedback yet"
            description="Use the chat bubble in the corner of any page to send a bug report or idea — replies show up here."
          />
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {items.map((item) => {
            const cat = CATEGORY_CHIP[item.category] ?? CATEGORY_CHIP.other
            const st = STATUS_CHIP[item.status] ?? STATUS_CHIP.new
            return (
              <div
                key={item.id}
                className={`bg-white rounded-2xl border shadow-[var(--shadow-sm)] p-4 ${
                  item.unread ? 'border-[#8B2E4A]/30' : 'border-stone-100'
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className={`text-[10.5px] font-semibold px-2.5 py-1 rounded-full border ${cat.cls}`}>
                    {cat.label}
                  </span>
                  <span className={`text-[10.5px] font-semibold px-2.5 py-1 rounded-full border ${st.cls}`}>
                    {st.label}
                  </span>
                  {item.unread && (
                    <span className="text-[10.5px] font-semibold px-2.5 py-1 rounded-full bg-[#8B2E4A] text-white">
                      New reply
                    </span>
                  )}
                  <span className="text-[11px] text-stone-400 ml-auto">{shortDate(item.createdAt)}</span>
                </div>
                <p className="text-sm text-stone-800 whitespace-pre-wrap leading-relaxed">{item.message}</p>
                {item.reply && (
                  <div className="mt-3 bg-[#F9EFF2] border-l-4 border-[#8B2E4A] rounded-xl px-4 py-3">
                    <p className="text-[10.5px] font-semibold text-[#8B2E4A] uppercase tracking-wide mb-1">
                      Reply from Senior Stylist{item.repliedAt ? ` · ${shortDate(item.repliedAt)}` : ''}
                    </p>
                    <p className="text-sm text-stone-800 whitespace-pre-wrap leading-relaxed">{item.reply}</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
