'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { cn, formatCents, dollarsToCents } from '@/lib/utils'
import { formatPricingLabel } from '@/lib/pricing'
import type { Service, PricingType, PricingTier, PricingOption } from '@/types'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { useToast } from '@/components/ui/toast'

const DURATION_OPTIONS = [15, 30, 45, 60, 75, 90, 120]

interface ServicesPageClientProps {
  services: Service[]
}

export function ServicesPageClient({ services: initialServices }: ServicesPageClientProps) {
  const { toast } = useToast()
  const [services, setServices] = useState(initialServices)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editDuration, setEditDuration] = useState('')
  const [editPricingType, setEditPricingType] = useState<PricingType>('fixed')
  const [editAddonAmount, setEditAddonAmount] = useState('')
  const [editTiers, setEditTiers] = useState<PricingTier[]>([])
  const [editOptions, setEditOptions] = useState<PricingOption[]>([])
  const [saving, setSaving] = useState(false)

  const [showAdd, setShowAdd] = useState(false)
  const [addName, setAddName] = useState('')
  const [addPrice, setAddPrice] = useState('')
  const [addDuration, setAddDuration] = useState('30')
  const [addPricingType, setAddPricingType] = useState<PricingType>('fixed')
  const [addAddonAmount, setAddAddonAmount] = useState('')
  const [addTiers, setAddTiers] = useState<PricingTier[]>([{ minQty: 1, maxQty: 10, unitPriceCents: 0 }])
  const [addOptions, setAddOptions] = useState<PricingOption[]>([{ name: '', priceCents: 0 }])
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const [archivingId, setArchivingId] = useState<string | null>(null)
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)

  // Multi-select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkColorPickerOpen, setBulkColorPickerOpen] = useState(false)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [bulkUpdating, setBulkUpdating] = useState(false)

  const [sortKey, setSortKey] = useState<'name' | 'category' | 'duration' | 'price'>('category')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }
  const sortablePrice = (s: Service): number => {
    if (s.pricingType === 'addon') return s.addonAmountCents ?? s.priceCents
    if (s.pricingType === 'tiered') return s.pricingTiers?.[0]?.unitPriceCents ?? s.priceCents
    if (s.pricingType === 'multi_option') return s.pricingOptions?.[0]?.priceCents ?? s.priceCents
    return s.priceCents
  }

  const handleBulkUpdate = async (updates: { color?: string; active?: boolean }) => {
    setBulkUpdating(true)
    try {
      const res = await fetch('/api/services/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds), updates }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast(json.error ?? 'Update failed', 'error')
        return
      }
      if (updates.active === false) {
        setServices((prev) => prev.filter((s) => !selectedIds.has(s.id)))
        toast(`${json.data.updated} service${json.data.updated !== 1 ? 's' : ''} archived`, 'success')
      } else if (updates.color) {
        setServices((prev) =>
          prev.map((s) => selectedIds.has(s.id) ? { ...s, color: updates.color! } : s)
        )
        toast(`Color updated for ${json.data.updated} service${json.data.updated !== 1 ? 's' : ''}`, 'success')
      }
      setSelectedIds(new Set())
      setConfirmBulkDelete(false)
    } finally {
      setBulkUpdating(false)
    }
  }

  const startEdit = (service: Service) => {
    setEditingId(service.id)
    setEditName(service.name)
    setEditPrice((service.priceCents / 100).toFixed(2))
    setEditDuration(service.durationMinutes.toString())
    setEditPricingType(service.pricingType)
    setEditAddonAmount(service.addonAmountCents ? (service.addonAmountCents / 100).toFixed(2) : '')
    setEditTiers(service.pricingTiers ?? [{ minQty: 1, maxQty: 10, unitPriceCents: 0 }])
    setEditOptions(service.pricingOptions ?? [{ name: '', priceCents: 0 }])
  }

  const cancelEdit = () => {
    setEditingId(null)
  }

  const saveEdit = async (serviceId: string) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/services/${serviceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          priceCents: dollarsToCents(editPrice),
          durationMinutes: parseInt(editDuration),
          pricingType: editPricingType,
          addonAmountCents: editPricingType === 'addon' ? dollarsToCents(editAddonAmount) : null,
          pricingTiers: editPricingType === 'tiered' ? editTiers : null,
          pricingOptions: editPricingType === 'multi_option' ? editOptions : null,
        }),
      })
      const json = await res.json()
      if (res.ok) {
        setServices(services.map((s) => (s.id === serviceId ? json.data : s)))
        setEditingId(null)
        toast('Changes saved', 'success')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleAdd = async () => {
    if (!addName.trim() || !addPrice) {
      setAddError('Name and price are required')
      return
    }
    setAdding(true)
    setAddError(null)
    try {
      const res = await fetch('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: addName.trim(),
          priceCents: dollarsToCents(addPrice),
          durationMinutes: parseInt(addDuration),
          pricingType: addPricingType,
          addonAmountCents: addPricingType === 'addon' ? dollarsToCents(addAddonAmount) : null,
          pricingTiers: addPricingType === 'tiered' ? addTiers : null,
          pricingOptions: addPricingType === 'multi_option' ? addOptions : null,
        }),
      })
      const json = await res.json()
      if (res.ok) {
        setServices([...services, json.data].sort((a, b) => a.name.localeCompare(b.name)))
        setAddName('')
        setAddPrice('')
        setAddDuration('30')
        setAddPricingType('fixed')
        setAddAddonAmount('')
        setAddTiers([{ minQty: 1, maxQty: 10, unitPriceCents: 0 }])
        setAddOptions([{ name: '', priceCents: 0 }])
        setShowAdd(false)
        toast('Service saved', 'success')
      } else {
        setAddError(json.error ?? 'Failed to add service')
      }
    } catch {
      setAddError('Network error')
    } finally {
      setAdding(false)
    }
  }

  const handleArchive = async (serviceId: string) => {
    if (confirmArchiveId !== serviceId) {
      setConfirmArchiveId(serviceId)
      return
    }
    setArchivingId(serviceId)
    try {
      const res = await fetch(`/api/services/${serviceId}`, { method: 'DELETE' })
      if (res.ok) {
        setServices(services.filter((s) => s.id !== serviceId))
        setConfirmArchiveId(null)
      }
    } finally {
      setArchivingId(null)
    }
  }

  return (
    <ErrorBoundary>
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="text-2xl font-bold text-stone-900"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            Services
          </h1>
          <p className="text-sm text-stone-500 mt-0.5">
            {services.length} service{services.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
        <Link
          href="/services/import"
          className="hidden md:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#8B2E4A] bg-white border border-stone-200 rounded-xl hover:bg-stone-50 active:scale-95 transition-all"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          Import
        </Link>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="w-9 h-9 shrink-0 flex items-center justify-center bg-[#8B2E4A] text-white rounded-xl hover:bg-[#72253C] active:scale-95 transition-all"
          title="Add service"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4 mb-4 space-y-3">
          <p className="text-sm font-semibold text-stone-700">New Service</p>
          {addError && <p className="text-xs text-red-600">{addError}</p>}
          <input
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            placeholder="Service name *"
            className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-rose-100 transition-all"
          />
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>
              <input
                type="number"
                value={addPrice}
                onChange={(e) => setAddPrice(e.target.value)}
                placeholder="0.00"
                step="0.01"
                min="0"
                className="w-full bg-stone-50 border border-stone-200 rounded-xl pl-7 pr-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-rose-100 transition-all"
              />
            </div>
            <select
              value={addDuration}
              onChange={(e) => setAddDuration(e.target.value)}
              className="w-28 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#8B2E4A] transition-all"
            >
              {DURATION_OPTIONS.map((d) => (
                <option key={d} value={d}>{d} min</option>
              ))}
            </select>
          </div>
          {/* Pricing type */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-stone-500">Pricing Type</label>
            <select
              value={addPricingType}
              onChange={(e) => setAddPricingType(e.target.value as PricingType)}
              className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-rose-100 transition-all"
            >
              <option value="fixed">Fixed Price</option>
              <option value="addon">Add-on</option>
              <option value="tiered">Tiered (per unit)</option>
              <option value="multi_option">Multiple Options</option>
            </select>
          </div>

          {addPricingType === 'addon' && (
            <div className="relative">
              <label className="text-xs font-medium text-stone-500 mb-1 block">Add-on Amount</label>
              <span className="absolute left-3.5 bottom-2.5 text-stone-400 text-sm">$</span>
              <input
                type="number"
                value={addAddonAmount}
                onChange={(e) => setAddAddonAmount(e.target.value)}
                placeholder="0.00"
                step="0.01"
                min="0"
                className="w-full bg-stone-50 border border-stone-200 rounded-xl pl-7 pr-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-rose-100 transition-all"
              />
            </div>
          )}

          {addPricingType === 'tiered' && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-stone-500">Pricing Tiers</label>
              {addTiers.map((tier, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input type="number" value={tier.minQty} min={1} onChange={(e) => { const t = [...addTiers]; t[i] = { ...t[i], minQty: parseInt(e.target.value) || 1 }; setAddTiers(t) }} placeholder="Min" className="w-16 bg-stone-50 border border-stone-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-[#8B2E4A]" />
                  <span className="text-xs text-stone-400">–</span>
                  <input type="number" value={tier.maxQty} min={1} onChange={(e) => { const t = [...addTiers]; t[i] = { ...t[i], maxQty: parseInt(e.target.value) || 1 }; setAddTiers(t) }} placeholder="Max" className="w-16 bg-stone-50 border border-stone-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-[#8B2E4A]" />
                  <span className="text-xs text-stone-400">×</span>
                  <div className="relative flex-1">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>
                    <input type="number" value={(tier.unitPriceCents / 100).toFixed(2)} step="0.01" min="0" onChange={(e) => { const t = [...addTiers]; t[i] = { ...t[i], unitPriceCents: dollarsToCents(e.target.value) }; setAddTiers(t) }} className="w-full bg-stone-50 border border-stone-200 rounded-lg pl-6 pr-2 py-2 text-sm focus:outline-none focus:border-[#8B2E4A]" />
                  </div>
                  {addTiers.length > 1 && (
                    <button onClick={() => setAddTiers(addTiers.filter((_, j) => j !== i))} className="p-1 text-stone-400 hover:text-red-500"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                  )}
                </div>
              ))}
              <button onClick={() => setAddTiers([...addTiers, { minQty: (addTiers[addTiers.length - 1]?.maxQty ?? 0) + 1, maxQty: (addTiers[addTiers.length - 1]?.maxQty ?? 0) + 10, unitPriceCents: 0 }])} className="text-xs text-[#8B2E4A] font-medium hover:underline">+ Add tier</button>
            </div>
          )}

          {addPricingType === 'multi_option' && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-stone-500">Options</label>
              {addOptions.map((opt, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input value={opt.name} onChange={(e) => { const o = [...addOptions]; o[i] = { ...o[i], name: e.target.value }; setAddOptions(o) }} placeholder="Option name" className="flex-1 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#8B2E4A]" />
                  <div className="relative w-24">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>
                    <input type="number" value={(opt.priceCents / 100).toFixed(2)} step="0.01" min="0" onChange={(e) => { const o = [...addOptions]; o[i] = { ...o[i], priceCents: dollarsToCents(e.target.value) }; setAddOptions(o) }} className="w-full bg-stone-50 border border-stone-200 rounded-lg pl-6 pr-2 py-2 text-sm focus:outline-none focus:border-[#8B2E4A]" />
                  </div>
                  {addOptions.length > 1 && (
                    <button onClick={() => setAddOptions(addOptions.filter((_, j) => j !== i))} className="p-1 text-stone-400 hover:text-red-500"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                  )}
                </div>
              ))}
              <button onClick={() => setAddOptions([...addOptions, { name: '', priceCents: 0 }])} className="text-xs text-[#8B2E4A] font-medium hover:underline">+ Add option</button>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setShowAdd(false); setAddError(null); setAddName(''); setAddPrice(''); setAddDuration('30'); setAddPricingType('fixed'); setAddAddonAmount(''); setAddTiers([{ minQty: 1, maxQty: 10, unitPriceCents: 0 }]); setAddOptions([{ name: '', priceCents: 0 }]) }}
              disabled={adding}
            >
              Cancel
            </Button>
            <Button size="sm" loading={adding} onClick={handleAdd}>
              Add
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      {services.length === 0 ? (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm py-16 text-center">
          <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#A8A29E" strokeWidth="1.8">
              <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-stone-700">No services yet</p>
          <p className="text-xs text-stone-400 mt-1 mb-4">Add your first service to start booking appointments.</p>
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#8B2E4A] text-white text-sm font-semibold rounded-xl hover:bg-[#72253C] active:scale-95 transition-all"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Service
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-12 gap-4 px-5 py-2.5 border-b border-stone-100 bg-stone-50">
            <div className="col-span-1 flex items-center">
              <input
                type="checkbox"
                checked={services.length > 0 && selectedIds.size === services.length}
                ref={(el) => {
                  if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < services.length
                }}
                onChange={() => {
                  if (selectedIds.size === services.length) {
                    setSelectedIds(new Set())
                  } else {
                    setSelectedIds(new Set(services.map((s) => s.id)))
                  }
                }}
                className="rounded accent-[#8B2E4A] w-3.5 h-3.5"
              />
            </div>
            {(['name', 'category', 'duration', 'price'] as const).map((key) => (
              <div
                key={key}
                className={cn(
                  key === 'name' ? 'col-span-3' : key === 'category' ? 'col-span-2' : 'col-span-2'
                )}
              >
                <button
                  onClick={() => toggleSort(key)}
                  className={cn(
                    'flex items-center gap-1 text-xs font-semibold uppercase tracking-wide transition-colors',
                    sortKey === key ? 'text-[#8B2E4A]' : 'text-stone-500 hover:text-stone-700'
                  )}
                >
                  {key === 'name' ? 'Service' : key === 'category' ? 'Category' : key === 'duration' ? 'Duration' : 'Price'}
                  {sortKey === key && (
                    <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </button>
              </div>
            ))}
            <div className="col-span-2" />
          </div>

          {(() => {
            const sorted = [...services].sort((a, b) => {
              let cmp = 0
              if (sortKey === 'name') {
                cmp = a.name.localeCompare(b.name)
              } else if (sortKey === 'category') {
                const ca = a.category?.trim() || 'zzzOther'
                const cb = b.category?.trim() || 'zzzOther'
                cmp = ca.localeCompare(cb)
                if (cmp === 0) cmp = a.name.localeCompare(b.name)
              } else if (sortKey === 'duration') {
                cmp = a.durationMinutes - b.durationMinutes
              } else if (sortKey === 'price') {
                cmp = sortablePrice(a) - sortablePrice(b)
              }
              return sortDir === 'asc' ? cmp : -cmp
            })
            let lastCategory: string | null = null
            const nodes: ReactNode[] = []
            for (const service of sorted) {
              // Only show category section headers when sorting by category
              if (sortKey === 'category') {
                const cat = service.category?.trim() || 'Other'
                if (cat !== lastCategory) {
                  nodes.push(
                    <div
                      key={`cat-${cat}`}
                      className="px-5 pt-4 pb-1.5 bg-stone-50/50 border-b border-stone-100 text-[11px] font-semibold text-stone-500 uppercase tracking-wide"
                    >
                      {cat}
                    </div>
                  )
                  lastCategory = cat
                }
              }
              nodes.push(
            <div
              key={service.id}
              className="border-b border-stone-50 last:border-0"
              onMouseEnter={() => setHoverId(service.id)}
              onMouseLeave={() => { setHoverId(null); if (confirmArchiveId === service.id) setConfirmArchiveId(null) }}
            >
              {editingId === service.id ? (
                /* Inline edit row */
                <div className="px-5 py-3 bg-rose-50/60 border-l-2 border-[#8B2E4A] space-y-3">
                  <div className="grid grid-cols-12 gap-3 items-center">
                    <div className="col-span-5">
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full bg-white border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#8B2E4A]"
                      />
                    </div>
                    <div className="col-span-2">
                      <select
                        value={editDuration}
                        onChange={(e) => setEditDuration(e.target.value)}
                        className="w-full bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[#8B2E4A]"
                      >
                        {DURATION_OPTIONS.map((d) => (
                          <option key={d} value={d}>{d} min</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>
                        <input
                          type="number"
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                          step="0.01"
                          className="w-full bg-white border border-stone-200 rounded-lg pl-6 pr-2 py-1.5 text-sm focus:outline-none focus:border-[#8B2E4A]"
                        />
                      </div>
                    </div>
                    <div className="col-span-3 flex gap-2 justify-end">
                      <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={saving}>
                        Cancel
                      </Button>
                      <Button size="sm" loading={saving} onClick={() => saveEdit(service.id)}>
                        Save
                      </Button>
                    </div>
                  </div>

                  {/* Pricing type fields */}
                  <div className="flex flex-wrap gap-3 items-start">
                    <select
                      value={editPricingType}
                      onChange={(e) => setEditPricingType(e.target.value as PricingType)}
                      className="bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[#8B2E4A]"
                    >
                      <option value="fixed">Fixed</option>
                      <option value="addon">Add-on</option>
                      <option value="tiered">Tiered</option>
                      <option value="multi_option">Options</option>
                    </select>

                    {editPricingType === 'addon' && (
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 text-xs">+$</span>
                        <input type="number" value={editAddonAmount} onChange={(e) => setEditAddonAmount(e.target.value)} step="0.01" min="0" placeholder="Add-on" className="w-24 bg-white border border-stone-200 rounded-lg pl-7 pr-2 py-1.5 text-sm focus:outline-none focus:border-[#8B2E4A]" />
                      </div>
                    )}

                    {editPricingType === 'tiered' && (
                      <div className="flex-1 space-y-1.5">
                        {editTiers.map((tier, i) => (
                          <div key={i} className="flex gap-1.5 items-center text-sm">
                            <input type="number" value={tier.minQty} min={1} onChange={(e) => { const t = [...editTiers]; t[i] = { ...t[i], minQty: parseInt(e.target.value) || 1 }; setEditTiers(t) }} className="w-14 bg-white border border-stone-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-[#8B2E4A]" />
                            <span className="text-stone-400">–</span>
                            <input type="number" value={tier.maxQty} min={1} onChange={(e) => { const t = [...editTiers]; t[i] = { ...t[i], maxQty: parseInt(e.target.value) || 1 }; setEditTiers(t) }} className="w-14 bg-white border border-stone-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-[#8B2E4A]" />
                            <span className="text-stone-400">×</span>
                            <div className="relative w-20">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-400 text-xs">$</span>
                              <input type="number" value={(tier.unitPriceCents / 100).toFixed(2)} step="0.01" min="0" onChange={(e) => { const t = [...editTiers]; t[i] = { ...t[i], unitPriceCents: dollarsToCents(e.target.value) }; setEditTiers(t) }} className="w-full bg-white border border-stone-200 rounded-lg pl-5 pr-1 py-1 text-sm focus:outline-none focus:border-[#8B2E4A]" />
                            </div>
                            {editTiers.length > 1 && <button onClick={() => setEditTiers(editTiers.filter((_, j) => j !== i))} className="p-0.5 text-stone-400 hover:text-red-500"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>}
                          </div>
                        ))}
                        <button onClick={() => setEditTiers([...editTiers, { minQty: (editTiers[editTiers.length - 1]?.maxQty ?? 0) + 1, maxQty: (editTiers[editTiers.length - 1]?.maxQty ?? 0) + 10, unitPriceCents: 0 }])} className="text-xs text-[#8B2E4A] font-medium hover:underline">+ Add tier</button>
                      </div>
                    )}

                    {editPricingType === 'multi_option' && (
                      <div className="flex-1 space-y-1.5">
                        {editOptions.map((opt, i) => (
                          <div key={i} className="flex gap-1.5 items-center">
                            <input value={opt.name} onChange={(e) => { const o = [...editOptions]; o[i] = { ...o[i], name: e.target.value }; setEditOptions(o) }} placeholder="Name" className="flex-1 bg-white border border-stone-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-[#8B2E4A]" />
                            <div className="relative w-20">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-400 text-xs">$</span>
                              <input type="number" value={(opt.priceCents / 100).toFixed(2)} step="0.01" min="0" onChange={(e) => { const o = [...editOptions]; o[i] = { ...o[i], priceCents: dollarsToCents(e.target.value) }; setEditOptions(o) }} className="w-full bg-white border border-stone-200 rounded-lg pl-5 pr-1 py-1 text-sm focus:outline-none focus:border-[#8B2E4A]" />
                            </div>
                            {editOptions.length > 1 && <button onClick={() => setEditOptions(editOptions.filter((_, j) => j !== i))} className="p-0.5 text-stone-400 hover:text-red-500"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>}
                          </div>
                        ))}
                        <button onClick={() => setEditOptions([...editOptions, { name: '', priceCents: 0 }])} className="text-xs text-[#8B2E4A] font-medium hover:underline">+ Add option</button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Normal row */
                <div className="grid grid-cols-12 gap-4 items-center px-5 py-3.5">
                  <div className="col-span-1">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(service.id)}
                      onChange={() => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev)
                          next.has(service.id) ? next.delete(service.id) : next.add(service.id)
                          return next
                        })
                      }}
                      className={cn(
                        'rounded accent-[#8B2E4A] w-3.5 h-3.5 transition-opacity',
                        selectedIds.size > 0 || hoverId === service.id ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                  </div>
                  <div className="col-span-3 flex items-center gap-3">
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: service.color ?? '#0D7377' }}
                    />
                    <span className="text-sm font-medium text-stone-900 truncate">{service.name}</span>
                  </div>
                  <div className="col-span-2 text-sm text-stone-500 truncate">
                    {service.category ?? '—'}
                  </div>
                  <div className="col-span-2 text-sm text-stone-500">
                    {service.durationMinutes} min
                  </div>
                  <div className="col-span-2 text-sm font-semibold text-stone-700">
                    {formatPricingLabel(service)}
                    {service.pricingType !== 'fixed' && (
                      <span className="ml-1.5 text-[10px] font-medium text-stone-400 uppercase tracking-wide">
                        {service.pricingType === 'addon' ? 'add-on' : service.pricingType === 'tiered' ? 'tiered' : 'options'}
                      </span>
                    )}
                  </div>
                  <div className="col-span-2 flex items-center justify-end gap-2">
                    {confirmArchiveId === service.id ? (
                      <>
                        <span className="text-xs text-stone-500">Archive?</span>
                        <Button
                          variant="danger"
                          size="sm"
                          loading={archivingId === service.id}
                          onClick={() => handleArchive(service.id)}
                        >
                          Yes
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmArchiveId(null)}
                        >
                          No
                        </Button>
                      </>
                    ) : hoverId === service.id ? (
                      <>
                        <button
                          onClick={() => startEdit(service)}
                          className="p-1.5 text-stone-400 hover:text-stone-600 transition-colors rounded-lg hover:bg-stone-100"
                          title="Edit"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => setConfirmArchiveId(service.id)}
                          className="p-1.5 text-stone-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50"
                          title="Archive"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14H6L5 6" />
                            <path d="M10 11v6M14 11v6" />
                            <path d="M9 6V4h6v2" />
                          </svg>
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
              )
            }
            return nodes
          })()}
        </div>
      )}
    </div>

      {/* ── Multi-select floating action bar ── */}
      {selectedIds.size > 0 && (
        <div
          className="fixed left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl z-40 animate-in fade-in slide-in-from-bottom-3 duration-200"
          style={{ backgroundColor: '#1C0A12', minWidth: 'max-content', bottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}
        >
          {/* Count */}
          <span className="text-sm font-semibold text-white pr-3 border-r border-white/20">
            {selectedIds.size} selected
          </span>

          {/* Change Color */}
          <div className="relative">
            <button
              onClick={() => setBulkColorPickerOpen((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-medium text-white/80 hover:text-white px-2 py-1 rounded-lg hover:bg-white/10 transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/>
                <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>
                <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>
                <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 011.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
              </svg>
              Change Color
            </button>
            {bulkColorPickerOpen && (
              <div className="absolute bottom-full mb-2 left-0 bg-white rounded-xl border border-stone-200 shadow-xl p-2 grid grid-cols-6 gap-1.5 z-50">
                {['#0D7377','#7C3AED','#DC2626','#DB2777','#D97706','#059669','#2563EB','#0891B2','#9333EA','#EA580C','#16A34A','#0284C7'].map((c) => (
                  <button
                    key={c}
                    onClick={async () => {
                      setBulkColorPickerOpen(false)
                      await handleBulkUpdate({ color: c })
                    }}
                    className="w-6 h-6 rounded-full border-2 border-transparent hover:border-stone-300 transition-colors"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Delete Selected */}
          {!confirmBulkDelete ? (
            <button
              onClick={() => setConfirmBulkDelete(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-red-300 hover:text-red-200 px-2 py-1 rounded-lg hover:bg-red-900/30 transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14H6L5 6"/>
                <path d="M10 11v6M14 11v6"/>
                <path d="M9 6V4h6v2"/>
              </svg>
              Delete Selected
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-red-300">Delete {selectedIds.size}?</span>
              <button
                onClick={() => handleBulkUpdate({ active: false })}
                disabled={bulkUpdating}
                className="text-xs font-semibold text-red-300 hover:text-red-200 px-2 py-1 rounded-lg hover:bg-red-900/30 disabled:opacity-50 transition-colors"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmBulkDelete(false)}
                className="text-xs text-white/60 hover:text-white px-2 py-1 rounded-lg hover:bg-white/10 transition-colors"
              >
                No
              </button>
            </div>
          )}

          {/* Deselect All */}
          <button
            onClick={() => { setSelectedIds(new Set()); setConfirmBulkDelete(false); setBulkColorPickerOpen(false) }}
            className="text-xs text-white/50 hover:text-white px-2 py-1 rounded-lg hover:bg-white/10 transition-colors ml-1 border-l border-white/20 pl-3"
          >
            Deselect All
          </button>
        </div>
      )}
    </ErrorBoundary>
  )
}
