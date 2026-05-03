'use client'

import Link from 'next/link'
import { EmptyState } from '@/components/ui/empty-state'

export interface SourceCardData {
  sourceType: string
  title: string
  description: string
  format: 'XLSX' | 'CSV'
  href: string
  lastImportedAt: string | null
  totalCount: number
  needsReviewCount: number
}

const SpreadsheetIcon = (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2a4 4 0 014-4h6m-6 0V7a4 4 0 00-4-4H5a2 2 0 00-2 2v14a2 2 0 002 2h6m4-6h4m0 0l-2-2m2 2l-2 2" />
  </svg>
)
const UsersIcon = (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
  </svg>
)
const ReceiptIcon = (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z" />
  </svg>
)
const BuildingIcon = (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
  </svg>
)
const ClipboardIcon = (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
  </svg>
)

const ICONS: Record<string, React.ReactNode> = {
  service_log: SpreadsheetIcon,
  qb_customer: UsersIcon,
  qb_billing: ReceiptIcon,
  facility_csv: BuildingIcon,
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function ImportsHubClient({ cards }: { cards: SourceCardData[] }) {
  return (
    <div className="page-enter min-h-screen bg-stone-50 p-6">
      <div className="max-w-5xl mx-auto">
        <Link
          href="/master-admin"
          className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-700 mb-6"
        >
          <span>←</span> Back to Master Admin
        </Link>

        <h1
          className="text-2xl font-normal text-stone-900 mb-1"
          style={{ fontFamily: "'DM Serif Display', serif", color: '#8B2E4A' }}
        >
          Imports
        </h1>
        <p className="text-sm text-stone-500 mb-8">
          Manage all data imports into Senior Stylist.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cards.map((card) => (
            <Link
              key={card.sourceType}
              href={card.href}
              className="group bg-white rounded-2xl shadow-[var(--shadow-sm)] p-5 hover:shadow-[var(--shadow-md)] hover:-translate-y-[2px] transition-[transform,box-shadow] duration-[160ms] ease-[cubic-bezier(0.25,0.46,0.45,0.94)] block"
            >
              <div className="flex items-start gap-4">
                <div className="shrink-0 w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center text-[#8B2E4A]">
                  {ICONS[card.sourceType] ?? SpreadsheetIcon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-semibold text-stone-900">{card.title}</h3>
                    <span className="text-[10.5px] font-semibold px-2.5 py-0.5 rounded-full bg-stone-100 text-stone-600">
                      {card.format}
                    </span>
                    {card.needsReviewCount > 0 && (
                      <span className="text-[10.5px] font-semibold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700">
                        {card.needsReviewCount} need review
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-stone-500 leading-relaxed mb-3">
                    {card.description}
                  </p>
                  <div className="flex items-center justify-between text-[11.5px] text-stone-400">
                    <span>
                      Last imported: <span className="text-stone-600 font-medium">{formatTimestamp(card.lastImportedAt)}</span>
                      {card.totalCount > 0 && (
                        <> · <span className="text-stone-600 font-medium">{card.totalCount}</span> total</>
                      )}
                    </span>
                    <span className="text-[#8B2E4A] font-semibold group-hover:translate-x-0.5 transition-transform">
                      Import →
                    </span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mt-10 mb-3">
          Needs Review
        </h2>
        <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)]">
          <EmptyState
            icon={ClipboardIcon}
            title="Coming soon"
            description="The reconciliation queue lands in Phase 12C."
          />
        </div>
      </div>
    </div>
  )
}
