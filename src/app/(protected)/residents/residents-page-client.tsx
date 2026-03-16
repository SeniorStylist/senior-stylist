'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { formatCents, formatDate } from '@/lib/utils'
import type { Resident } from '@/types'

interface ResidentWithStats extends Resident {
  lastVisit: string | null
  totalSpent: number
  appointmentCount: number
}

interface ResidentsPageClientProps {
  residents: ResidentWithStats[]
}

export function ResidentsPageClient({ residents: initialResidents }: ResidentsPageClientProps) {
  const router = useRouter()
  const [residents, setResidents] = useState(initialResidents)
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [roomNumber, setRoomNumber] = useState('')
  const [phone, setPhone] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const filtered = residents.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      (r.roomNumber && r.roomNumber.toLowerCase().includes(search.toLowerCase()))
  )

  const handleAdd = async () => {
    if (!name.trim()) { setAddError('Name is required'); return }
    setAdding(true)
    setAddError(null)
    try {
      const res = await fetch('/api/residents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          roomNumber: roomNumber.trim() || undefined,
          phone: phone.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (res.ok) {
        setResidents([{ ...json.data, lastVisit: null, totalSpent: 0, appointmentCount: 0 }, ...residents])
        setName('')
        setRoomNumber('')
        setPhone('')
        setShowAdd(false)
      } else {
        setAddError(json.error ?? 'Failed to add resident')
      }
    } catch {
      setAddError('Network error')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="text-2xl font-bold text-stone-900"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            Residents
          </h1>
          <p className="text-sm text-stone-500 mt-0.5">
            {residents.length} resident{residents.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="w-9 h-9 shrink-0 flex items-center justify-center bg-[#0D7377] text-white rounded-xl hover:bg-[#0a5f63] active:scale-95 transition-all"
          title="Add resident"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4 mb-4 space-y-3">
          <p className="text-sm font-semibold text-stone-700">New Resident</p>
          {addError && <p className="text-xs text-red-600">{addError}</p>}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Full name *"
            className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#0D7377] focus:ring-2 focus:ring-teal-100 transition-all"
          />
          <div className="flex gap-2">
            <input
              value={roomNumber}
              onChange={(e) => setRoomNumber(e.target.value)}
              placeholder="Room #"
              className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#0D7377] focus:ring-2 focus:ring-teal-100 transition-all"
            />
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone"
              className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#0D7377] focus:ring-2 focus:ring-teal-100 transition-all"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => { setShowAdd(false); setAddError(null); setName(''); setRoomNumber(''); setPhone('') }} disabled={adding}>
              Cancel
            </Button>
            <Button size="sm" loading={adding} onClick={handleAdd}>
              Add
            </Button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or room..."
          className="w-full bg-white border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm placeholder:text-stone-400 focus:outline-none focus:border-[#0D7377] focus:ring-2 focus:ring-teal-100 transition-all shadow-sm"
        />
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-12 text-center">
          <p className="text-stone-400 text-sm">
            {search ? 'No matches found' : 'No residents yet'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-12 gap-4 px-5 py-2.5 border-b border-stone-100 bg-stone-50">
            <div className="col-span-4 text-xs font-semibold text-stone-500 uppercase tracking-wide">Resident</div>
            <div className="col-span-2 text-xs font-semibold text-stone-500 uppercase tracking-wide">Room</div>
            <div className="col-span-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Last visit</div>
            <div className="col-span-2 text-xs font-semibold text-stone-500 uppercase tracking-wide">Total spent</div>
            <div className="col-span-1" />
          </div>

          {/* Rows */}
          {filtered.map((resident) => (
            <button
              key={resident.id}
              onClick={() => router.push(`/residents/${resident.id}`)}
              className="w-full grid grid-cols-12 gap-4 items-center px-5 py-3.5 hover:bg-stone-50 transition-colors border-b border-stone-50 last:border-0 text-left"
            >
              <div className="col-span-4 flex items-center gap-3">
                <Avatar name={resident.name} size="sm" />
                <span className="text-sm font-medium text-stone-900 truncate">{resident.name}</span>
              </div>
              <div className="col-span-2 text-sm text-stone-500">
                {resident.roomNumber ? `Room ${resident.roomNumber}` : '—'}
              </div>
              <div className="col-span-3 text-sm text-stone-500">
                {resident.lastVisit ? formatDate(resident.lastVisit) : 'Never'}
              </div>
              <div className="col-span-2 text-sm font-semibold text-stone-700">
                {resident.totalSpent > 0 ? formatCents(resident.totalSpent) : '—'}
              </div>
              <div className="col-span-1 flex justify-end">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-stone-300">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
