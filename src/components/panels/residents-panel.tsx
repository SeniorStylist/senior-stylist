'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import type { Resident } from '@/types'

interface ResidentsPanelProps {
  residents: Resident[]
  onResidentAdded: (resident: Resident) => void
}

export function ResidentsPanel({ residents, onResidentAdded }: ResidentsPanelProps) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [roomNumber, setRoomNumber] = useState('')
  const [phone, setPhone] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newlyAddedId, setNewlyAddedId] = useState<string | null>(null)

  const filtered = residents.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      (r.roomNumber && r.roomNumber.toLowerCase().includes(search.toLowerCase()))
  )

  const handleAdd = async () => {
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    setAdding(true)
    setError(null)
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
      if (!res.ok) {
        setError(json.error ?? 'Failed to add resident')
        return
      }
      onResidentAdded(json.data)
      setNewlyAddedId(json.data.id)
      setTimeout(() => setNewlyAddedId(null), 2000)
      setName('')
      setRoomNumber('')
      setPhone('')
      setShowAdd(false)
    } catch {
      setError('Network error')
    } finally {
      setAdding(false)
    }
  }

  const resetAdd = () => {
    setShowAdd(false)
    setError(null)
    setName('')
    setRoomNumber('')
    setPhone('')
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search + Add header */}
      <div className="p-3 border-b border-stone-100 space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm placeholder:text-stone-400 focus:outline-none focus:bg-white focus:border-[#0D7377] focus:ring-2 focus:ring-teal-100 transition-all"
          />
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="w-11 h-11 shrink-0 flex items-center justify-center bg-[#0D7377] text-white rounded-xl hover:bg-[#0a5f63] active:scale-95 transition-all"
            title="Add resident"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>

        {showAdd && (
          <div className="bg-stone-50 rounded-xl border border-stone-200 p-3 space-y-2">
            <p className="text-xs font-semibold text-stone-600">New Resident</p>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name *"
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              className="w-full bg-white border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#0D7377] focus:ring-1 focus:ring-teal-100 transition-all"
            />
            <div className="flex gap-2">
              <input
                type="text"
                value={roomNumber}
                onChange={(e) => setRoomNumber(e.target.value)}
                placeholder="Room #"
                className="w-1/2 bg-white border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#0D7377] focus:ring-1 focus:ring-teal-100 transition-all"
              />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone"
                className="w-1/2 bg-white border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#0D7377] focus:ring-1 focus:ring-teal-100 transition-all"
              />
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

      {/* Resident list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-28 text-center px-4">
            <p className="text-sm text-stone-400">
              {search ? 'No matches found' : 'No residents yet'}
            </p>
          </div>
        ) : (
          filtered.map((resident) => (
            <button
              key={resident.id}
              onClick={() => router.push(`/residents/${resident.id}`)}
              className={`w-full flex items-center gap-3 px-4 py-3.5 min-h-[44px] text-left hover:bg-stone-50 active:bg-stone-100 transition-colors border-b border-stone-50 last:border-0 ${
                newlyAddedId === resident.id ? 'bg-teal-50' : ''
              }`}
            >
              <Avatar name={resident.name} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-stone-900 truncate">{resident.name}</p>
                {resident.roomNumber && (
                  <p className="text-xs text-stone-400">Room {resident.roomNumber}</p>
                )}
              </div>
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-stone-300 shrink-0"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
