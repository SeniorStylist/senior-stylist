'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { ReportsTab } from './reports-tab'
import { MergeTab } from './merge-tab'
import { DebugTab } from './debug-tab'

interface FacilityInfo {
  id: string
  name: string
  facilityCode: string | null
  address: string | null
  phone: string | null
  timezone: string
  paymentType: string
  contactEmail: string | null
  active: boolean
  createdAt: string | null
  residentCount: number
  stylistCount: number
  bookingsThisMonth: number
  adminEmail: string | null
}

interface AccessRequestInfo {
  id: string
  email: string
  fullName: string | null
  role: string
  status: string
  userId: string | null
  createdAt: string | null
}

interface FranchiseInfo {
  id: string
  name: string
  ownerEmail: string | null
  ownerName: string | null
  facilities: { id: string; name: string }[]
}

interface SuperAdminClientProps {
  facilities: FacilityInfo[]
  pendingRequests: AccessRequestInfo[]
  activeFacilities: { id: string; name: string; facilityCode: string | null }[]
  franchises: FranchiseInfo[]
  currentFacilityId: string
}

const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern' },
  { value: 'America/Chicago', label: 'Central' },
  { value: 'America/Denver', label: 'Mountain' },
  { value: 'America/Phoenix', label: 'Arizona' },
  { value: 'America/Los_Angeles', label: 'Pacific' },
  { value: 'America/Anchorage', label: 'Alaska' },
  { value: 'Pacific/Honolulu', label: 'Hawaii' },
]

const PAYMENT_TYPES = [
  { value: 'facility', label: 'Facility' },
  { value: 'ip', label: 'IP' },
  { value: 'rfms', label: 'RFMS' },
  { value: 'hybrid', label: 'Hybrid' },
]

export function MasterAdminClient({ facilities, pendingRequests, activeFacilities, franchises: initialFranchises, currentFacilityId }: SuperAdminClientProps) {
  const router = useRouter()

  // Active tab
  type TabId = 'facilities' | 'franchises' | 'requests' | 'merge' | 'reports' | 'debug'
  const [activeTab, setActiveTab] = useState<TabId>('facilities')

  // Local list so we can remove deleted facilities immediately
  const [localFacilities, setLocalFacilities] = useState(facilities)

  // Pending access requests
  const [requestsList, setRequestsList] = useState(pendingRequests)
  const [assignFacility, setAssignFacility] = useState<Record<string, string>>({})
  const [assignRole, setAssignRole] = useState<Record<string, string>>(
    () => Object.fromEntries(pendingRequests.map((r) => [r.id, r.role]))
  )
  const [assignCommission, setAssignCommission] = useState<Record<string, string>>({})
  const [actioningRequestId, setActioningRequestId] = useState<string | null>(null)
  const [requestToast, setRequestToast] = useState<string | null>(null)

  const handleRequestAction = async (id: string, action: 'approve' | 'deny') => {
    setActioningRequestId(id)
    try {
      const res = await fetch(`/api/access-requests/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          facilityId: assignFacility[id] || undefined,
          role: assignRole[id] || undefined,
          commissionPercent: assignCommission[id] ? parseInt(assignCommission[id]) : undefined,
        }),
      })
      if (res.ok) {
        const req = requestsList.find((r) => r.id === id)
        setRequestsList((prev) => prev.filter((r) => r.id !== id))
        setRequestToast(
          action === 'approve'
            ? `Access granted to ${req?.fullName || req?.email}`
            : 'Request denied'
        )
        setTimeout(() => setRequestToast(null), 3000)
      }
    } finally {
      setActioningRequestId(null)
    }
  }

  const [enteringId, setEnteringId] = useState<string | null>(null)

  // Show/hide inactive toggle
  const [showInactive, setShowInactive] = useState(false)
  const [facilitySortBy, setFacilitySortBy] = useState<'fid' | 'name'>('fid')

  // Create form
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    phone: '',
    timezone: 'America/New_York',
  })

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editData, setEditData] = useState<Partial<FacilityInfo>>({})
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Deactivate confirm state
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  // Delete state
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Franchise state
  const [localFranchises, setLocalFranchises] = useState(initialFranchises)
  const [showCreateFranchise, setShowCreateFranchise] = useState(false)
  const [franchiseForm, setFranchiseForm] = useState({ name: '', ownerEmail: '', facilityIds: [] as string[] })
  const [franchiseFormError, setFranchiseFormError] = useState<string | null>(null)
  const [creatingFranchise, setCreatingFranchise] = useState(false)
  const [editingFranchiseId, setEditingFranchiseId] = useState<string | null>(null)
  const [franchiseEditForm, setFranchiseEditForm] = useState({ name: '', ownerEmail: '', facilityIds: [] as string[] })
  const [franchiseEditError, setFranchiseEditError] = useState<string | null>(null)
  const [savingFranchiseId, setSavingFranchiseId] = useState<string | null>(null)
  const [deleteFranchiseConfirmId, setDeleteFranchiseConfirmId] = useState<string | null>(null)
  const [deletingFranchiseId, setDeletingFranchiseId] = useState<string | null>(null)

  const handleCreateFranchise = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!franchiseForm.name.trim() || !franchiseForm.ownerEmail.trim() || franchiseForm.facilityIds.length === 0) return
    setCreatingFranchise(true)
    setFranchiseFormError(null)
    try {
      const res = await fetch('/api/super-admin/franchises', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(franchiseForm),
      })
      const json = await res.json()
      if (!res.ok) {
        setFranchiseFormError(json.error?.formErrors?.[0] ?? json.error ?? 'Failed to create franchise')
        return
      }
      setLocalFranchises(
        json.data.map((f: { id: string; name: string; owner?: { email?: string; fullName?: string } | null; franchiseFacilities: { facility: { id: string; name: string } }[] }) => ({
          id: f.id,
          name: f.name,
          ownerEmail: f.owner?.email ?? null,
          ownerName: f.owner?.fullName ?? null,
          facilities: f.franchiseFacilities.map((ff) => ({ id: ff.facility.id, name: ff.facility.name })),
        }))
      )
      setFranchiseForm({ name: '', ownerEmail: '', facilityIds: [] })
      setShowCreateFranchise(false)
    } catch {
      setFranchiseFormError('Failed to create franchise')
    } finally {
      setCreatingFranchise(false)
    }
  }

  const startEditFranchise = (f: FranchiseInfo) => {
    setEditingFranchiseId(f.id)
    setFranchiseEditForm({
      name: f.name,
      ownerEmail: f.ownerEmail ?? '',
      facilityIds: f.facilities.map((fac) => fac.id),
    })
    setFranchiseEditError(null)
  }

  const handleSaveFranchise = async (id: string) => {
    setSavingFranchiseId(id)
    setFranchiseEditError(null)
    try {
      const res = await fetch(`/api/super-admin/franchises/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(franchiseEditForm),
      })
      const json = await res.json()
      if (!res.ok) {
        setFranchiseEditError(json.error?.formErrors?.[0] ?? json.error ?? 'Failed to save')
        return
      }
      const updated = json.data
      setLocalFranchises((prev) =>
        prev.map((f) =>
          f.id === id
            ? {
                id: updated.id,
                name: updated.name,
                ownerEmail: updated.owner?.email ?? null,
                ownerName: updated.owner?.fullName ?? null,
                facilities: updated.franchiseFacilities.map((ff: { facility: { id: string; name: string } }) => ({
                  id: ff.facility.id,
                  name: ff.facility.name,
                })),
              }
            : f
        )
      )
      setEditingFranchiseId(null)
    } catch {
      setFranchiseEditError('Failed to save')
    } finally {
      setSavingFranchiseId(null)
    }
  }

  const handleDeleteFranchise = async (id: string) => {
    setDeletingFranchiseId(id)
    try {
      const res = await fetch(`/api/super-admin/franchises/${id}`, { method: 'DELETE' })
      if (!res.ok) return
      setLocalFranchises((prev) => prev.filter((f) => f.id !== id))
      setDeleteFranchiseConfirmId(null)
    } catch {
      // silently fail
    } finally {
      setDeletingFranchiseId(null)
    }
  }

  const toggleFranchiseFacility = (fid: string, form: string[], setForm: (ids: string[]) => void) => {
    setForm(form.includes(fid) ? form.filter((id) => id !== fid) : [...form, fid])
  }

  const inactiveCount = localFacilities.filter((f) => !f.active).length
  const visibleFacilities = showInactive
    ? localFacilities
    : localFacilities.filter((f) => f.active)

  const sortedFacilities = useMemo(() => {
    return [...visibleFacilities].sort((a, b) => {
      if (facilitySortBy === 'name') {
        return (a.name ?? '').localeCompare(b.name ?? '')
      }
      const numA = parseInt(a.facilityCode?.replace(/\D/g, '') ?? '9999', 10)
      const numB = parseInt(b.facilityCode?.replace(/\D/g, '') ?? '9999', 10)
      return numA - numB
    })
  }, [visibleFacilities, facilitySortBy])

  const handleEnterFacility = async (facilityId: string) => {
    setEnteringId(facilityId)
    await fetch('/api/facilities/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facilityId }),
    })
    router.push('/dashboard')
  }

  const handleCreateFacility = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/facilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      if (res.status === 409) {
        setCreateError('A facility with this name already exists')
        return
      }
      if (!res.ok) {
        setCreateError('Failed to create facility')
        return
      }
      setFormData({ name: '', address: '', phone: '', timezone: 'America/New_York' })
      setShowCreateForm(false)
      router.refresh()
    } catch {
      setCreateError('Failed to create facility')
    } finally {
      setCreating(false)
    }
  }

  const startEdit = (f: FacilityInfo) => {
    setEditingId(f.id)
    setEditData({
      name: f.name,
      address: f.address ?? '',
      phone: f.phone ?? '',
      timezone: f.timezone,
      paymentType: f.paymentType,
      contactEmail: f.contactEmail ?? '',
    })
    setEditError(null)
  }

  const handleSaveEdit = async (id: string) => {
    setEditSaving(true)
    setEditError(null)
    try {
      const res = await fetch(`/api/super-admin/facility/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editData),
      })
      if (res.status === 409) {
        setEditError('A facility with this name already exists')
        return
      }
      if (!res.ok) {
        setEditError('Failed to save changes')
        return
      }
      setEditingId(null)
      router.refresh()
    } catch {
      setEditError('Failed to save changes')
    } finally {
      setEditSaving(false)
    }
  }

  const handleToggleActive = async (f: FacilityInfo, newActive: boolean) => {
    setTogglingId(f.id)
    setDeactivatingId(null)
    try {
      await fetch(`/api/super-admin/facility/${f.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: newActive }),
      })
      router.refresh()
    } catch {
      // silently fail
    } finally {
      setTogglingId(null)
    }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/super-admin/facility/${id}`, { method: 'DELETE' })
      if (res.status === 409) {
        const body = await res.json()
        setDeleteError(body.error)
        setDeleteConfirmId(null)
        return
      }
      if (!res.ok) {
        setDeleteError('Failed to delete facility')
        return
      }
      setLocalFacilities((prev) => prev.filter((f) => f.id !== id))
      setDeleteConfirmId(null)
    } catch {
      setDeleteError('Failed to delete facility')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          {/* Title row */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1
                className="text-2xl font-normal text-stone-900"
                style={{ fontFamily: "'DM Serif Display', serif" }}
              >
                Master Admin
              </h1>
              <p className="text-sm text-stone-500 mt-1">
                {localFacilities.length} {localFacilities.length === 1 ? 'facility' : 'facilities'} total
              </p>
            </div>
            {activeTab === 'facilities' && (
              <button
                onClick={() => { setShowCreateForm((v) => !v); setCreateError(null) }}
                className="px-4 py-2.5 rounded-2xl text-sm font-medium text-white transition-colors"
                style={{ backgroundColor: '#8B2E4A' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#72253C')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#8B2E4A')}
              >
                {showCreateForm ? 'Cancel' : '+ Create Facility'}
              </button>
            )}
            {activeTab === 'franchises' && (
              <button
                onClick={() => { setShowCreateFranchise((v) => !v); setFranchiseFormError(null) }}
                className="px-4 py-2.5 rounded-2xl text-sm font-medium text-white transition-colors"
                style={{ backgroundColor: '#8B2E4A' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#72253C')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#8B2E4A')}
              >
                {showCreateFranchise ? 'Cancel' : '+ New Franchise'}
              </button>
            )}
          </div>
          {/* Toolbar row */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-stone-400 mr-1">Import:</span>
              <a
                href="/master-admin/import-quickbooks"
                className="text-xs px-2.5 py-1 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors"
              >
                QB Customers
              </a>
              <a
                href="/master-admin/import-billing-history"
                className="text-xs px-2.5 py-1 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors"
              >
                QB Billing
              </a>
              <a
                href="/master-admin/import-facilities-csv"
                className="text-xs px-2.5 py-1 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors"
              >
                Facilities
              </a>
            </div>
            {activeTab === 'facilities' && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 text-xs text-stone-500">
                  Sort:
                  <button
                    onClick={() => setFacilitySortBy('fid')}
                    className={`px-2.5 py-0.5 rounded-full transition-colors ${
                      facilitySortBy === 'fid'
                        ? 'bg-stone-200 text-stone-800 font-semibold'
                        : 'hover:bg-stone-100 text-stone-500'
                    }`}
                  >
                    FID
                  </button>
                  <button
                    onClick={() => setFacilitySortBy('name')}
                    className={`px-2.5 py-0.5 rounded-full transition-colors ${
                      facilitySortBy === 'name'
                        ? 'bg-stone-200 text-stone-800 font-semibold'
                        : 'hover:bg-stone-100 text-stone-500'
                    }`}
                  >
                    Name
                  </button>
                </div>
                {inactiveCount > 0 && (
                  <button
                    onClick={() => setShowInactive((v) => !v)}
                    className="text-xs px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors"
                  >
                    {showInactive ? 'Hide inactive' : `Show inactive (${inactiveCount})`}
                  </button>
                )}
              </div>
            )}
          </div>
          {/* Tab bar */}
          <div className="flex gap-1 bg-white rounded-xl border border-stone-200 p-1">
            {(['facilities', 'franchises', 'requests', 'merge', 'reports', 'debug'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'flex-1 py-1.5 text-xs font-semibold rounded-lg capitalize transition-all duration-150',
                  activeTab === tab ? 'bg-[#8B2E4A] text-white' : 'text-stone-600 hover:bg-stone-100'
                )}
              >
                {tab === 'requests' && requestsList.length > 0
                  ? `Requests (${requestsList.length})`
                  : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Create Facility Form */}
        {showCreateForm && (
          <form
            onSubmit={handleCreateFacility}
            className="bg-white rounded-2xl border border-stone-200 p-6 mb-8 shadow-sm"
          >
            <h2
              className="text-lg font-bold text-stone-900 mb-4"
              style={{ fontFamily: "'DM Serif Display', serif" }}
            >
              New Facility
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1">Name *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => { setFormData((d) => ({ ...d, name: e.target.value })); setCreateError(null) }}
                  className={cn(
                    'w-full px-3 py-2 rounded-xl border text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]',
                    createError ? 'border-red-400' : 'border-stone-200'
                  )}
                  placeholder="Sunrise Senior Living"
                />
                {createError && (
                  <p className="text-xs text-red-600 mt-1">{createError}</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1">Address</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData((d) => ({ ...d, address: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
                  placeholder="123 Main St, City, ST"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1">Phone</label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => setFormData((d) => ({ ...d, phone: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
                  placeholder="(555) 123-4567"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1">Timezone</label>
                <select
                  value={formData.timezone}
                  onChange={(e) => setFormData((d) => ({ ...d, timezone: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A] bg-white"
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label} ({tz.value})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="submit"
                disabled={creating}
                className="px-5 py-2.5 rounded-2xl text-sm font-medium text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#8B2E4A' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#0B6163')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#8B2E4A')}
              >
                {creating ? 'Creating...' : 'Create Facility'}
              </button>
            </div>
          </form>
        )}

        {/* Pending Access Requests */}
        {activeTab === 'requests' && requestsList.length > 0 && (
          <div className="mb-8">
            <h2
              className="text-lg font-bold text-stone-900 mb-4"
              style={{ fontFamily: "'DM Serif Display', serif" }}
            >
              Pending Requests
              <span className="ml-2 inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">
                {requestsList.length}
              </span>
            </h2>
            <div className="space-y-3">
              {requestsList.map((req) => (
                <div key={req.id} className="bg-white rounded-2xl border border-stone-200 p-5 shadow-sm">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <p className="text-sm font-semibold text-stone-900">{req.fullName || '—'}</p>
                      <p className="text-xs text-stone-500">{req.email}</p>
                      {req.createdAt && (
                        <p className="text-xs text-stone-400 mt-0.5">
                          {new Date(req.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                      )}
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-stone-100 text-stone-600 uppercase tracking-wide">
                      {req.role}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                    <div>
                      <label className="block text-xs font-medium text-stone-600 mb-1">Assign to facility *</label>
                      <select
                        value={assignFacility[req.id] ?? ''}
                        onChange={(e) => setAssignFacility((prev) => ({ ...prev, [req.id]: e.target.value }))}
                        className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
                      >
                        <option value="">Select facility…</option>
                        {activeFacilities.map((f) => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-stone-600 mb-1">Role</label>
                      <select
                        value={assignRole[req.id] ?? 'stylist'}
                        onChange={(e) => setAssignRole((prev) => ({ ...prev, [req.id]: e.target.value }))}
                        className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
                      >
                        <option value="stylist">Stylist</option>
                        <option value="admin">Admin</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    </div>
                    {(assignRole[req.id] ?? req.role) === 'stylist' && (
                      <div>
                        <label className="block text-xs font-medium text-stone-600 mb-1">Commission %</label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          placeholder="50"
                          value={assignCommission[req.id] ?? ''}
                          onChange={(e) => setAssignCommission((prev) => ({ ...prev, [req.id]: e.target.value }))}
                          className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      onClick={() => handleRequestAction(req.id, 'deny')}
                      disabled={actioningRequestId === req.id}
                      className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-stone-600 hover:bg-stone-100 border border-stone-200 transition-colors disabled:opacity-50"
                    >
                      Deny
                    </button>
                    <button
                      onClick={() => handleRequestAction(req.id, 'approve')}
                      disabled={actioningRequestId === req.id || !assignFacility[req.id]}
                      className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-white transition-colors disabled:opacity-50"
                      style={{ backgroundColor: '#8B2E4A' }}
                    >
                      {actioningRequestId === req.id ? 'Approving…' : 'Approve'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'requests' && requestsList.length === 0 && (
          <div className="text-center py-16 text-sm text-stone-400">No pending access requests</div>
        )}

        {/* Toast */}
        {requestToast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-stone-900 text-white text-sm font-medium px-5 py-2.5 rounded-2xl shadow-xl z-50">
            {requestToast}
          </div>
        )}

        {activeTab === 'reports' && <ReportsTab />}

        {activeTab === 'merge' && <MergeTab />}

        {activeTab === 'debug' && <DebugTab facilities={activeFacilities} currentFacilityId={currentFacilityId} />}

        {activeTab === 'facilities' && (
        <>
        {/* Delete error banner (appears above grid if delete blocked by bookings) */}
        {deleteError && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-sm text-red-700 flex items-center justify-between">
            <span>{deleteError}</span>
            <button type="button" aria-label="Dismiss error" onClick={() => setDeleteError(null)} className="text-red-400 hover:text-red-600 ml-4 shrink-0">✕</button>
          </div>
        )}

        {/* Facility Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {sortedFacilities.map((f) => (
            <div
              key={f.id}
              className={cn(
                'bg-white rounded-2xl border border-stone-200 p-5 shadow-sm transition-shadow hover:shadow-md',
                !f.active && 'opacity-60'
              )}
            >
              {editingId === f.id ? (
                /* Edit form */
                <div>
                  <div className="grid grid-cols-1 gap-3 mb-4">
                    <div>
                      <label className="block text-xs font-medium text-stone-600 mb-1">Name *</label>
                      <input
                        type="text"
                        value={editData.name ?? ''}
                        onChange={(e) => { setEditData((d) => ({ ...d, name: e.target.value })); setEditError(null) }}
                        className={cn(
                          'w-full px-3 py-2 rounded-xl border text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]',
                          editError ? 'border-red-400' : 'border-stone-200'
                        )}
                      />
                      {editError && (
                        <p className="text-xs text-red-600 mt-1">{editError}</p>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-stone-600 mb-1">Address</label>
                        <input
                          type="text"
                          value={editData.address ?? ''}
                          onChange={(e) => setEditData((d) => ({ ...d, address: e.target.value }))}
                          className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-stone-600 mb-1">Phone</label>
                        <input
                          type="text"
                          value={editData.phone ?? ''}
                          onChange={(e) => setEditData((d) => ({ ...d, phone: e.target.value }))}
                          className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-stone-600 mb-1">Timezone</label>
                        <select
                          value={editData.timezone ?? 'America/New_York'}
                          onChange={(e) => setEditData((d) => ({ ...d, timezone: e.target.value }))}
                          className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 focus:outline-none bg-white"
                        >
                          {TIMEZONES.map((tz) => (
                            <option key={tz.value} value={tz.value}>{tz.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-stone-600 mb-1">Payment Type</label>
                        <select
                          value={editData.paymentType ?? 'facility'}
                          onChange={(e) => setEditData((d) => ({ ...d, paymentType: e.target.value }))}
                          className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 focus:outline-none bg-white"
                        >
                          {PAYMENT_TYPES.map((pt) => (
                            <option key={pt.value} value={pt.value}>{pt.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-stone-600 mb-1">Contact Email</label>
                      <input
                        type="email"
                        value={(editData as { contactEmail?: string }).contactEmail ?? ''}
                        onChange={(e) => setEditData((d) => ({ ...d, contactEmail: e.target.value }))}
                        placeholder="admin@facility.com"
                        className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      onClick={() => { setEditingId(null); setEditError(null) }}
                      className="px-3 py-1.5 rounded-xl text-xs font-medium text-stone-600 hover:bg-stone-100 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleSaveEdit(f.id)}
                      disabled={editSaving}
                      className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-white disabled:opacity-50"
                      style={{ backgroundColor: '#8B2E4A' }}
                    >
                      {editSaving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                /* View mode */
                <>
                  <div className="flex items-start justify-between mb-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-bold text-stone-900 flex items-center gap-2 flex-wrap">
                        {f.facilityCode ? (
                          <span className="inline-flex items-center rounded-md bg-stone-100 text-stone-500 text-xs font-mono px-1.5 py-0.5 shrink-0">
                            {f.facilityCode}
                          </span>
                        ) : (
                          <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                            No FID
                          </span>
                        )}
                        <span className="truncate">
                          {f.name || <span className="italic text-stone-400">Unnamed Facility</span>}
                        </span>
                      </h3>
                      {f.adminEmail && (
                        <p className="text-xs text-stone-400 mt-0.5 truncate">{f.adminEmail}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-stone-100 text-stone-600 uppercase tracking-wide">
                        {f.paymentType}
                      </span>
                      {!f.active && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-600 uppercase tracking-wide">
                          Inactive
                        </span>
                      )}
                      <button
                        onClick={() => startEdit(f)}
                        className="p-1 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
                        title="Edit facility"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex items-center gap-1.5">
                      <span className="text-lg font-bold text-stone-900">{f.residentCount}</span>
                      <span className="text-xs text-stone-500">residents</span>
                    </div>
                    <div className="w-px h-4 bg-stone-200" />
                    <div className="flex items-center gap-1.5">
                      <span className="text-lg font-bold text-stone-900">{f.stylistCount}</span>
                      <span className="text-xs text-stone-500">stylists</span>
                    </div>
                    <div className="w-px h-4 bg-stone-200" />
                    <div className="flex items-center gap-1.5">
                      <span className="text-lg font-bold text-stone-900">{f.bookingsThisMonth}</span>
                      <span className="text-xs text-stone-500">bookings</span>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-stone-400">
                      {f.createdAt
                        ? `Created ${new Date(f.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                        : ''}
                    </span>
                    <div className="flex items-center gap-2">
                      {f.active ? (
                        /* Active: Deactivate button */
                        deactivatingId === f.id ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-stone-500">Deactivate {(f.name || 'this facility').split(' ')[0]}?</span>
                            <button
                              onClick={() => handleToggleActive(f, false)}
                              disabled={togglingId === f.id}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50"
                            >
                              {togglingId === f.id ? '...' : 'Yes'}
                            </button>
                            <button
                              onClick={() => setDeactivatingId(null)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-stone-600 hover:bg-stone-100 transition-colors"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeactivatingId(f.id)}
                            className="px-3 py-1.5 rounded-xl text-xs font-medium text-stone-500 hover:text-red-600 hover:bg-red-50 border border-stone-200 hover:border-red-200 transition-colors"
                          >
                            Deactivate
                          </button>
                        )
                      ) : (
                        /* Inactive: Reactivate + Delete */
                        <>
                          {deleteConfirmId === f.id ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] text-stone-500">Delete permanently?</span>
                              <button
                                onClick={() => handleDelete(f.id)}
                                disabled={deletingId === f.id}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50"
                              >
                                {deletingId === f.id ? '...' : 'Yes, delete'}
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(null)}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-stone-600 hover:bg-stone-100 transition-colors"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <>
                              <button
                                onClick={() => { setDeleteConfirmId(f.id); setDeleteError(null) }}
                                className="p-1.5 rounded-lg text-stone-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                title="Delete facility"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="3 6 5 6 21 6" />
                                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                  <path d="M10 11v6M14 11v6" />
                                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                                </svg>
                              </button>
                              <button
                                onClick={() => handleToggleActive(f, true)}
                                disabled={togglingId === f.id}
                                className="px-3 py-1.5 rounded-xl text-xs font-medium text-green-700 hover:bg-green-50 border border-green-200 transition-colors disabled:opacity-50"
                              >
                                {togglingId === f.id ? '...' : 'Reactivate'}
                              </button>
                            </>
                          )}
                        </>
                      )}
                      <button
                        onClick={() => handleEnterFacility(f.id)}
                        disabled={enteringId === f.id}
                        className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-white transition-colors disabled:opacity-50"
                        style={{ backgroundColor: '#8B2E4A' }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#0B6163')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#8B2E4A')}
                      >
                        {enteringId === f.id ? 'Entering...' : 'Enter as Admin'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {sortedFacilities.length === 0 && (
          <div className="text-center py-16">
            <p className="text-stone-400 text-sm">
              {localFacilities.length === 0
                ? 'No facilities yet. Create one to get started.'
                : 'No active facilities.'}
            </p>
          </div>
        )}
        </>
        )}

        {activeTab === 'franchises' && (
        <div className="mt-4">
          {/* Franchises Section */}
          <div className="mt-0">

          {showCreateFranchise && (
            <form
              onSubmit={handleCreateFranchise}
              className="bg-white rounded-2xl border border-stone-200 p-6 mb-6 shadow-sm"
            >
              <h3 className="text-base font-semibold text-stone-900 mb-4">New Franchise</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1">Franchise Name *</label>
                  <input
                    type="text"
                    required
                    value={franchiseForm.name}
                    onChange={(e) => { setFranchiseForm((d) => ({ ...d, name: e.target.value })); setFranchiseFormError(null) }}
                    placeholder="Sunrise Group"
                    className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1">Owner Email *</label>
                  <input
                    type="email"
                    required
                    value={franchiseForm.ownerEmail}
                    onChange={(e) => { setFranchiseForm((d) => ({ ...d, ownerEmail: e.target.value })); setFranchiseFormError(null) }}
                    placeholder="owner@example.com"
                    className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
                  />
                </div>
              </div>
              <div className="mb-4">
                <label className="block text-xs font-medium text-stone-600 mb-2">Facilities *</label>
                <div className="flex flex-wrap gap-2">
                  {activeFacilities.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => toggleFranchiseFacility(f.id, franchiseForm.facilityIds, (ids) => setFranchiseForm((d) => ({ ...d, facilityIds: ids })))}
                      className={cn(
                        'px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors',
                        franchiseForm.facilityIds.includes(f.id)
                          ? 'bg-[#8B2E4A] text-white border-[#8B2E4A]'
                          : 'bg-white text-stone-600 border-stone-200 hover:border-[#8B2E4A]'
                      )}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
                {franchiseForm.facilityIds.length === 0 && (
                  <p className="text-xs text-stone-400 mt-1">Select at least one facility</p>
                )}
              </div>
              {franchiseFormError && (
                <p className="text-xs text-red-600 mb-3">{franchiseFormError}</p>
              )}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={creatingFranchise || franchiseForm.facilityIds.length === 0}
                  className="px-5 py-2.5 rounded-2xl text-sm font-medium text-white transition-colors disabled:opacity-50"
                  style={{ backgroundColor: '#8B2E4A' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#0B6163')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#8B2E4A')}
                >
                  {creatingFranchise ? 'Creating...' : 'Create Franchise'}
                </button>
              </div>
            </form>
          )}

          {localFranchises.length === 0 && !showCreateFranchise && (
            <p className="text-sm text-stone-400 py-6 text-center">No franchises yet.</p>
          )}

          <div className="space-y-4">
            {localFranchises.map((f) => (
              <div key={f.id} className="bg-white rounded-2xl border border-stone-200 p-5 shadow-sm">
                {editingFranchiseId === f.id ? (
                  <div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                      <div>
                        <label className="block text-xs font-medium text-stone-600 mb-1">Name</label>
                        <input
                          type="text"
                          value={franchiseEditForm.name}
                          onChange={(e) => setFranchiseEditForm((d) => ({ ...d, name: e.target.value }))}
                          className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-stone-600 mb-1">Owner Email</label>
                        <input
                          type="email"
                          value={franchiseEditForm.ownerEmail}
                          onChange={(e) => setFranchiseEditForm((d) => ({ ...d, ownerEmail: e.target.value }))}
                          className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
                        />
                      </div>
                    </div>
                    <div className="mb-4">
                      <label className="block text-xs font-medium text-stone-600 mb-2">Facilities</label>
                      <div className="flex flex-wrap gap-2">
                        {activeFacilities.map((fac) => (
                          <button
                            key={fac.id}
                            type="button"
                            onClick={() => toggleFranchiseFacility(fac.id, franchiseEditForm.facilityIds, (ids) => setFranchiseEditForm((d) => ({ ...d, facilityIds: ids })))}
                            className={cn(
                              'px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors',
                              franchiseEditForm.facilityIds.includes(fac.id)
                                ? 'bg-[#8B2E4A] text-white border-[#8B2E4A]'
                                : 'bg-white text-stone-600 border-stone-200 hover:border-[#8B2E4A]'
                            )}
                          >
                            {fac.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    {franchiseEditError && (
                      <p className="text-xs text-red-600 mb-3">{franchiseEditError}</p>
                    )}
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => { setEditingFranchiseId(null); setFranchiseEditError(null) }}
                        className="px-3 py-1.5 rounded-xl text-xs font-medium text-stone-600 hover:bg-stone-100 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleSaveFranchise(f.id)}
                        disabled={savingFranchiseId === f.id}
                        className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-white disabled:opacity-50"
                        style={{ backgroundColor: '#8B2E4A' }}
                      >
                        {savingFranchiseId === f.id ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="text-base font-bold text-stone-900">{f.name}</h3>
                        {f.ownerEmail && (
                          <p className="text-xs text-stone-500 mt-0.5">{f.ownerEmail}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => startEditFranchise(f)}
                          className="p-1 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
                          title="Edit franchise"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        {deleteFranchiseConfirmId === f.id ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-stone-500">Delete?</span>
                            <button
                              onClick={() => handleDeleteFranchise(f.id)}
                              disabled={deletingFranchiseId === f.id}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50"
                            >
                              {deletingFranchiseId === f.id ? '...' : 'Yes'}
                            </button>
                            <button
                              onClick={() => setDeleteFranchiseConfirmId(null)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-stone-600 hover:bg-stone-100 transition-colors"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteFranchiseConfirmId(f.id)}
                            className="p-1 rounded-lg text-stone-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            title="Delete franchise"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                              <path d="M10 11v6M14 11v6" />
                              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                    {f.facilities.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {f.facilities.map((fac) => (
                          <span
                            key={fac.id}
                            className="px-2.5 py-1 rounded-xl text-[11px] font-medium bg-stone-100 text-stone-600"
                          >
                            {fac.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
          </div>
        </div>
        )}

      </div>
    </div>
  )
}
