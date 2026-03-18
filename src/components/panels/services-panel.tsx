'use client'

import { useState } from 'react'
import { formatCents, dollarsToCents } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { Service } from '@/types'
import { useToast } from '@/components/ui/toast'

const DURATION_OPTIONS = [15, 30, 45, 60, 75, 90, 120]

interface ServicesPanelProps {
  services: Service[]
  onServiceAdded: (service: Service) => void
  onServiceUpdated: (service: Service) => void
  isAdmin?: boolean
}

export function ServicesPanel({ services, onServiceAdded, onServiceUpdated, isAdmin = true }: ServicesPanelProps) {
  const { toast } = useToast()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPrice, setEditPrice] = useState('')
  const [editDuration, setEditDuration] = useState('')
  const [saving, setSaving] = useState(false)

  const [showAdd, setShowAdd] = useState(false)
  const [addName, setAddName] = useState('')
  const [addPrice, setAddPrice] = useState('')
  const [addDuration, setAddDuration] = useState('30')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const [hoverId, setHoverId] = useState<string | null>(null)

  const startEdit = (service: Service) => {
    setEditingId(service.id)
    setEditPrice((service.priceCents / 100).toFixed(2))
    setEditDuration(service.durationMinutes.toString())
  }

  const saveEdit = async (serviceId: string) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/services/${serviceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          priceCents: dollarsToCents(editPrice),
          durationMinutes: parseInt(editDuration),
        }),
      })
      const json = await res.json()
      if (res.ok) {
        onServiceUpdated(json.data)
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
        }),
      })
      const json = await res.json()
      if (res.ok) {
        onServiceAdded(json.data)
        setAddName('')
        setAddPrice('')
        setAddDuration('30')
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

  const resetAdd = () => {
    setShowAdd(false)
    setAddError(null)
    setAddName('')
    setAddPrice('')
    setAddDuration('30')
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-stone-100">
        {isAdmin && (
          <div className="flex justify-end">
            <button
              onClick={() => setShowAdd((v) => !v)}
              className="w-11 h-11 shrink-0 flex items-center justify-center bg-[#0D7377] text-white rounded-xl hover:bg-[#0a5f63] active:scale-95 transition-all"
              title="Add service"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
        )}

        {showAdd && (
          <div className="mt-2 bg-stone-50 rounded-xl border border-stone-200 p-3 space-y-2">
            <p className="text-xs font-semibold text-stone-600">New Service</p>
            {addError && <p className="text-xs text-red-600">{addError}</p>}
            <input
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="Service name *"
              className="w-full bg-white border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#0D7377] focus:ring-1 focus:ring-teal-100 transition-all"
            />
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>
                <input
                  type="number"
                  value={addPrice}
                  onChange={(e) => setAddPrice(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                  className="w-full bg-white border border-stone-200 rounded-lg pl-6 pr-3 py-2 text-sm focus:outline-none focus:border-[#0D7377] focus:ring-1 focus:ring-teal-100 transition-all"
                />
              </div>
              <select
                value={addDuration}
                onChange={(e) => setAddDuration(e.target.value)}
                className="w-24 bg-white border border-stone-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-[#0D7377] transition-all"
              >
                {DURATION_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}min
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={resetAdd} disabled={adding}>
                Cancel
              </Button>
              <Button size="sm" loading={adding} onClick={handleAdd}>
                Add
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {services.length === 0 ? (
          <div className="flex items-center justify-center h-28">
            <p className="text-sm text-stone-400">No services yet</p>
          </div>
        ) : (
          services.map((service) => (
            <div
              key={service.id}
              className="relative border-b border-stone-50 last:border-0"
              onMouseEnter={() => setHoverId(service.id)}
              onMouseLeave={() => setHoverId(null)}
            >
              {editingId === service.id ? (
                /* Inline edit form */
                <div className="px-4 py-3 bg-teal-50/60 border-l-2 border-[#0D7377]">
                  <p className="text-xs font-semibold text-stone-700 mb-2 truncate">{service.name}</p>
                  <div className="flex gap-2 items-center mb-2">
                    <div className="flex items-center gap-1 flex-1">
                      <span className="text-sm text-stone-400">$</span>
                      <input
                        type="number"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        step="0.01"
                        className="flex-1 bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[#0D7377]"
                      />
                    </div>
                    <select
                      value={editDuration}
                      onChange={(e) => setEditDuration(e.target.value)}
                      className="w-20 bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[#0D7377]"
                    >
                      {DURATION_OPTIONS.map((d) => (
                        <option key={d} value={d}>
                          {d}min
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingId(null)}
                      disabled={saving}
                    >
                      Cancel
                    </Button>
                    <Button size="sm" loading={saving} onClick={() => saveEdit(service.id)}>
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                /* Normal row */
                <div className="flex items-center gap-3 px-4 py-3.5 min-h-[44px]">
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: service.color ?? '#0D7377' }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-stone-900 truncate">{service.name}</p>
                    <p className="text-xs text-stone-400">{service.durationMinutes}min</p>
                  </div>
                  <p className="text-sm font-semibold text-stone-700 shrink-0">
                    {formatCents(service.priceCents)}
                  </p>
                  {isAdmin && hoverId === service.id && (
                    <button
                      onClick={() => startEdit(service)}
                      className="ml-1 p-1 text-stone-400 hover:text-stone-600 transition-colors rounded"
                      title="Edit"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
