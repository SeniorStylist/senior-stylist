'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { useToast } from '@/components/ui/toast'
import { EmptyState } from '@/components/ui/empty-state'

export interface BatchRow {
  id: string
  fileName: string
  sourceType: string
  rowCount: number
  matchedCount: number
  unresolvedCount: number
  createdAt: string | null
  facility: { name: string } | null
  stylist: { name: string } | null
}

const SOURCE_LABEL: Record<string, string> = {
  service_log: 'Service Log',
  qb_billing: 'QB Billing',
  qb_customer: 'QB Customer',
  facility_csv: 'Facility CSV',
}

const ClipboardIcon = (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
  </svg>
)

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function BatchHistory({ initialBatches }: { initialBatches: BatchRow[] }) {
  const [batches, setBatches] = useState<BatchRow[]>(initialBatches)
  const [confirmBatch, setConfirmBatch] = useState<BatchRow | null>(null)
  const [rollingBack, setRollingBack] = useState(false)
  const { toast } = useToast()

  async function rollback(batch: BatchRow) {
    setRollingBack(true)
    try {
      const res = await fetch(`/api/super-admin/import-batches/${batch.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Rollback failed')
      setBatches((prev) => prev.filter((b) => b.id !== batch.id))
      toast.success(`Rolled back ${json.data?.bookingsDeactivated ?? 0} bookings.`)
      setConfirmBatch(null)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setRollingBack(false)
    }
  }

  if (batches.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)]">
        <EmptyState
          icon={ClipboardIcon}
          title="No imports yet"
          description="Imports will appear here once you upload a service log or QB CSV."
        />
      </div>
    )
  }

  return (
    <>
      <div className="rounded-[18px] bg-white shadow-[var(--shadow-sm)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50/60">
              <tr>
                <Th>Date</Th>
                <Th>File</Th>
                <Th>Source</Th>
                <Th>Facility</Th>
                <Th>Stylist</Th>
                <Th align="right">Rows</Th>
                <Th align="right">Matched</Th>
                <Th align="right">Unresolved</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-t border-stone-100 hover:bg-[#F9EFF2] transition-colors duration-[120ms] ease-out">
                  <Td>{formatDate(b.createdAt)}</Td>
                  <Td>
                    <span className="text-stone-800 font-mono text-xs truncate max-w-[14rem] inline-block align-middle" title={b.fileName}>
                      {b.fileName}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-[10.5px] font-semibold px-2.5 py-0.5 rounded-full bg-stone-100 text-stone-600">
                      {SOURCE_LABEL[b.sourceType] ?? b.sourceType}
                    </span>
                  </Td>
                  <Td>{b.facility?.name ?? '—'}</Td>
                  <Td>{b.stylist?.name ?? '—'}</Td>
                  <Td align="right">{b.rowCount.toLocaleString()}</Td>
                  <Td align="right">
                    <span className="text-emerald-700 font-semibold">{b.matchedCount.toLocaleString()}</span>
                  </Td>
                  <Td align="right">
                    {b.unresolvedCount > 0 ? (
                      <span className="text-amber-700 font-semibold">{b.unresolvedCount.toLocaleString()}</span>
                    ) : (
                      <span className="text-stone-400">0</span>
                    )}
                  </Td>
                  <Td align="right">
                    <button
                      type="button"
                      onClick={() => setConfirmBatch(b)}
                      className="text-xs font-semibold text-red-600 hover:text-red-700 hover:bg-red-50 px-2.5 py-1 rounded-lg transition-colors"
                    >
                      Rollback
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={confirmBatch !== null} onClose={() => !rollingBack && setConfirmBatch(null)} title="Rollback import?">
        {confirmBatch && (
          <div className="px-6 py-5">
            <p className="text-sm text-stone-700 mb-4">
              This will soft-delete all <span className="font-semibold">{confirmBatch.rowCount.toLocaleString()}</span> bookings from this import and remove the batch record. Residents and services created during this import will <span className="font-semibold">not</span> be removed. This cannot be undone automatically.
            </p>
            <div className="rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-600 mb-5 font-mono break-words">
              {confirmBatch.fileName}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmBatch(null)}
                disabled={rollingBack}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-stone-600 border border-stone-200 hover:bg-stone-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => rollback(confirmBatch)}
                disabled={rollingBack}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {rollingBack ? 'Rolling back…' : 'Rollback import'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}

function Th({ children, align = 'left' }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`px-4 py-3 text-[11px] font-semibold text-stone-400 uppercase tracking-wide ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

function Td({ children, align = 'left' }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <td className={`px-4 py-3 text-stone-700 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </td>
  )
}
