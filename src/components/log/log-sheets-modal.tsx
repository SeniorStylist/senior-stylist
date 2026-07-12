'use client'

import { useState, useEffect, useCallback } from 'react'
import { Modal } from '@/components/ui/modal'
import { useToast } from '@/components/ui/toast'

interface SheetBatch {
  id: string
  facilityId: string
  facilityName: string | null
  facilityCode: string | null
  fileName: string
  sourceType: string
  rowCount: number
  createdAt: string
  deletedAt: string | null
  uploaderName: string | null
}

interface FacilityOption {
  id: string
  name: string
  facilityCode?: string | null
}

interface LogSheetsModalProps {
  open: boolean
  onClose: () => void
  role?: string
  isMasterAdmin?: boolean
  // Cross-facility target list for the Move action. REQUIRED for bookkeeper/master:
  // they have no facility_users rows beyond their anchor facility, so the
  // GET /api/facilities fallback returns only that one row and the Move picker
  // can never offer a destination (bookkeeper report 2026-07-12). The /log page
  // already computes the full active-facility list (exportFacilities) — pass it in.
  facilities?: FacilityOption[]
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

type ActiveAction =
  | { batchId: string; type: 'delete' }
  | { batchId: string; type: 'move' }
  | { batchId: string; type: 'rename' }
  | null

export function LogSheetsModal({ open, onClose, role, isMasterAdmin, facilities: facilitiesProp }: LogSheetsModalProps) {
  const { toast } = useToast()
  const [batches, setBatches] = useState<SheetBatch[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')

  const [activeAction, setActiveAction] = useState<ActiveAction>(null)
  const [actionLoading, setActionLoading] = useState(false)

  // Rename state
  const [renameValue, setRenameValue] = useState('')

  // Move state — seeded from the prop when provided (bookkeeper/master get the full
  // cross-facility list from the /log page); the fetch below is a fallback only.
  const [facilities, setFacilities] = useState<FacilityOption[]>(facilitiesProp ?? [])
  const [facilitySearch, setFacilitySearch] = useState('')
  const [targetFacilityId, setTargetFacilityId] = useState('')

  const canMove = isMasterAdmin || role === 'bookkeeper'

  const fetchBatches = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/log/import-batches')
      const json = await res.json()
      if (res.ok) setBatches(json.data ?? [])
      else toast.error(json.error ?? 'Failed to load sheet history')
    } finally {
      setLoading(false)
    }
  }, [toast])

  const fetchFacilities = useCallback(async () => {
    if (facilities.length > 0) return
    // Fallback when no prop was passed. NOTE: /api/facilities returns only the
    // caller's membership facilities — fine for admins (own facility), wrong for
    // bookkeepers (single anchor row). Bookkeeper/master callers must pass the
    // `facilities` prop instead.
    const res = await fetch('/api/facilities')
    const json = await res.json()
    if (res.ok) setFacilities(json.data ?? [])
  }, [facilities.length])

  useEffect(() => {
    if (open) {
      fetchBatches()
      setFilter('')
      setActiveAction(null)
    }
  }, [open, fetchBatches])

  const filtered = batches.filter((b) => {
    const q = filter.toLowerCase()
    return (
      !q ||
      (b.facilityName ?? '').toLowerCase().includes(q) ||
      (b.facilityCode ?? '').toLowerCase().includes(q) ||
      b.fileName.toLowerCase().includes(q)
    )
  })

  const startAction = (batchId: string, type: 'delete' | 'move' | 'rename') => {
    const batch = batches.find((b) => b.id === batchId)
    if (!batch) return
    setActiveAction({ batchId, type })
    if (type === 'rename') setRenameValue(batch.facilityName ?? '')
    if (type === 'move') {
      setTargetFacilityId('')
      setFacilitySearch('')
      fetchFacilities()
    }
  }

  const cancelAction = () => setActiveAction(null)

  const handleDelete = async (batchId: string) => {
    setActionLoading(true)
    try {
      const res = await fetch(`/api/log/import-batches/${batchId}`, { method: 'DELETE' })
      const json = await res.json()
      if (res.ok) {
        const n = json.data?.bookingsDeactivated ?? 0
        toast.success(`Rolled back ${n} booking${n === 1 ? '' : 's'}`)
        setBatches((prev) =>
          prev.map((b) => (b.id === batchId ? { ...b, deletedAt: new Date().toISOString() } : b))
        )
        setActiveAction(null)
      } else {
        toast.error(json.error ?? 'Failed to roll back')
      }
    } finally {
      setActionLoading(false)
    }
  }

  const handleMove = async (batchId: string) => {
    if (!targetFacilityId) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/log/import-batches/${batchId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'move', targetFacilityId }),
      })
      const json = await res.json()
      if (res.ok) {
        const newName = json.data?.facilityName ?? ''
        toast.success(`Moved to ${newName}`)
        setBatches((prev) =>
          prev.map((b) =>
            b.id === batchId
              ? {
                  ...b,
                  facilityId: targetFacilityId,
                  facilityName: facilities.find((f) => f.id === targetFacilityId)?.name ?? newName,
                  facilityCode: facilities.find((f) => f.id === targetFacilityId)?.facilityCode ?? null,
                }
              : b
          )
        )
        setActiveAction(null)
      } else {
        toast.error(json.error ?? 'Failed to move batch')
      }
    } finally {
      setActionLoading(false)
    }
  }

  const handleRename = async (batchId: string, facilityId: string) => {
    const name = renameValue.trim()
    if (!name) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/log/import-batches/${batchId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rename', name }),
      })
      const json = await res.json()
      if (res.ok) {
        toast.success('Facility renamed')
        setBatches((prev) =>
          prev.map((b) => (b.facilityId === facilityId ? { ...b, facilityName: name } : b))
        )
        setActiveAction(null)
      } else {
        toast.error(json.error ?? 'Failed to rename')
      }
    } finally {
      setActionLoading(false)
    }
  }

  const filteredFacilities = facilities.filter((f) => {
    const q = facilitySearch.toLowerCase()
    return (
      !q ||
      f.name.toLowerCase().includes(q) ||
      (f.facilityCode ?? '').toLowerCase().includes(q)
    )
  })

  return (
    <Modal open={open} onClose={onClose} title="Log Sheet History" className="max-w-lg">
      <div className="px-6 pb-6 space-y-4">
        {/* Search */}
        <div className="relative mt-2">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search by facility or date…"
            className="w-full bg-stone-50 border border-stone-200 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
          />
        </div>

        {/* List */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-xl bg-stone-100 skeleton" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 text-stone-400 text-sm">
            {batches.length === 0
              ? 'No scanned log sheets yet. Import a log sheet to see history here.'
              : 'No sheets match your search.'}
          </div>
        ) : (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            {filtered.map((batch) => {
              const isRolledBack = !!batch.deletedAt
              const isActive = activeAction?.batchId === batch.id

              return (
                <div
                  key={batch.id}
                  className={`border rounded-2xl p-4 transition-colors ${
                    isRolledBack ? 'border-stone-100 bg-stone-50' : 'border-stone-200 bg-white'
                  }`}
                >
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className={`text-sm font-semibold truncate ${isRolledBack ? 'text-stone-400' : 'text-stone-900'}`}>
                          {batch.facilityName ?? 'Unknown Facility'}
                        </p>
                        {batch.facilityCode && (
                          <span className="text-[10px] font-mono bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded-full shrink-0">
                            {batch.facilityCode}
                          </span>
                        )}
                        {isRolledBack && (
                          <span className="text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full shrink-0">
                            Rolled back
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-stone-500 mt-0.5">
                        {formatDate(batch.createdAt)} · {batch.rowCount} booking{batch.rowCount === 1 ? '' : 's'}
                        {batch.uploaderName && ` · by ${batch.uploaderName}`}
                      </p>
                    </div>

                    {/* Action buttons (only when not rolled back) */}
                    {!isRolledBack && !isActive && (
                      <div className="flex items-center gap-1 shrink-0">
                        {canMove && (
                          <button
                            onClick={() => startAction(batch.id, 'move')}
                            className="text-xs text-stone-500 hover:text-[#8B2E4A] px-2 py-1 rounded-lg hover:bg-[#F9EFF2] transition-colors"
                            title="Move to a different facility"
                          >
                            Move
                          </button>
                        )}
                        <button
                          onClick={() => startAction(batch.id, 'rename')}
                          className="text-xs text-stone-500 hover:text-[#8B2E4A] px-2 py-1 rounded-lg hover:bg-[#F9EFF2] transition-colors"
                          title="Rename this facility"
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => startAction(batch.id, 'delete')}
                          className="text-xs text-stone-500 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
                          title="Roll back all bookings from this scan"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                    {isActive && !isRolledBack && (
                      <button
                        onClick={cancelAction}
                        className="text-xs text-stone-400 hover:text-stone-600 px-2 py-1 shrink-0"
                      >
                        Cancel
                      </button>
                    )}
                  </div>

                  {/* Inline action panel */}
                  {isActive && activeAction?.type === 'delete' && (
                    <div className="mt-3 pt-3 border-t border-stone-100">
                      <p className="text-xs text-stone-600 mb-3">
                        This will deactivate all <strong>{batch.rowCount}</strong> booking{batch.rowCount === 1 ? '' : 's'}
                        {' '}from this scan. You can re-import the sheet to restore them.
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={cancelAction}
                          className="flex-1 text-sm text-stone-600 border border-stone-200 rounded-xl py-2 hover:bg-stone-50 transition-colors"
                          disabled={actionLoading}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleDelete(batch.id)}
                          disabled={actionLoading}
                          className="flex-1 text-sm bg-red-600 text-white rounded-xl py-2 hover:bg-red-700 transition-colors disabled:opacity-50"
                        >
                          {actionLoading ? 'Rolling back…' : 'Roll back'}
                        </button>
                      </div>
                    </div>
                  )}

                  {isActive && activeAction?.type === 'rename' && (
                    <div className="mt-3 pt-3 border-t border-stone-100 space-y-2">
                      <p className="text-xs text-stone-500">New name for this facility:</p>
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        placeholder="Facility name"
                        className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
                        onKeyDown={(e) => e.key === 'Enter' && handleRename(batch.id, batch.facilityId)}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={cancelAction}
                          className="flex-1 text-sm text-stone-600 border border-stone-200 rounded-xl py-2 hover:bg-stone-50 transition-colors"
                          disabled={actionLoading}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleRename(batch.id, batch.facilityId)}
                          disabled={!renameValue.trim() || actionLoading}
                          className="flex-1 text-sm bg-[#8B2E4A] text-white rounded-xl py-2 hover:bg-[#72253C] transition-colors disabled:opacity-50"
                        >
                          {actionLoading ? 'Saving…' : 'Save name'}
                        </button>
                      </div>
                    </div>
                  )}

                  {isActive && activeAction?.type === 'move' && (
                    <div className="mt-3 pt-3 border-t border-stone-100 space-y-2">
                      <p className="text-xs text-stone-500">
                        Move all bookings from this scan to a different facility:
                      </p>
                      <input
                        autoFocus
                        value={facilitySearch}
                        onChange={(e) => setFacilitySearch(e.target.value)}
                        placeholder="Search facilities…"
                        className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
                      />
                      {filteredFacilities.length > 0 && (
                        <div className="border border-stone-200 rounded-xl max-h-40 overflow-y-auto">
                          {filteredFacilities.slice(0, 20).map((f) => (
                            <button
                              key={f.id}
                              onClick={() => setTargetFacilityId(f.id)}
                              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-stone-50 transition-colors ${
                                targetFacilityId === f.id ? 'bg-[#F9EFF2] text-[#8B2E4A] font-medium' : 'text-stone-700'
                              }`}
                            >
                              {f.facilityCode && (
                                <span className="text-[10px] font-mono bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded-full shrink-0">
                                  {f.facilityCode}
                                </span>
                              )}
                              {f.name}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={cancelAction}
                          className="flex-1 text-sm text-stone-600 border border-stone-200 rounded-xl py-2 hover:bg-stone-50 transition-colors"
                          disabled={actionLoading}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleMove(batch.id)}
                          disabled={!targetFacilityId || actionLoading}
                          className="flex-1 text-sm bg-[#8B2E4A] text-white rounded-xl py-2 hover:bg-[#72253C] transition-colors disabled:opacity-50"
                        >
                          {actionLoading ? 'Moving…' : 'Move here'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Modal>
  )
}
