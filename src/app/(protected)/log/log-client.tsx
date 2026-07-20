'use client'

import { useState, useEffect, useRef } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { cn, formatCents, formatTime } from '@/lib/utils'
import { getLocalParts, fromDateTimeLocalInTz } from '@/lib/time'
import { formatPricingLabel } from '@/lib/pricing'
import {
  buildCategoryPriority,
  sortCategoryGroups,
  sortServicesWithinCategory,
} from '@/lib/service-sort'
import { SkeletonBookingCard } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import dynamic from 'next/dynamic'
// Stripe Elements stays out of the daily-log bundle until a card payment is taken
const TakePaymentModal = dynamic(
  () => import('@/components/payments/take-payment-modal').then((m) => m.TakePaymentModal),
  { ssr: false },
)
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh'
import { queueableFetch, isQueued, subscribePending } from '@/lib/offline-queue'
import { cachedFetch, saveSnapshot, cacheTimeLabel } from '@/lib/read-cache'
import { enqueuePhoto } from '@/lib/offline-photo-queue'
import { filterFacilitiesForSwitcher, switchFacility } from '@/lib/facility-switch'
import type { BookingUpdateInput } from '@/lib/validation/booking-update'
import type { BookingCreateInput } from '@/lib/validation/booking-create'
import type { LogEntryInput } from '@/lib/validation/log-entry'
import type { ResidentCreateInput } from '@/lib/validation/resident-create'
import type { Resident, Stylist, Service } from '@/types'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { useToast } from '@/components/ui/toast'
// Phase 25 — the OCR review modal (1500+ LOC) and sheets-history modal only
// open on demand; keep them out of the daily log's initial bundle.
const OcrImportModal = dynamic(
  () => import('./ocr-import-modal').then((m) => m.OcrImportModal),
  { ssr: false },
)
const LogSheetsModal = dynamic(
  () => import('@/components/log/log-sheets-modal').then((m) => m.LogSheetsModal),
  { ssr: false },
)
import { HelpTip } from '@/components/ui/help-tip'
import { openPeek } from '@/lib/peek-drawer'
import { ExportDailyLogsModal } from '@/components/exports/export-daily-logs-modal'
import { ExportDailyLogsMultiModal, type ExportFacilityOption } from '@/components/exports/export-daily-logs-multi-modal'
import { EmailDayLogModal } from '@/components/exports/email-day-log-modal'
import { PAYMENT_TYPE_OPTIONS, parsePaymentCombo, comboLabel } from '@/lib/payments'


interface LogBooking {
  id: string
  startTime: string
  endTime: string
  status: string
  paymentStatus: string
  cancellationReason: string | null
  priceCents: number | null
  notes: string | null
  selectedQuantity: number | null
  selectedOption: string | null
  addonTotalCents: number | null
  addonServiceIds: string[] | null
  serviceIds: string[] | null
  serviceNames: string[] | null
  totalDurationMinutes: number | null
  source?: string | null
  rawServiceName?: string | null
  importBatch?: { id: string; fileName: string } | null
  tipCents: number | null
  paymentMethod?: string | null
  resident: Resident
  stylist: Stylist
  service: Service | null
}

interface LogEntryData {
  id: string
  stylistId: string
  date: string
  notes: string | null
  finalized: boolean
  finalizedAt: string | null
}

interface LogClientProps {
  initialDate: string
  initialBookings: LogBooking[]
  initialLogEntries: LogEntryData[]
  residents: Resident[]
  stylists: Stylist[]
  services: Service[]
  stylistFilter?: string | null
  serviceCategoryOrder?: string[] | null
  // Phase 12F: facility's IANA timezone — drives row times, finalized timestamp,
  // walk-in time picker default + submit conversion, "today/yesterday/tomorrow" labels.
  facilityTimezone: string
  facilityId: string
  facilityName: string
  role?: string
  exportFacilities?: ExportFacilityOption[]
  // Master admin (env-email match) — role alone can't signal it (their
  // facility_users row is a plain 'admin'). Drives the Sheets modal Move gate.
  isMaster?: boolean
  // P30 — stylist account with no linked stylist profile: read-only + banner
  unlinkedStylist?: boolean
  carePrefs?: Record<string, { styleNotes: string | null; allergyNotes: string | null }>
}

// Round a date to nearest 30 min IN THE FACILITY'S TIMEZONE.
function roundToNearest30(date: Date, tz: string): string {
  const ms = 30 * 60 * 1000
  const rounded = new Date(Math.round(date.getTime() / ms) * ms)
  const p = getLocalParts(rounded, tz)
  return `${String(p.hours).padStart(2, '0')}:${String(p.minutes).padStart(2, '0')}`
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function serviceDisplayName(booking: LogBooking, allServices: Service[]): string {
  // Prefer denormalized serviceNames (multi-service bookings), fall back to single service
  const primaryNames =
    booking.serviceNames && booking.serviceNames.length > 0
      ? booking.serviceNames
      : booking.service
        ? [booking.service.name]
        : booking.rawServiceName
          ? [booking.rawServiceName]
          : ['Unknown service']
  const addonNames = (booking.addonServiceIds ?? [])
    .map((id) => allServices.find((s) => s.id === id)?.name)
    .filter((n): n is string => Boolean(n))
  const all = [...primaryNames, ...addonNames]
  return all.join(' + ')
}

function formatLogDate(dateStr: string, tz: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  // Phase 12F — "today" anchors to the facility's calendar, not the viewer's
  const todayParts = getLocalParts(new Date(), tz)
  const today = `${todayParts.year}-${String(todayParts.month).padStart(2, '0')}-${String(todayParts.day).padStart(2, '0')}`
  const yesterday = addDays(today, -1)
  const tomorrow = addDays(today, 1)
  if (dateStr === today) return 'Today'
  if (dateStr === yesterday) return 'Yesterday'
  if (dateStr === tomorrow) return 'Tomorrow'
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

// Pull a human-readable message out of an API error response. Handles a plain
// string `error`, a Zod `flatten()` object ({ fieldErrors, formErrors }), and the
// `{ error: { fieldErrors, formErrors } }` shape the booking PUT returns on 422 —
// so the daily log shows the real reason instead of a generic "Update failed".
function firstErrorMessage(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null
  const err = (json as { error?: unknown }).error
  if (typeof err === 'string') return err
  const obj = (err && typeof err === 'object' ? err : json) as {
    fieldErrors?: Record<string, string[]>
    formErrors?: string[]
  }
  const field = obj.fieldErrors && Object.values(obj.fieldErrors).flat().find(Boolean)
  if (field) return field
  const form = obj.formErrors?.find(Boolean)
  return form ?? null
}

export function LogClient({
  initialDate,
  initialBookings,
  initialLogEntries,
  residents,
  stylists,
  services,
  stylistFilter,
  serviceCategoryOrder,
  facilityTimezone,
  facilityId,
  facilityName,
  role = 'admin',
  exportFacilities,
  isMaster = false,
  unlinkedStylist = false,
  carePrefs = {},
}: LogClientProps) {
  const wiServiceCategoryPriority = buildCategoryPriority(serviceCategoryOrder)
  // facility_staff is read-only; bookkeeper can scan and edit billing fields.
  // P30 — an UNLINKED stylist account is read-only until the admin links it
  // (otherwise every ownership check would 403 anyway; fail clearly instead).
  const canWrite =
    (role === 'admin' || role === 'super_admin' || role === 'stylist' || role === 'bookkeeper') &&
    !(role === 'stylist' && unlinkedStylist)
  const [date, setDate] = useState(initialDate)
  // Phase 17 — set when a day was served from the offline read-cache
  const [offlineAt, setOfflineAt] = useState<number | null>(null)
  const [showLogDatePicker, setShowLogDatePicker] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [bookings, setBookings] = useState(initialBookings)
  const [payBooking, setPayBooking] = useState<LogBooking | null>(null)
  const [logEntries, setLogEntries] = useState(initialLogEntries)
  const [loading, setLoading] = useState(false)
  // Increments on each successful fetch to re-trigger the enter animation
  const [contentKey, setContentKey] = useState(0)

  // Status updates
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  // Collapsible stylist sections
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const toggleCollapsed = (id: string) => setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))

  // Finalize / Unfinalize
  const [confirmFinalizeId, setConfirmFinalizeId] = useState<string | null>(null)
  const [finalizingId, setFinalizingId] = useState<string | null>(null)
  const [unfinalizingId, setUnfinalizingId] = useState<string | null>(null)

  // Log notes (per stylist, keyed by stylistId)
  const [notes, setNotes] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {}
    initialLogEntries.forEach((e) => { m[e.stylistId] = e.notes ?? '' })
    return m
  })
  const [savingNotesId, setSavingNotesId] = useState<string | null>(null)

  // Inline booking editing
  const [editingBookingId, setEditingBookingId] = useState<string | null>(null)
  const [editPrice, setEditPrice] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editTipCents, setEditTipCents] = useState('')
  const [editPaymentCombo, setEditPaymentCombo] = useState('Unpaid (Invoice)')
  const [editDate, setEditDate] = useState('')
  const [editResidentId, setEditResidentId] = useState<string | null>(null)
  const [editResidentName, setEditResidentName] = useState('')
  const [editServiceId, setEditServiceId] = useState<string | null>(null)
  const [editServiceName, setEditServiceName] = useState('')
  const [editServiceCreate, setEditServiceCreate] = useState(false) // typing a brand-new service
  const [editStylistId, setEditStylistId] = useState<string | null>(null)
  // Current stylist's display name — the fallback <option> when the booking's
  // stylist isn't in the page roster (cross-facility/duplicate stylist rows).
  const [editStylistName, setEditStylistName] = useState('')
  const [editRoomNumber, setEditRoomNumber] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const startEditBooking = (booking: LogBooking) => {
    setEditingBookingId(booking.id)
    setEditPrice(((booking.priceCents ?? booking.service?.priceCents ?? 0) / 100).toFixed(2))
    setEditNotes(booking.notes ?? '')
    setEditTipCents(booking.tipCents != null ? (booking.tipCents / 100).toFixed(2) : '')
    setEditPaymentCombo(comboLabel(booking.paymentStatus, booking.paymentMethod ?? null))
    const p = getLocalParts(new Date(booking.startTime), facilityTimezone)
    setEditDate(`${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`)
    setEditResidentId(booking.resident.id)
    setEditResidentName(booking.resident.name)
    setEditServiceId(booking.service?.id ?? null)
    setEditServiceName(booking.service?.name ?? booking.serviceNames?.[0] ?? booking.rawServiceName ?? '')
    setEditServiceCreate(false)
    setEditStylistId(booking.stylist.id)
    setEditStylistName(booking.stylist.name)
    setEditRoomNumber(booking.resident.roomNumber ?? '')
  }

  const cancelEditBooking = () => {
    setEditingBookingId(null)
    setEditPrice('')
    setEditNotes('')
    setEditTipCents('')
    setEditPaymentCombo('Unpaid (Invoice)')
    setEditDate('')
    setEditResidentId(null)
    setEditResidentName('')
    setEditServiceId(null)
    setEditServiceName('')
    setEditServiceCreate(false)
    setEditStylistId(null)
    setEditStylistName('')
    setEditRoomNumber('')
  }

  const saveEditBooking = async () => {
    if (!editingBookingId) return
    const booking = bookings.find((b) => b.id === editingBookingId)
    setSavingEdit(true)
    try {
      const priceCents = Math.round(parseFloat(editPrice) * 100)
      if (isNaN(priceCents) || priceCents < 0) {
        // Never fail silently — a blank/invalid Amount used to make Save a no-op
        // with no feedback, which read as "unable to edit" (bookkeeper report).
        toast('Enter a valid amount (use 0 for free services)', 'error')
        return
      }
      const tipFloat = parseFloat(editTipCents)
      const tipCents = editTipCents.trim() && !isNaN(tipFloat) ? Math.round(tipFloat * 100) : null

      const { paymentStatus, paymentMethod } = parsePaymentCombo(editPaymentCombo)
      // Typed against the route's schema — payload/schema drift fails tsc in CI
      // instead of showing bookkeepers a runtime "Invalid input" (Phase 23).
      const body: BookingUpdateInput = {
        priceCents,
        notes: editNotes.trim() === '' ? null : editNotes.trim(),
        tipCents,
        paymentStatus,
        paymentMethod,
      }

      // Date change: preserve the original time-of-day, just shift the date
      if (booking && editDate) {
        const origParts = getLocalParts(new Date(booking.startTime), facilityTimezone)
        const origDateStr = `${origParts.year}-${String(origParts.month).padStart(2, '0')}-${String(origParts.day).padStart(2, '0')}`
        if (editDate !== origDateStr) {
          const timeStr = `${String(origParts.hours).padStart(2, '0')}:${String(origParts.minutes).padStart(2, '0')}`
          body.startTime = fromDateTimeLocalInTz(`${editDate}T${timeStr}`, facilityTimezone).toISOString()
        }
      }

      // Resident change
      if (editResidentId && editResidentId !== booking?.resident.id) {
        body.residentId = editResidentId
      }

      // Stylist change — correct the stylist after a log-sheet import
      if (editStylistId && editStylistId !== booking?.stylist.id) {
        body.stylistId = editStylistId
      }

      // Service change. If the bookkeeper typed a brand-new service name, create it
      // first (an ad-hoc logging service — source='ocr_import', priced from this row).
      let resolvedServiceId = editServiceId
      if (editServiceCreate && editServiceName.trim() && !resolvedServiceId) {
        const createRes = await fetch('/api/services', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: editServiceName.trim(),
            priceCents: priceCents > 0 ? priceCents : 0,
            durationMinutes: 30,
          }),
        })
        const cj = await createRes.json().catch(() => ({}))
        if (!createRes.ok) {
          toast(firstErrorMessage(cj) ?? 'Could not create service', 'error')
          return
        }
        resolvedServiceId = cj.data?.id ?? null
      }
      if (resolvedServiceId && resolvedServiceId !== booking?.service?.id) {
        // Tiered / multi-option services need a quantity/option the log edit form
        // doesn't collect — the server would 422 with a confusing message. Guard
        // with a clear one instead (edit those from the calendar's booking modal).
        const pickedService = services.find((s) => s.id === resolvedServiceId)
        if (pickedService && (pickedService.pricingType === 'tiered' || pickedService.pricingType === 'multi_option')) {
          toast(`"${pickedService.name}" needs a quantity or option — edit this booking from the Calendar instead`, 'error')
          return
        }
        body.serviceId = resolvedServiceId
      }

      // Room # change — applied to the booking's resident record. Skip when the
      // resident itself is being swapped (the room field still shows the old one).
      if (!body.residentId && editRoomNumber.trim() !== (booking?.resident.roomNumber ?? '')) {
        body.roomNumber = editRoomNumber.trim() || null
      }

      const res = await queueableFetch('Booking edit', `/api/bookings/${editingBookingId}`, {
        method: 'PUT',
        body,
      })
      if (isQueued(res)) {
        // Offline — keep the edit optimistically; the queued PUT reconciles later.
        // The row renders NESTED objects (booking.stylist/service/resident), so a
        // bare `...body` spread (raw FKs) left Stylist/Service/Date edits looking
        // unchanged — resolve them against the page rosters, and mirror the online
        // branch's date-move row removal.
        if (body.startTime) {
          setBookings((prev) => prev.filter((b) => b.id !== editingBookingId))
        } else {
          setBookings((prev) => prev.map((b) => {
            if (b.id !== editingBookingId) return b
            const merged = { ...b, ...body } as typeof b
            if (body.stylistId) {
              const st = stylists.find((s) => s.id === body.stylistId)
              if (st) merged.stylist = { ...merged.stylist, id: st.id, name: st.name }
            }
            if (body.serviceId) {
              const sv = services.find((s) => s.id === body.serviceId)
              if (sv) {
                merged.service = { ...(merged.service ?? {}), id: sv.id, name: sv.name } as typeof b.service
                merged.serviceNames = [sv.name]
              }
            }
            if (body.residentId) {
              const rr = residents.find((r) => r.id === body.residentId)
              if (rr) merged.resident = { ...merged.resident, id: rr.id, name: rr.name, roomNumber: rr.roomNumber ?? null }
            }
            if ('roomNumber' in body) {
              merged.resident = { ...merged.resident, roomNumber: body.roomNumber as string | null }
            }
            return merged
          }))
        }
        setEditingBookingId(null)
        toast('Saved on this device — will sync when the connection returns', 'info')
        return
      }
      if (res.ok) {
        const json = await res.json()
        if (body.startTime) {
          // Booking moved to a different date — remove from this day's view
          setBookings((prev) => prev.filter((b) => b.id !== editingBookingId))
          toast('Updated — booking moved to new date', 'success')
        } else {
          setBookings((prev) => prev.map((b) => {
            if (b.id !== editingBookingId) return b
            const merged = { ...b, ...json.data }
            // Room # lives on the resident record, not the booking — patch it locally.
            if ('roomNumber' in body) {
              merged.resident = { ...merged.resident, roomNumber: body.roomNumber as string | null }
            }
            return merged
          }))
          toast('Updated', 'success')
        }
        setEditingBookingId(null)
      } else {
        const json = await res.json().catch(() => ({}))
        toast(firstErrorMessage(json) ?? 'Update failed', 'error')
      }
    } finally {
      setSavingEdit(false)
    }
  }

  // P30 — swipe-to-delete reveal state (mobile)
  const [swipedDeleteId, setSwipedDeleteId] = useState<string | null>(null)
  const swipeRef = useRef<{ x: number; y: number; id: string } | null>(null)

  // Cancels ANY appointment/walk-in (soft-delete: server sets status=cancelled).
  // Was import-only; P30 generalizes it (edit-form Delete + swipe confirm).
  const deleteBookingRow = async (bookingId: string) => {
    setDeletingId(bookingId)
    // 13B: optimistic — remove the row immediately, restore the snapshot on failure.
    const snapshot = bookings
    setBookings((prev) => prev.filter((b) => b.id !== bookingId))
    setConfirmDeleteId(null)
    setSwipedDeleteId(null)
    setEditingBookingId(null)
    try {
      // P32 — queueable: a delete on dropped wifi keeps the optimistic removal
      // and replays when connectivity returns (was a plain fetch that rolled
      // back with a network error).
      const qres = await queueableFetch('Appointment delete', `/api/bookings/${bookingId}`, {
        method: 'DELETE',
      })
      if (isQueued(qres)) {
        toast("Removed on this device — will sync when you're back online", 'info')
        return
      }
      if (qres.ok) {
        toast('Booking removed', 'success')
      } else {
        const json = await qres.json().catch(() => ({}))
        setBookings(snapshot)
        toast(typeof json.error === 'string' ? json.error : 'Delete failed', 'error')
      }
    } finally {
      setDeletingId(null)
    }
  }

  // Walk-in form
  const [showWalkIn, setShowWalkIn] = useState(false)
  const [wiResidentSearch, setWiResidentSearch] = useState('')
  const [wiResidentDropOpen, setWiResidentDropOpen] = useState(false)
  const [wiResidentId, setWiResidentId] = useState('')
  const [wiServiceId, setWiServiceId] = useState('')
  // Stylists log walk-ins under their own name only — selector locks to self.
  const [wiStylistId, setWiStylistId] = useState(stylistFilter ?? stylists[0]?.id ?? '')
  const [wiTime, setWiTime] = useState(() => roundToNearest30(new Date(), facilityTimezone))
  const [wiAddonServiceIds, setWiAddonServiceIds] = useState<string[]>([])
  const [wiAdding, setWiAdding] = useState(false)
  const [wiError, setWiError] = useState<string | null>(null)
  const [wiCreateOpen, setWiCreateOpen] = useState(false)
  const [wiCreateName, setWiCreateName] = useState('')
  const [wiCreateRoom, setWiCreateRoom] = useState('')
  const [wiCreating, setWiCreating] = useState(false)
  const [wiCreateError, setWiCreateError] = useState<string | null>(null)
  const [localNewResidents, setLocalNewResidents] = useState<Resident[]>([])

  // OCR import modal
  const [ocrOpen, setOcrOpen] = useState(false)
  const [sheetsOpen, setSheetsOpen] = useState(false)
  // "Undo & edit": holds the confirmed sheets returned by the rollback so the OCR
  // modal can reopen pre-filled (change facility/stylist, re-import).
  const [ocrSeedSheets, setOcrSeedSheets] = useState<unknown[] | null>(null)
  // Facility the rolled-back batch belonged to — seeds the modal's facility picker.
  const [ocrSeedFacilityId, setOcrSeedFacilityId] = useState<string | null>(null)
  const [undoingBatch, setUndoingBatch] = useState(false)

  const { toast } = useToast()

  // F6: offline write-queue pending count (pill in the header while syncing)
  const [pendingWrites, setPendingWrites] = useState(0)
  useEffect(() => subscribePending(setPendingWrites), [])

  // Phase 16 G11 — booking photo capture ("here's the finished style")
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [photoBooking, setPhotoBooking] = useState<{ id: string; residentId: string; residentName: string } | null>(null)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoCaption, setPhotoCaption] = useState('')
  const [photoShare, setPhotoShare] = useState(true)
  const [photoUploading, setPhotoUploading] = useState(false)

  const openPhotoCapture = (booking: { id: string; resident?: { id?: string; name?: string } | null }) => {
    if (!booking.resident?.id) return
    setPhotoBooking({ id: booking.id, residentId: booking.resident.id, residentName: booking.resident.name ?? 'Resident' })
    setPhotoFile(null)
    setPhotoCaption('')
    setPhotoShare(true)
    // Let state settle, then open the camera/picker
    setTimeout(() => photoInputRef.current?.click(), 30)
  }

  const handlePhotoPicked = (file: File | null) => {
    if (!file) return
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  const uploadBookingPhoto = async () => {
    if (!photoBooking || !photoFile) return
    setPhotoUploading(true)
    try {
      const form = new FormData()
      form.append('file', photoFile)
      form.append('bookingId', photoBooking.id)
      form.append('caption', photoCaption.trim())
      form.append('sharedWithFamily', photoShare ? 'true' : 'false')
      const res = await fetch(`/api/residents/${photoBooking.residentId}/photos`, { method: 'POST', body: form })
      const j = await res.json().catch(() => ({}))
      if (res.ok) {
        toast(photoShare ? 'Photo saved — the family can see it in their portal' : 'Photo saved to the style gallery', 'success')
        closePhotoCapture()
      } else {
        toast(typeof j.error === 'string' ? j.error : 'Upload failed', 'error')
      }
    } catch {
      // Phase 18 — offline: park the photo in the IndexedDB queue; it uploads
      // automatically when connectivity returns.
      const queued = await enqueuePhoto({
        residentId: photoBooking.residentId,
        bookingId: photoBooking.id,
        caption: photoCaption.trim(),
        sharedWithFamily: photoShare,
        blob: photoFile,
        fileName: photoFile.name || 'photo.jpg',
      })
      if (queued) {
        toast("Photo saved offline — it'll upload when you're back online", 'success')
        closePhotoCapture()
      } else {
        toast('Network error — photo not uploaded', 'error')
      }
    } finally {
      setPhotoUploading(false)
    }
  }

  const closePhotoCapture = () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoBooking(null)
    setPhotoFile(null)
    setPhotoPreview(null)
    if (photoInputRef.current) photoInputRef.current.value = ''
  }
  const today = new Date().toISOString().split('T')[0]
  const isToday = date === today

  // Phase 17 — snapshot the SSR-seeded day so navigating back to it (or a cold
  // client fetch) works offline. Keyed per facility+date.
  useEffect(() => {
    saveSnapshot(`${facilityId}:log:${initialDate}`, {
      bookings: initialBookings,
      logEntries: initialLogEntries,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { refreshing: pullRefreshing, handlers: pullHandlers } = usePullToRefresh(
    () => navigateDate(date)
  )

  // Navigate dates — network-first with an offline read-cache fallback
  // (Phase 17): when the fetch throws (no connection) the last saved copy of
  // that day is shown with a "saved copy" notice instead of an empty screen.
  const navigateDate = async (newDate: string) => {
    setLoading(true)
    setDate(newDate)
    try {
      const result = await cachedFetch<{ bookings: LogBooking[]; logEntries: LogEntryData[] }>(
        `${facilityId}:log:${newDate}`,
        `/api/log?date=${newDate}`,
        { extract: (json) => (json as { data: { bookings: LogBooking[]; logEntries: LogEntryData[] } }).data },
      )
      if (result && !('httpError' in result)) {
        setBookings(result.data.bookings)
        setLogEntries(result.data.logEntries)
        const m: Record<string, string> = {}
        result.data.logEntries.forEach((e: LogEntryData) => { m[e.stylistId] = e.notes ?? '' })
        setNotes(m)
        setContentKey((k) => k + 1)
        setOfflineAt(result.stale ? result.at : null)
      } else if (result === null) {
        // Offline and no saved copy of that day — say so instead of silence.
        setOfflineAt(null)
        toast("You're offline and this day hasn't been loaded before", 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  // "Undo & edit" — the most recent OCR scan batch among today's visible bookings.
  const todayOcrBatch =
    bookings.find((b) => b.source === 'historical_import' && b.importBatch?.id)?.importBatch ?? null

  const undoBatchAndEdit = async (batchId: string) => {
    setUndoingBatch(true)
    try {
      const res = await fetch(`/api/log/ocr/batch/${batchId}/undo`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast(firstErrorMessage(j) ?? 'Could not undo import', 'error')
        return
      }
      await navigateDate(date) // drop the rolled-back bookings from view
      if (Array.isArray(j.data?.sheets) && j.data.sheets.length > 0) {
        setOcrSeedSheets(j.data.sheets)
        setOcrSeedFacilityId(typeof j.data?.facilityId === 'string' ? j.data.facilityId : null)
        setOcrOpen(true)
      } else {
        toast('Import undone', 'success')
      }
    } finally {
      setUndoingBatch(false)
    }
  }

  // Group bookings by stylist
  const stylistMap = new Map<string, { stylist: Stylist; bookings: LogBooking[] }>()
  for (const b of bookings) {
    const existing = stylistMap.get(b.stylist.id)
    if (!existing) {
      stylistMap.set(b.stylist.id, { stylist: b.stylist, bookings: [b] })
    } else {
      existing.bookings.push(b)
    }
  }
  // Add stylists that have no bookings but have finalized log entries
  for (const entry of logEntries) {
    if (!stylistMap.has(entry.stylistId)) {
      const s = stylists.find((st) => st.id === entry.stylistId)
      if (s) stylistMap.set(entry.stylistId, { stylist: s, bookings: [] })
    }
  }
  const allStylistGroups = Array.from(stylistMap.values()).sort((a, b) =>
    a.stylist.name.localeCompare(b.stylist.name)
  )
  // Stylists VIEW the whole facility day log but can only EDIT their own
  // section (per-booking gating via canEdit + section gating via ownsSection).
  // Their own section sorts first.
  const stylistGroups = stylistFilter
    ? [...allStylistGroups].sort((a, b) =>
        (b.stylist.id === stylistFilter ? 1 : 0) - (a.stylist.id === stylistFilter ? 1 : 0)
      )
    : allStylistGroups

  const getLogEntry = (stylistId: string) =>
    logEntries.find((e) => e.stylistId === stylistId) ?? null

  // Update payment status
  const updatePaymentStatus = async (bookingId: string, currentPaymentStatus: string) => {
    const next =
      currentPaymentStatus === 'unpaid'
        ? 'paid'
        : currentPaymentStatus === 'paid'
        ? 'waived'
        : 'unpaid'
    setUpdatingId(bookingId)
    try {
      // F6: queued offline on network failure — apply optimistically
      const res = await queueableFetch('Payment status', `/api/bookings/${bookingId}`, {
        method: 'PUT',
        body: { paymentStatus: next },
      })
      if (isQueued(res)) {
        setBookings(bookings.map((b) => (b.id === bookingId ? { ...b, paymentStatus: next } : b)))
        toast('Saved offline — will sync when back online', 'info')
        return
      }
      const json = await res.json()
      if (res.ok) {
        setBookings(bookings.map((b) =>
          b.id === bookingId ? { ...b, paymentStatus: json.data.paymentStatus } : b
        ))
      } else {
        toast(firstErrorMessage(json) || 'Could not update payment status', 'error')
      }
    } catch {
      toast('Network error — try again', 'error')
    } finally {
      setUpdatingId(null)
    }
  }

  // Update booking status
  const updateStatus = async (bookingId: string, status: string) => {
    setUpdatingId(bookingId)
    try {
      // F6: queued offline on network failure — apply optimistically
      const res = await queueableFetch('Booking status', `/api/bookings/${bookingId}`, {
        method: 'PUT',
        body: { status },
      })
      if (isQueued(res)) {
        setBookings(bookings.map((b) => (b.id === bookingId ? { ...b, status } : b)))
        toast('Saved offline — will sync when back online', 'info')
        return
      }
      const json = await res.json()
      if (res.ok) {
        setBookings(bookings.map((b) => (b.id === bookingId ? { ...b, status: json.data.status } : b)))
      } else {
        // P30 — NEVER swallow a failed status change: the silent else-branch
        // made Done/No-show look like dead buttons under 403s.
        toast(firstErrorMessage(json) || 'Could not update the appointment', 'error')
      }
    } catch {
      toast('Network error — try again', 'error')
    } finally {
      setUpdatingId(null)
    }
  }

  // Finalize log entry
  const handleFinalize = async (stylistId: string) => {
    if (confirmFinalizeId !== stylistId) {
      setConfirmFinalizeId(stylistId)
      return
    }
    setFinalizingId(stylistId)
    const existing = getLogEntry(stylistId)
    // 13B: optimistic — flip the existing entry to finalized immediately, snapshot
    // for rollback. (The create path has no entry to flip; it stays post-response.)
    const snapshot = logEntries
    if (existing) {
      setLogEntries((prev) =>
        prev.map((e) => (e.stylistId === stylistId ? { ...e, finalized: true } : e)),
      )
      setConfirmFinalizeId(null)
    }
    try {
      const url = existing ? `/api/log/${existing.id}` : '/api/log'
      const method = existing ? ('PUT' as const) : ('POST' as const)
      const body = existing
        ? { finalized: true, notes: notes[stylistId] ?? existing.notes ?? '' }
        : ({ stylistId, date, finalized: true, notes: notes[stylistId] ?? '' } satisfies LogEntryInput)

      // F6: queued offline on network failure — keep the optimistic state
      const res = await queueableFetch('Finalize day', url, { method, body })
      if (isQueued(res)) {
        setConfirmFinalizeId(null)
        toast('Saved offline — will sync when back online', 'info')
        return
      }
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        setLogEntries((prev) => {
          const filtered = prev.filter((e) => e.stylistId !== stylistId)
          return [...filtered, json.data]
        })
        setConfirmFinalizeId(null)
        const finalizedEntry = json.data
        toast('Day finalized', 'success', {
          action: {
            label: 'Undo',
            onClick: () => handleUnfinalize(finalizedEntry.stylistId),
          },
        })
      } else {
        if (existing) setLogEntries(snapshot)
        toast(firstErrorMessage(json) ?? 'Could not finalize the day', 'error')
      }
    } catch {
      if (existing) setLogEntries(snapshot)
      toast('Network error — could not finalize', 'error')
    } finally {
      setFinalizingId(null)
    }
  }

  // Unfinalize log entry
  const handleUnfinalize = async (stylistId: string) => {
    const existing = getLogEntry(stylistId)
    if (!existing) return
    setUnfinalizingId(stylistId)
    try {
      const res = await fetch(`/api/log/${existing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finalized: false }),
      })
      const json = await res.json()
      if (res.ok) {
        setLogEntries((prev) => {
          const filtered = prev.filter((e) => e.stylistId !== stylistId)
          return [...filtered, json.data]
        })
      }
    } finally {
      setUnfinalizingId(null)
    }
  }

  // Save notes — offline-queueable (Phase 17): a dead connection keeps the
  // typed notes locally and syncs the write when back online.
  const saveNotes = async (stylistId: string) => {
    setSavingNotesId(stylistId)
    const existing = getLogEntry(stylistId)
    try {
      const url = existing ? `/api/log/${existing.id}` : '/api/log'
      const method = existing ? 'PUT' : 'POST'
      const body = existing
        ? { notes: notes[stylistId] ?? '' }
        : ({ stylistId, date, notes: notes[stylistId] ?? '' } satisfies LogEntryInput)
      const res = await queueableFetch('Day notes', url, { method, body })
      if (isQueued(res)) {
        toast('Saved offline — will sync when you\'re back online', 'success')
        return
      }
      const json = await res.json()
      if (res.ok) {
        setLogEntries((prev) => {
          const filtered = prev.filter((e) => e.stylistId !== stylistId)
          return [...filtered, json.data]
        })
      }
    } finally {
      setSavingNotesId(null)
    }
  }

  // Add walk-in
  const allResidents = [...residents, ...localNewResidents]
  const filteredResidents = allResidents.filter(
    (r) =>
      r.name.toLowerCase().includes(wiResidentSearch.toLowerCase()) ||
      (r.roomNumber && r.roomNumber.toLowerCase().includes(wiResidentSearch.toLowerCase()))
  )
  const wiAddonServices = services.filter(
    (s) => s.pricingType === 'addon' && s.id !== wiServiceId
  )

  const handleAddWalkIn = async () => {
    if (!wiResidentId) { setWiError('Select a resident'); return }
    if (!wiServiceId) { setWiError('Select a service'); return }
    if (!wiStylistId) { setWiError('Select a stylist'); return }
    if (!wiTime) { setWiError('Enter a time'); return }

    setWiAdding(true)
    setWiError(null)
    try {
      // Phase 12F — interpret wiTime in the facility's tz so a viewer in any
      // browser tz sees their typed "9:00" land at 9 a.m. facility-local.
      const startTime = fromDateTimeLocalInTz(`${date}T${wiTime}`, facilityTimezone)
      // Phase 18 — an offline-created resident has no server id yet: send its
      // name/room inline so the server creates resident + booking atomically.
      const pendingResident = wiResidentId.startsWith('offline-new-')
        ? localNewResidents.find((r) => r.id === wiResidentId)
        : null
      // F6: queued offline on network failure — the row appears after sync
      const res = await queueableFetch('Walk-in booking', '/api/bookings', {
        method: 'POST',
        body: {
          ...(pendingResident
            ? { newResident: { name: pendingResident.name, roomNumber: pendingResident.roomNumber ?? undefined } }
            : { residentId: wiResidentId }),
          serviceId: wiServiceId,
          stylistId: wiStylistId,
          startTime: startTime.toISOString(),
          notes: 'Walk-in',
          ...(wiAddonServiceIds.length > 0 ? { addonServiceIds: wiAddonServiceIds } : {}),
        } satisfies BookingCreateInput,
      })
      if (isQueued(res)) {
        setShowWalkIn(false)
        setWiResidentSearch('')
        setWiResidentId('')
        setWiServiceId('')
        setWiAddonServiceIds([])
        toast('Saved offline — the walk-in will appear once you\'re back online', 'info')
        return
      }
      const json = await res.json()
      if (res.ok) {
        setBookings((prev) => [...prev, json.data].sort(
          (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
        ))
        setShowWalkIn(false)
        setWiResidentSearch('')
        setWiResidentId('')
        setWiServiceId('')
        setWiAddonServiceIds([])
        setWiTime(roundToNearest30(new Date(), facilityTimezone))
        setLocalNewResidents([])
        setWiCreateOpen(false)
        setWiCreateName('')
        setWiCreateRoom('')
        setWiCreateError(null)
        const newBookingId = json.data?.id as string | undefined
        toast('Appointment booked!', 'success', newBookingId ? {
          action: {
            label: 'View',
            onClick: () => {
              document
                .getElementById(`log-booking-${newBookingId}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            },
          },
        } : undefined)
      } else {
        setWiError(json.error?.message ?? json.error ?? 'Failed to add walk-in')
      }
    } catch {
      setWiError('Network error')
    } finally {
      setWiAdding(false)
    }
  }

  // Totals — the list shows the full facility day for every role, so the
  // summary counts the same set. (Stylists view all, edit only their own.)
  const activeBookings = bookings.filter((b) => b.status !== 'cancelled')
  const completedBookings = bookings.filter((b) => b.status === 'completed')
  const totalRevenue = completedBookings.reduce((sum, b) => sum + (b.priceCents ?? b.service?.priceCents ?? 0), 0)

  return (
    <ErrorBoundary>
    <div
      className="page-enter p-4 md:p-6 max-w-3xl mx-auto pb-40 md:pb-0"
      {...pullHandlers}
    >
      {/* F6: pending offline writes */}
      {pendingWrites > 0 && (
        <div className="mb-3 flex justify-center">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            {pendingWrites} change{pendingWrites === 1 ? '' : 's'} waiting to sync
          </span>
        </div>
      )}
      {offlineAt !== null && (
        <div className="mb-3 flex justify-center">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-stone-600 bg-stone-100 border border-stone-200 rounded-full px-3 py-1">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Offline — showing saved copy from {cacheTimeLabel(offlineAt)}
          </span>
        </div>
      )}
      {/* Header — Phase 17: date stepper row; actions inline on md+, second row on mobile */}
      <div className="mb-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigateDate(addDays(date, -1))}
          disabled={loading}
          className="p-3 hover:bg-stone-100 rounded-xl transition-colors text-stone-400 hover:text-stone-700 disabled:opacity-40 min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="flex-1 text-center">
          <div className="flex items-center justify-center gap-2">
            <div className="relative inline-flex items-center">
              <button
                onClick={() => setShowLogDatePicker(v => !v)}
                className="flex items-center gap-1.5 text-xl font-normal text-stone-900 hover:text-stone-600 cursor-pointer transition-colors"
                style={{ fontFamily: "'DM Serif Display', serif" }}
                aria-label="Jump to date"
                title="Jump to date"
              >
                {formatLogDate(date, facilityTimezone)}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-stone-400 mt-0.5 shrink-0">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              </button>
              {showLogDatePicker && (
                <input
                  type="date"
                  autoFocus
                  className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 rounded-xl border border-stone-200 shadow-lg bg-white px-3 py-2 text-sm text-stone-700"
                  value={date}
                  onChange={(e) => {
                    if (e.target.value) {
                      navigateDate(e.target.value)
                      setShowLogDatePicker(false)
                    }
                  }}
                  onBlur={() => setShowLogDatePicker(false)}
                />
              )}
            </div>
            {loading && (
              <div className="w-4 h-4 rounded-full border-2 border-stone-200 border-t-[#8B2E4A] animate-spin shrink-0" />
            )}
            <HelpTip
              tourId="stylist-daily-log"
              label="Daily Log"
              description="Each row is one appointment. Edit price/notes inline, add walk-ins, then finalize the day to lock entries."
            />
          </div>
          <p className="text-xs text-stone-400 mt-0.5">
            {new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
              weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
            })}
          </p>
        </div>
        <button
          onClick={() => navigateDate(addDays(date, 1))}
          disabled={loading}
          className="p-3 hover:bg-stone-100 rounded-xl transition-colors text-stone-400 hover:text-stone-700 disabled:opacity-40 min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        <div className="hidden md:flex items-center gap-3">
          {/* Phase 23 — bookkeepers work across facilities from this page: a
              searchable in-place facility picker (mirrors the /billing combobox;
              only renders when the user can access >1 facility). */}
          {exportFacilities && exportFacilities.length > 1 && (
            <LogFacilityPicker
              facilities={exportFacilities}
              currentFacilityId={facilityId}
            />
          )}
          {(role === 'bookkeeper' || role === 'admin' || role === 'super_admin') && (
            <button
              type="button"
              onClick={() => setSheetsOpen(true)}
              title="Log sheet history"
              aria-label="Log sheet history"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#D4A0B0] bg-[#F9EFF2] text-[#8B2E4A] hover:bg-[#F2E0E6] hover:border-[#C4687A] transition-colors text-xs font-semibold min-h-[44px]"
            >
              <SheetsIcon />
              <span>Sheets</span>
            </button>
          )}
          {role !== 'stylist' && (
          <button
            type="button"
            onClick={() => setShowEmailModal(true)}
            data-tour="log-email-day"
            title="Email day log"
            aria-label="Email day log"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-stone-200 text-stone-600 hover:text-[#8B2E4A] hover:border-[#C4687A] hover:bg-[#F9EFF2]/40 transition-colors text-xs font-semibold min-h-[44px]"
          >
            <EmailIcon />
            <span>Email</span>
          </button>
          )}
          <button
            type="button"
            onClick={() => setShowExportModal(true)}
            data-tour="log-export-excel"
            title="Export to Excel"
            aria-label="Export to Excel"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-stone-200 text-stone-600 hover:text-[#8B2E4A] hover:border-[#C4687A] hover:bg-[#F9EFF2]/40 transition-colors text-xs font-semibold min-h-[44px]"
          >
            <ExportIcon />
            <span>Export</span>
          </button>
        </div>
      </div>
      {/* Mobile action row — own line so the date stepper never gets crushed */}
      <div className="flex md:hidden items-center justify-center gap-2 mt-2 flex-wrap">
        {(role === 'bookkeeper' || role === 'admin' || role === 'super_admin') && (
          <button
            type="button"
            onClick={() => setSheetsOpen(true)}
            aria-label="Log sheet history"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#D4A0B0] bg-[#F9EFF2] text-[#8B2E4A] transition-colors text-xs font-semibold min-h-[44px]"
          >
            <SheetsIcon />
            <span>Sheets</span>
          </button>
        )}
        {role !== 'stylist' && (
        <button
          type="button"
          onClick={() => setShowEmailModal(true)}
          data-tour-mobile="log-email-day"
          aria-label="Email day log"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-stone-200 text-stone-600 transition-colors text-xs font-semibold min-h-[44px]"
        >
          <EmailIcon />
          <span>Email</span>
        </button>
        )}
        <button
          type="button"
          onClick={() => setShowExportModal(true)}
          data-tour-mobile="log-export-excel"
          aria-label="Export to Excel"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-stone-200 text-stone-600 transition-colors text-xs font-semibold min-h-[44px]"
        >
          <ExportIcon />
          <span>Export</span>
        </button>
      </div>
      </div>

      {/* Undo & edit — roll back a scan import and reopen the review pre-filled */}
      {/* P30 — unlinked stylist: page is read-only until the admin links them */}
      {role === 'stylist' && unlinkedStylist && (
        <div className="mx-4 mb-3 flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2" className="shrink-0 mt-0.5">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <p className="text-sm text-amber-800">
            <span className="font-semibold">Your account isn&apos;t linked to a stylist profile yet.</span>{' '}
            Ask your admin to link you (Settings → Team) — until then the day log is view-only.
          </p>
        </div>
      )}
      {canWrite && todayOcrBatch && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-amber-800 min-w-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
              <path d="M3 7v6h6" /><path d="M21 17a9 9 0 00-15-6.7L3 13" />
            </svg>
            <span className="truncate">Imported from a scanned sheet. Wrong facility or stylist?</span>
          </div>
          <button
            onClick={() => undoBatchAndEdit(todayOcrBatch.id)}
            disabled={undoingBatch}
            className="shrink-0 text-sm font-semibold text-white bg-[#8B2E4A] hover:bg-[#72253C] rounded-xl px-3.5 py-2 transition-colors disabled:opacity-50"
          >
            {undoingBatch ? 'Undoing…' : 'Undo & edit'}
          </button>
        </div>
      )}

      {/* Pull-to-refresh indicator */}
      {pullRefreshing && (
        <div className="flex justify-center pb-3">
          <div className="w-5 h-5 rounded-full border-2 border-stone-200 border-t-[#8B2E4A] animate-spin" />
        </div>
      )}

      {/* Body — skeleton on first load, dims on subsequent fetches */}
      {loading && contentKey === 0 ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <SkeletonBookingCard key={i} />
          ))}
        </div>
      ) : (
      <div
        key={contentKey}
        className={cn(contentKey > 0 && 'log-enter')}
        style={{
          opacity: loading ? 0.5 : 1,
          pointerEvents: loading ? 'none' : 'auto',
          transition: 'opacity 150ms ease',
        }}
      >

      {/* Summary bar */}
      {activeBookings.length > 0 && (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm px-5 py-3 mb-4 flex items-center gap-6">
          <div className="text-center">
            <p className="text-lg font-bold text-stone-900">{activeBookings.length}</p>
            <p className="text-xs text-stone-500">appointments</p>
          </div>
          <div className="w-px h-8 bg-stone-100" />
          <div className="text-center">
            <p className="text-lg font-bold text-green-700">{completedBookings.length}</p>
            <p className="text-xs text-stone-500">completed</p>
          </div>
          <div className="w-px h-8 bg-stone-100" />
          <div className="text-center">
            <p className="text-lg font-bold text-stone-900">{formatCents(totalRevenue)}</p>
            <p className="text-xs text-stone-500">revenue</p>
          </div>
        </div>
      )}

      {/* Walk-in form */}
      {showWalkIn && (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4 mb-4 space-y-3" data-tour="daily-log-walkin-form">
          <p className="text-sm font-semibold text-stone-700">Add Walk-in</p>
          {wiError && <p className="text-xs text-red-600">{wiError}</p>}

          {/* Resident combobox */}
          <div className="relative">
            <input
              type="text"
              value={wiResidentSearch}
              onChange={(e) => {
                setWiResidentSearch(e.target.value)
                setWiResidentDropOpen(true)
                if (wiResidentId) {
                  const r = residents.find((r) => r.id === wiResidentId)
                  if (r && r.name !== e.target.value) setWiResidentId('')
                }
              }}
              onFocus={() => setWiResidentDropOpen(true)}
              onBlur={(e) => {
                const related = e.relatedTarget as HTMLElement | null
                const dropdown = e.currentTarget.closest('.relative')
                if (dropdown && related && dropdown.contains(related)) return
                setTimeout(() => setWiResidentDropOpen(false), 150)
              }}
              aria-label="Search resident" placeholder="Search resident..."
              data-tour="walkin-resident-search"
              className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 focus:shadow-[0_0_0_3px_rgba(139,46,74,0.08)] transition-all"
            />
            {wiResidentDropOpen && (
              <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-stone-200 rounded-xl shadow-lg z-50 max-h-52 overflow-y-auto">
                {wiCreateOpen ? (
                  <div className="p-3 space-y-2">
                    <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">New Resident</p>
                    {wiCreateError && (
                      <p className="text-xs text-red-600">{wiCreateError}</p>
                    )}
                    <input
                      autoFocus
                      tabIndex={0}
                      value={wiCreateName}
                      onChange={(e) => setWiCreateName(e.target.value)}
                      aria-label="Full name (required)" placeholder="Full name *"
                      className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
                    />
                    <input
                      tabIndex={0}
                      value={wiCreateRoom}
                      onChange={(e) => setWiCreateRoom(e.target.value)}
                      aria-label="Room number (optional)" placeholder="Room number (optional)"
                      className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
                    />
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onMouseDown={() => { setWiCreateOpen(false); setWiCreateError(null) }}
                        className="flex-1 min-h-[44px] text-sm text-stone-600 border border-stone-200 rounded-xl hover:bg-stone-50 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={!wiCreateName.trim() || wiCreating}
                        onMouseDown={async () => {
                          if (!wiCreateName.trim()) return
                          setWiCreating(true)
                          setWiCreateError(null)
                          try {
                            const res = await fetch('/api/residents', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                name: wiCreateName.trim(),
                                roomNumber: wiCreateRoom.trim() || undefined,
                              } satisfies ResidentCreateInput),
                            })
                            const json = await res.json()
                            if (!res.ok) {
                              setWiCreateError(
                                res.status === 409
                                  ? 'A resident with this name already exists'
                                  : (json.error ?? 'Failed to create resident')
                              )
                              return
                            }
                            const newResident: Resident = json.data
                            setLocalNewResidents((prev) => [...prev, newResident])
                            setWiResidentId(newResident.id)
                            setWiResidentSearch(newResident.name)
                            setWiResidentDropOpen(false)
                            setWiCreateOpen(false)
                            setWiCreateName('')
                            setWiCreateRoom('')
                          } catch {
                            // Phase 18 — offline: select a local pending resident;
                            // the queued walk-in POST carries newResident and the
                            // server creates both atomically on sync.
                            const pending = {
                              id: `offline-new-${Date.now()}`,
                              name: wiCreateName.trim(),
                              roomNumber: wiCreateRoom.trim() || null,
                            } as Resident
                            setLocalNewResidents((prev) => [...prev, pending])
                            setWiResidentId(pending.id)
                            setWiResidentSearch(pending.name)
                            setWiResidentDropOpen(false)
                            setWiCreateOpen(false)
                            setWiCreateName('')
                            setWiCreateRoom('')
                            toast("Offline — the resident will be created when the walk-in syncs", 'info')
                          } finally {
                            setWiCreating(false)
                          }
                        }}
                        className="flex-1 min-h-[44px] text-sm font-semibold bg-[#8B2E4A] text-white rounded-xl hover:bg-[#72253C] disabled:opacity-50 transition-colors"
                      >
                        {wiCreating ? 'Creating…' : 'Create & Select'}
                      </button>
                    </div>
                  </div>
                ) : filteredResidents.length > 0 ? (
                  <>
                    {filteredResidents.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        data-tour="walkin-resident-option"
                        onMouseDown={() => {
                          setWiResidentId(r.id)
                          setWiResidentSearch(r.name)
                          setWiResidentDropOpen(false)
                          // P26 smart default — pre-select the resident's usual
                          // service when none is chosen yet (freely changeable)
                          if (!wiServiceId && r.mostUsedServiceId && services.some((s) => s.id === r.mostUsedServiceId && s.pricingType !== 'addon')) {
                            setWiServiceId(r.mostUsedServiceId)
                          }
                        }}
                        className="w-full text-left px-3.5 py-2.5 text-sm hover:bg-stone-50 transition-colors border-b border-stone-50 last:border-0"
                      >
                        <span className="font-medium text-stone-900">{r.name}</span>
                        {r.roomNumber && (
                          <span className="text-stone-400 ml-2 text-xs">Room {r.roomNumber}</span>
                        )}
                      </button>
                    ))}
                    {wiResidentSearch.trim().length >= 3 && (
                      <button
                        type="button"
                        onMouseDown={() => {
                          setWiCreateName(wiResidentSearch.trim())
                          setWiCreateRoom('')
                          setWiCreateError(null)
                          setWiCreateOpen(true)
                        }}
                        className="w-full text-left px-3.5 py-2.5 min-h-[44px] text-sm font-medium text-[#8B2E4A] border-t border-stone-100 hover:bg-rose-50 transition-colors flex items-center gap-2"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        Create &quot;{wiResidentSearch.trim()}&quot;
                      </button>
                    )}
                  </>
                ) : wiResidentSearch.trim().length >= 3 ? (
                  <button
                    type="button"
                    onMouseDown={() => {
                      setWiCreateName(wiResidentSearch.trim())
                      setWiCreateRoom('')
                      setWiCreateError(null)
                      setWiCreateOpen(true)
                    }}
                    className="w-full text-left px-3.5 py-2.5 min-h-[44px] text-sm font-medium text-[#8B2E4A] hover:bg-rose-50 transition-colors flex items-center gap-2"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    Create &quot;{wiResidentSearch.trim()}&quot;
                  </button>
                ) : wiResidentSearch ? (
                  <div className="px-3.5 py-3">
                    <p className="text-sm text-stone-400">No residents found</p>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <select
              value={wiServiceId}
              onChange={(e) => setWiServiceId(e.target.value)}
              data-tour="walkin-service-select"
              className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#8B2E4A] transition-all"
            >
              <option value="">Select a service</option>
              {(() => {
                const grouped = new Map<string, Service[]>()
                for (const s of services) {
                  const key = s.category?.trim() || 'Other'
                  if (!grouped.has(key)) grouped.set(key, [])
                  grouped.get(key)!.push(s)
                }
                const orderedGroups = sortCategoryGroups(
                  [...grouped.entries()],
                  wiServiceCategoryPriority,
                )
                if (orderedGroups.length <= 1) {
                  return sortServicesWithinCategory(services).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {formatPricingLabel(s)}
                    </option>
                  ))
                }
                return orderedGroups.map(([category, list]) => (
                  <optgroup key={category} label={category}>
                    {sortServicesWithinCategory(list).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {formatPricingLabel(s)}
                      </option>
                    ))}
                  </optgroup>
                ))
              })()}
            </select>
            <select
              value={wiStylistId}
              onChange={(e) => setWiStylistId(e.target.value)}
              disabled={!!stylistFilter}
              className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#8B2E4A] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {(stylistFilter ? stylists.filter((s) => s.id === stylistFilter) : stylists).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide shrink-0">Time</label>
            <input
              type="time"
              value={wiTime}
              onChange={(e) => setWiTime(e.target.value)}
              className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#8B2E4A] transition-all"
            />
          </div>

          {wiAddonServices.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Add-ons</p>
              {wiAddonServices.map((svc) => (
                <label key={svc.id} className="flex items-center gap-2.5 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2.5 cursor-pointer min-h-[44px]">
                  <input
                    type="checkbox"
                    checked={wiAddonServiceIds.includes(svc.id)}
                    onChange={() => setWiAddonServiceIds((prev) =>
                      prev.includes(svc.id) ? prev.filter((x) => x !== svc.id) : [...prev, svc.id]
                    )}
                    className="rounded accent-[#8B2E4A] w-4 h-4 shrink-0"
                  />
                  <span className="text-sm text-stone-700 flex-1">{svc.name}</span>
                  <span className="text-sm text-amber-700">+{formatCents(svc.addonAmountCents ?? 0)}</span>
                </label>
              ))}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => { setShowWalkIn(false); setWiError(null); setLocalNewResidents([]); setWiCreateOpen(false); setWiCreateName(''); setWiCreateRoom(''); setWiCreateError(null) }} disabled={wiAdding}>
              Cancel
            </Button>
            <Button size="sm" loading={wiAdding} onClick={handleAddWalkIn} data-tour="walkin-submit">
              Add walk-in
            </Button>
          </div>
        </div>
      )}

      {/* No bookings state */}
      {stylistGroups.length === 0 && !loading && (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm mb-4">
          <EmptyState
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
                <path d="M12 14l.8 1.8L14.5 16l-1.7 1.5.4 2L12 18.5l-1.2.9.4-2L9.5 16l1.7-.2.8-1.8z" />
              </svg>
            }
            title={isToday ? 'No appointments today' : 'No appointments scheduled for this day'}
            cta={isToday && canWrite ? { label: '+ Add Walk-in', onClick: () => setShowWalkIn(true) } : undefined}
          />
        </div>
      )}

      {/* Stylist sections */}
      {stylistGroups.map(({ stylist, bookings: stylistBookings }) => {
        const logEntry = getLogEntry(stylist.id)
        const isFinalized = logEntry?.finalized ?? false
        // Stylists may finalize / write day notes only on THEIR OWN section.
        // Admin/bookkeeper (stylistFilter null) can act on every section.
        const ownsSection = !stylistFilter || stylist.id === stylistFilter
        const canWriteSection = canWrite && ownsSection
        const stylistCompleted = stylistBookings.filter((b) => b.status === 'completed')
        const stylistRevenue = stylistCompleted.reduce(
          (sum, b) => sum + (b.priceCents ?? b.service?.priceCents ?? 0),
          0
        )

        return (
          <div
            key={stylist.id}
            className={cn(
              'bg-white rounded-2xl border shadow-sm mb-4 overflow-hidden',
              isFinalized ? 'border-green-200' : 'border-stone-100'
            )}
          >
            {/* Section header */}
            <div
              className={cn(
                'flex items-center gap-3 px-4 py-3 border-b cursor-pointer select-none active:opacity-70 transition-opacity duration-75',
                isFinalized ? 'border-green-100 bg-green-50/60' : 'border-stone-100',
                collapsed[stylist.id] && 'border-b-0'
              )}
              onClick={() => toggleCollapsed(stylist.id)}
            >
              <Avatar name={stylist.name} color={stylist.color} size="sm" />
              <div className="flex-1 min-w-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    openPeek({ type: 'stylist', id: stylist.id })
                  }}
                  className="text-left hover:underline hover:text-[#8B2E4A] transition-colors"
                >
                  <p className="text-sm font-semibold text-stone-900">{stylist.name}</p>
                </button>
                {stylistBookings.length > 0 && (
                  <p className="text-xs text-stone-500">
                    {stylistCompleted.length}/{stylistBookings.filter(b => b.status !== 'cancelled').length} done
                    {stylistRevenue > 0 ? ` · ${formatCents(stylistRevenue)}` : ''}
                  </p>
                )}
              </div>
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                className={cn('text-stone-400 shrink-0 transition-transform duration-200 mr-1', collapsed[stylist.id] ? '-rotate-90' : '')}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
              {isFinalized ? (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-100 px-2.5 py-1 rounded-full">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Finalized
                </span>
              ) : !canWriteSection ? null : confirmFinalizeId === stylist.id ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-stone-500">Finalize?</span>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={finalizingId === stylist.id}
                    onClick={() => handleFinalize(stylist.id)}
                  >
                    Yes
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmFinalizeId(null)}>
                    No
                  </Button>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleFinalize(stylist.id)}
                  data-tour="daily-log-finalize-button"
                  data-tour-mobile="daily-log-finalize-button"
                >
                  Finalize
                </Button>
              )}
            </div>

            {/* Booking rows */}
            {collapsed[stylist.id] ? null : stylistBookings.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-stone-400">No appointments</div>
            ) : (
              <div className="divide-y divide-stone-50" data-tour="daily-log-entry-row">
                {stylistBookings.map((booking) => {
                  const isCompleted = booking.status === 'completed'
                  const isNoShow = booking.status === 'no_show'
                  const isCancelled = booking.status === 'cancelled'
                  const isUpdating = updatingId === booking.id
                  const isEditing = editingBookingId === booking.id
                  // Bookkeepers/admins can edit even after a day is finalized (post-hoc
                  // billing corrections); stylists stay locked out of finalized sections.
                  const canEditFinalized = role === 'admin' || role === 'super_admin' || role === 'bookkeeper'
                  const canEdit = canWrite && !isCancelled && (!isFinalized || canEditFinalized) && (!stylistFilter || booking.stylist.id === stylistFilter)

                  return (
                    <div
                      key={booking.id}
                      id={`log-booking-${booking.id}`}
                      className={cn(
                        // P30 — actions wrap BELOW the text on phones: the old
                        // single-row squeeze left ~70px for the service names
                        // (one word per line, price buried). Desktop keeps the
                        // side-by-side layout.
                        'relative flex flex-col md:flex-row md:items-start md:gap-3 px-4 py-3.5 transition-colors',
                        isCompleted && 'bg-green-50/40',
                        isNoShow && 'bg-orange-50/40',
                        isCancelled && 'bg-stone-50/60 opacity-60'
                      )}
                      onTouchStart={(e) => {
                        if (!canEdit || isFinalized || isCancelled || isEditing) return
                        const t = e.touches[0]
                        swipeRef.current = { x: t.clientX, y: t.clientY, id: booking.id }
                      }}
                      onTouchMove={(e) => {
                        const s = swipeRef.current
                        if (!s || s.id !== booking.id) return
                        const t = e.touches[0]
                        const dx = t.clientX - s.x
                        const dy = t.clientY - s.y
                        // horizontal intent, either direction — reveal delete
                        if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                          setSwipedDeleteId(booking.id)
                          swipeRef.current = null
                        }
                      }}
                      onTouchEnd={() => { swipeRef.current = null }}
                    >
                      {/* P30 — swipe-revealed delete confirm */}
                      {swipedDeleteId === booking.id && (
                        <div className="absolute inset-y-0 right-0 z-10 flex items-center gap-1.5 pl-8 pr-3 bg-gradient-to-l from-white via-white to-transparent">
                          <span className="text-xs font-semibold text-red-600">
                            {booking.paymentStatus === 'paid'
                              ? 'Already paid — delete? Handle refunds in Billing.'
                              : 'Delete this appointment?'}
                          </span>
                          <button
                            type="button"
                            onClick={() => deleteBookingRow(booking.id)}
                            disabled={!!deletingId}
                            className="text-xs font-semibold text-white bg-red-600 hover:bg-red-700 px-3 py-2 rounded-lg transition-colors disabled:opacity-40"
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setSwipedDeleteId(null)}
                            className="text-xs font-medium text-stone-600 bg-white border border-stone-200 px-3 py-2 rounded-lg"
                          >
                            Keep
                          </button>
                        </div>
                      )}
                      <div className="flex items-start gap-3 flex-1 min-w-0 w-full">
                      {/* Avatar */}
                      <div className="shrink-0">
                        <Avatar name={booking.resident.name} size="md" />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            data-tour="peek-resident-trigger"
                            onClick={() => openPeek({ type: 'resident', id: booking.resident.id })}
                            className="text-left hover:underline hover:text-[#8B2E4A] transition-colors"
                          >
                            <p
                              className={cn(
                                'text-[13.5px] font-semibold text-stone-900 leading-snug',
                                (isNoShow || isCancelled) && 'line-through text-stone-400'
                              )}
                            >
                              {booking.resident.name}
                            </p>
                          </button>
                          {isCompleted && (
                            <span className="shrink-0 w-4 h-4 rounded-full bg-green-100 flex items-center justify-center" title="Completed">
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3.5">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </span>
                          )}
                          {isNoShow && (
                            <span className="shrink-0 w-4 h-4 rounded-full bg-orange-100 flex items-center justify-center" title="No-show">
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#ea580c" strokeWidth="3.5">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </span>
                          )}
                          {isCancelled && (
                            <span className="shrink-0 w-4 h-4 rounded-full bg-stone-100 flex items-center justify-center" title="Cancelled">
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#a8a29e" strokeWidth="3.5">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </span>
                          )}
                          {booking.resident.roomNumber && (
                            <span className="text-[11.5px] text-stone-400 leading-snug">
                              Rm {booking.resident.roomNumber}
                            </span>
                          )}
                          {booking.source === 'historical_import' && (
                            <span
                              title={booking.importBatch?.fileName ? `Historical record — imported from ${booking.importBatch.fileName}` : 'Historical record'}
                              className="inline-block text-[10.5px] font-semibold text-stone-600 bg-stone-100 px-1.5 py-0.5 rounded-full leading-none"
                            >
                              H
                            </span>
                          )}
                        </div>

                        {isEditing ? (
                          <div className="mt-1.5 space-y-2">
                            {/* Date */}
                            <div>
                              <label className="text-[10px] text-stone-400 uppercase tracking-wide">Service Date</label>
                              <input
                                type="date"
                                value={editDate}
                                onChange={(e) => setEditDate(e.target.value)}
                                className="mt-0.5 w-full bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20"
                              />
                            </div>
                            {/* Resident — real <select> (Phase 25). The old invisible
                                <datalist> silently dropped typed names that didn't exactly
                                match; edit only ever re-points to an existing resident. */}
                            <div>
                              <label className="text-[10px] text-stone-400 uppercase tracking-wide">Resident</label>
                              <select
                                value={editResidentId ?? ''}
                                onChange={(e) => {
                                  const picked = residents.find(r => r.id === e.target.value)
                                  setEditResidentId(picked?.id ?? null)
                                  setEditResidentName(picked?.name ?? '')
                                }}
                                className="mt-0.5 w-full bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20"
                              >
                                {/* Current resident may be missing from the active list (inactive/demo) */}
                                {editResidentId && !residents.some(r => r.id === editResidentId) && (
                                  <option value={editResidentId}>{editResidentName}</option>
                                )}
                                {!editResidentId && <option value="">Select resident…</option>}
                                {residents.map(r => (
                                  <option key={r.id} value={r.id}>{r.name}{r.roomNumber ? ` · Rm ${r.roomNumber}` : ''}</option>
                                ))}
                              </select>
                            </div>
                            {/* Room # — writes to the resident record (residents change rooms) */}
                            <div>
                              <label className="text-[10px] text-stone-400 uppercase tracking-wide">Room #</label>
                              <input
                                type="text"
                                value={editRoomNumber}
                                onChange={(e) => setEditRoomNumber(e.target.value)}
                                placeholder="Room #"
                                className="mt-0.5 w-full bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20"
                              />
                            </div>
                            {/* Service — pick existing or "➕ New service" (inline-create) */}
                            <div>
                              <label className="text-[10px] text-stone-400 uppercase tracking-wide">Service</label>
                              <select
                                value={editServiceCreate ? '__create__' : (editServiceId ?? '')}
                                onChange={(e) => {
                                  const val = e.target.value
                                  if (val === '__create__') {
                                    setEditServiceCreate(true)
                                    setEditServiceId(null)
                                    setEditServiceName('')
                                  } else {
                                    const picked = services.find(s => s.id === val)
                                    setEditServiceCreate(false)
                                    setEditServiceId(val || null)
                                    setEditServiceName(picked?.name ?? '')
                                  }
                                }}
                                className="mt-0.5 w-full bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20"
                              >
                                <option value="">Select a service…</option>
                                {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                <option value="__create__">➕ New service (type name below)…</option>
                              </select>
                              {editServiceCreate && (
                                <input
                                  type="text"
                                  value={editServiceName}
                                  onChange={(e) => setEditServiceName(e.target.value)}
                                  placeholder="New service name…"
                                  className="mt-1.5 w-full bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20"
                                />
                              )}
                            </div>
                            {/* Stylist — correct the stylist after a log-sheet import */}
                            <div>
                              <label className="text-[10px] text-stone-400 uppercase tracking-wide">Stylist</label>
                              <select
                                value={editStylistId ?? ''}
                                onChange={(e) => setEditStylistId(e.target.value || null)}
                                className="mt-0.5 w-full bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20"
                              >
                                {/* Current stylist may be missing from the roster (cross-facility /
                                    duplicate stylist rows) — without this fallback the select rendered
                                    BLANK and looked uneditable (bookkeeper report 2026-07-13). */}
                                {editStylistId && !stylists.some(s => s.id === editStylistId) && (
                                  <option value={editStylistId}>{editStylistName}</option>
                                )}
                                {stylists.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                              </select>
                            </div>
                            {/* Price + Tips row */}
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-1.5 flex-1">
                                <span className="text-xs text-stone-500 shrink-0">Price $</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={editPrice}
                                  onChange={(e) => setEditPrice(e.target.value)}
                                  className="flex-1 bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20"
                                />
                              </div>
                              <div className="flex items-center gap-1.5 flex-1">
                                <span className="text-xs text-stone-500 shrink-0">Tip $</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  placeholder="0.00"
                                  value={editTipCents}
                                  onChange={(e) => setEditTipCents(e.target.value)}
                                  className="flex-1 bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20"
                                />
                              </div>
                            </div>
                            {/* Payment Type — visible dropdown + "Custom…" for COF/RA/etc. */}
                            {(() => {
                              const isCustom = !PAYMENT_TYPE_OPTIONS.includes(editPaymentCombo as typeof PAYMENT_TYPE_OPTIONS[number])
                              return (
                                <div>
                                  <label className="text-[10px] text-stone-400 uppercase tracking-wide">Payment Type</label>
                                  <select
                                    value={isCustom ? '__custom__' : editPaymentCombo}
                                    onChange={(e) => setEditPaymentCombo(e.target.value === '__custom__' ? '' : e.target.value)}
                                    className="mt-0.5 w-full bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20"
                                  >
                                    {PAYMENT_TYPE_OPTIONS.map(o => (
                                      <option key={o} value={o}>{o}</option>
                                    ))}
                                    <option value="__custom__">➕ Custom…</option>
                                  </select>
                                  {isCustom && (
                                    <input
                                      type="text"
                                      value={editPaymentCombo}
                                      onChange={(e) => setEditPaymentCombo(e.target.value)}
                                      placeholder="e.g. COF, RA"
                                      className="mt-1.5 w-full bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20"
                                    />
                                  )}
                                </div>
                              )
                            })()}
                            {/* Notes */}
                            <textarea
                              value={editNotes}
                              onChange={(e) => setEditNotes(e.target.value)}
                              placeholder="Notes..."
                              rows={2}
                              className="w-full bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-sm text-stone-700 placeholder:text-stone-400 focus:outline-none focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20 resize-none"
                            />
                            <div className="flex items-center gap-2 flex-wrap">
                              <button
                                onClick={saveEditBooking}
                                disabled={savingEdit}
                                className="text-xs font-semibold text-white bg-[#8B2E4A] hover:bg-[#72253C] px-4 py-2.5 rounded-lg transition-colors disabled:opacity-40"
                              >
                                {savingEdit ? 'Saving...' : 'Save'}
                              </button>
                              <button
                                onClick={cancelEditBooking}
                                className="text-xs font-medium text-stone-500 hover:text-stone-700 px-3 py-2.5"
                              >
                                Cancel
                              </button>
                              {/* P30 — delete any appointment from the edit form */}
                              {(
                                confirmDeleteId === booking.id ? (
                                  <div className="flex items-center gap-1.5 ml-auto">
                                    <span className="text-xs text-red-600">
                                      {booking.paymentStatus === 'paid'
                                        ? 'Already paid — delete? Handle refunds in Billing.'
                                        : 'Delete this appointment?'}
                                    </span>
                                    <button
                                      onClick={() => deleteBookingRow(booking.id)}
                                      disabled={!!deletingId}
                                      className="text-xs font-semibold text-white bg-red-600 hover:bg-red-700 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                                    >
                                      {deletingId === booking.id ? '…' : 'Yes'}
                                    </button>
                                    <button
                                      onClick={() => setConfirmDeleteId(null)}
                                      className="text-xs font-medium text-stone-500 hover:text-stone-700 px-3 py-2.5"
                                    >
                                      No
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => setConfirmDeleteId(booking.id)}
                                    className="ml-auto text-xs font-medium text-red-500 hover:text-red-700 px-2 py-1.5"
                                  >
                                    Delete appointment
                                  </button>
                                )
                              )}
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-[12px] text-stone-500 leading-snug mt-0.5">
                              {formatTime(booking.startTime, facilityTimezone)} · {serviceDisplayName(booking, services)} ·{' '}
                              <span className="font-semibold text-stone-800 whitespace-nowrap">{formatCents(booking.priceCents ?? booking.service?.priceCents ?? 0)}</span>
                              {booking.tipCents != null && booking.tipCents > 0 && (
                                <span className="text-stone-400"> · Tip {formatCents(booking.tipCents)}</span>
                              )}
                              {booking.selectedQuantity && booking.selectedQuantity > 1 && (
                                <span className="text-stone-400"> (qty: {booking.selectedQuantity})</span>
                              )}
                              {booking.selectedOption && (
                                <span className="text-stone-400"> — {booking.selectedOption}</span>
                              )}
                            </p>
                            {booking.notes === 'Walk-in' && (
                              <span className="inline-block mt-0.5 text-xs font-medium text-[#8B2E4A] bg-rose-50 px-1.5 py-0.5 rounded-md">
                                Walk-in
                              </span>
                            )}
                            {booking.notes && booking.notes !== 'Walk-in' && (
                              <p className="text-xs text-stone-400 mt-0.5 italic">{booking.notes}</p>
                            )}
                            {/* P36 — family-entered care notes, VERBATIM (never
                                paraphrased — allergy text is safety-critical) */}
                            {booking.resident?.id && carePrefs[booking.resident.id]?.allergyNotes && (
                              <p className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-1.5 py-0.5 mt-1 inline-block">
                                ⚠ {carePrefs[booking.resident.id].allergyNotes}
                              </p>
                            )}
                            {booking.resident?.id && carePrefs[booking.resident.id]?.styleNotes && (
                              <p className="text-xs text-stone-500 mt-0.5">
                                ✦ {carePrefs[booking.resident.id].styleNotes}
                              </p>
                            )}
                            {isCancelled && booking.cancellationReason && (
                              <p className="text-xs text-stone-400 mt-0.5 italic">Reason: {booking.cancellationReason}</p>
                            )}
                          </>
                        )}
                      </div>
                      </div>

                      {/* Actions — full-width row under the text on phones */}
                      <div className={cn(
                        'shrink-0 flex items-center gap-1.5 flex-wrap justify-end mt-2 pl-12 md:mt-0 md:pl-0 md:justify-start',
                        isEditing && 'hidden'
                      )}>
                        {/* Take card payment — unpaid, editable bookings only */}
                        {canEdit && !isEditing && !isCancelled && booking.paymentStatus !== 'paid' && (
                          <button
                            onClick={() => setPayBooking(booking)}
                            className="text-stone-400 hover:text-[#8B2E4A] p-2.5 rounded-lg hover:bg-stone-100 transition-colors"
                            title="Take card payment"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                              <line x1="1" y1="10" x2="23" y2="10" />
                            </svg>
                          </button>
                        )}
                        {/* Edit button */}
                        {canEdit && !isEditing && (
                          <button
                            onClick={() => startEditBooking(booking)}
                            className="text-stone-400 hover:text-[#8B2E4A] p-2.5 rounded-lg hover:bg-stone-100 transition-colors"
                            title="Edit price & notes"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                        )}
                        {/* Payment status badge/toggle */}
                        {!isCancelled && !isEditing && (
                          <button
                            data-tour="log-payment-toggle"
                            onClick={() => !isFinalized && updatePaymentStatus(booking.id, booking.paymentStatus ?? 'unpaid')}
                            disabled={isUpdating || isFinalized}
                            title={isFinalized ? `Payment: ${booking.paymentStatus ?? 'unpaid'}` : 'Toggle payment status'}
                            className={cn(
                              'text-xs font-semibold px-2 py-1 rounded-lg transition-colors disabled:cursor-default',
                              booking.paymentStatus === 'paid'
                                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                : booking.paymentStatus === 'waived'
                                ? 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                                : 'bg-amber-50 text-amber-700 hover:bg-amber-100',
                              isFinalized && 'opacity-70'
                            )}
                          >
                            {/* Phase 25 — paid vs unpaid must read beyond color alone
                                (both used to render a bare "$") */}
                            {booking.paymentStatus === 'paid'
                              ? '\u2713 paid'
                              : booking.paymentStatus === 'waived'
                              ? 'Waived'
                              : '$ due'}
                          </button>
                        )}
                        {/* Phase 16 G11 — booking photo (completed rows, own-section writers) */}
                        {isCompleted && !isEditing && canEdit && booking.resident?.id && (
                          <button
                            onClick={() => openPhotoCapture(booking)}
                            title="Add a photo of the finished style"
                            className="text-stone-400 hover:text-[#8B2E4A] px-2 min-h-[44px] rounded-xl hover:bg-rose-50 transition-colors flex items-center justify-center"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                              <circle cx="12" cy="13" r="3" />
                            </svg>
                          </button>
                        )}
                        {!isFinalized && !isCancelled && !isEditing && (
                          <>
                            {isCompleted || isNoShow ? (
                              <button
                                onClick={() => updateStatus(booking.id, 'scheduled')}
                                disabled={isUpdating}
                                className="text-xs text-stone-400 hover:text-stone-600 font-medium px-3 min-h-[44px] rounded-xl hover:bg-stone-100 transition-colors disabled:opacity-40"
                              >
                                Undo
                              </button>
                            ) : (
                              <>
                                <button
                                  onClick={() => updateStatus(booking.id, 'completed')}
                                  disabled={isUpdating}
                                  className="text-xs font-semibold text-green-700 bg-green-50 hover:bg-green-100 px-3 min-h-[44px] rounded-xl transition-all duration-75 disabled:opacity-40 border border-green-200 active:scale-95 active:bg-green-200"
                                >
                                  Done
                                </button>
                                <button
                                  onClick={() => updateStatus(booking.id, 'no_show')}
                                  disabled={isUpdating}
                                  className="text-xs font-semibold text-orange-600 bg-orange-50 hover:bg-orange-100 px-2.5 min-h-[44px] rounded-xl transition-all duration-75 disabled:opacity-40 border border-orange-200 active:scale-95 active:bg-orange-200"
                                >
                                  No-show
                                </button>
                              </>
                            )}
                          </>
                        )}
                        {isCancelled && (
                          <span className="text-xs text-stone-400 font-medium">Cancelled</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Notes + footer — editable only on a section the viewer can act on */}
            {!collapsed[stylist.id] && !isFinalized && canWriteSection && (
              <div className="px-4 py-3 border-t border-stone-50">
                <textarea
                  value={notes[stylist.id] ?? ''}
                  onChange={(e) => setNotes((prev) => ({ ...prev, [stylist.id]: e.target.value }))}
                  placeholder="Day notes (optional)..."
                  rows={2}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm text-stone-700 placeholder:text-stone-400 focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20 transition-all resize-none"
                />
                {notes[stylist.id] && (
                  <div className="flex justify-end mt-1.5">
                    <button
                      onClick={() => saveNotes(stylist.id)}
                      disabled={savingNotesId === stylist.id}
                      className="text-xs text-[#8B2E4A] font-medium hover:underline disabled:opacity-40"
                    >
                      {savingNotesId === stylist.id ? 'Saving...' : 'Save notes'}
                    </button>
                  </div>
                )}
              </div>
            )}
            {!collapsed[stylist.id] && !isFinalized && !canWriteSection && logEntry?.notes && (
              <div className="px-4 py-3 border-t border-stone-50">
                <p className="text-xs text-stone-500 font-medium uppercase tracking-wide mb-1">Notes</p>
                <p className="text-sm text-stone-700">{logEntry.notes}</p>
              </div>
            )}
            {isFinalized && logEntry?.notes && (
              <div className="px-4 py-3 border-t border-green-100 bg-green-50/30">
                <p className="text-xs text-stone-500 font-medium uppercase tracking-wide mb-1">Notes</p>
                <p className="text-sm text-stone-700">{logEntry.notes}</p>
              </div>
            )}
            {isFinalized && (
              <div className="px-4 py-2 border-t border-green-100 bg-green-50/30 flex items-center justify-between">
                <p className="text-xs text-green-600">
                  {logEntry?.finalizedAt
                    ? `Finalized ${formatTime(logEntry.finalizedAt, facilityTimezone)}`
                    : 'Finalized'}
                </p>
                {canWriteSection && (
                  <button
                    onClick={() => handleUnfinalize(stylist.id)}
                    disabled={unfinalizingId === stylist.id}
                    className="text-xs text-stone-400 hover:text-stone-600 font-medium hover:underline disabled:opacity-40 transition-colors"
                  >
                    {unfinalizingId === stylist.id ? 'Undoing…' : 'Unfinalize'}
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}

      </div>
      )}{/* end body wrapper */}

      {/* Mobile footer bar — pinned above nav bar */}
      {!showWalkIn && canWrite && (
        <div
          className="md:hidden fixed left-0 right-0 bg-white border-t border-stone-100 px-4 flex gap-2 z-40"
          style={{ bottom: 'var(--app-nav-clearance)', paddingTop: '8px', paddingBottom: '8px' }}
        >
          {role !== 'stylist' && (
          <button
            onClick={() => setOcrOpen(true)}
            data-tour-mobile="daily-log-scan-sheet"
            className="flex-1 flex items-center justify-center gap-2 bg-white text-stone-600 border border-stone-200 rounded-2xl px-4 py-3 hover:bg-stone-50 active:scale-95 transition-all text-sm font-semibold"
            title="Import from photo"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            Scan log sheet
          </button>
          )}
          <button
            onClick={() => setShowWalkIn(true)}
            data-tour-mobile="daily-log-add-walkin"
            className="flex-1 flex items-center justify-center gap-2 bg-[#8B2E4A] text-white rounded-2xl px-4 py-3 hover:bg-[#72253C] active:scale-95 transition-all text-sm font-semibold"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add walk-in
          </button>
        </div>
      )}

      {/* Desktop inline buttons */}
      {!showWalkIn && canWrite && (
        <div className="hidden md:flex gap-2 mt-4">
          {role !== 'stylist' && (
          <button
            onClick={() => setOcrOpen(true)}
            data-tour="daily-log-scan-sheet"
            className="flex-1 flex items-center justify-center gap-2 bg-white text-stone-600 border border-stone-200 rounded-2xl px-4 py-3 shadow-sm hover:bg-stone-50 active:scale-95 transition-all text-sm font-semibold"
            title="Import from photo"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            Scan log sheet
          </button>
          )}
          <button
            onClick={() => setShowWalkIn(true)}
            data-tour="daily-log-add-walkin"
            className="flex-1 flex items-center justify-center gap-2 bg-[#8B2E4A] text-white rounded-2xl px-4 py-3 hover:bg-[#72253C] active:scale-95 transition-all text-sm font-semibold"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add walk-in
          </button>
        </div>
      )}

      <OcrImportModal
        open={ocrOpen}
        onClose={() => { setOcrOpen(false); setOcrSeedSheets(null); setOcrSeedFacilityId(null) }}
        onImported={() => { setOcrSeedSheets(null); setOcrSeedFacilityId(null); navigateDate(date) }}
        residents={residents}
        stylists={stylists}
        services={services}
        date={date}
        facilities={exportFacilities}
        currentFacilityId={facilityId}
        role={role}
        initialSheets={ocrSeedSheets}
        initialFacilityId={ocrSeedFacilityId}
      />

      {/* Bookkeepers / master admin get the multi-facility modal so they can
          export all facilities for a date range in one download. Everyone else
          gets the single-facility modal (exportFacilities has exactly one entry). */}
      {exportFacilities && exportFacilities.length > 1 ? (
        <ExportDailyLogsMultiModal
          open={showExportModal}
          onClose={() => setShowExportModal(false)}
          facilities={exportFacilities}
          defaultSelectedId={facilityId}
        />
      ) : (
        <ExportDailyLogsModal
          open={showExportModal}
          onClose={() => setShowExportModal(false)}
          facilityId={facilityId}
          facilityName={facilityName}
        />
      )}

      <EmailDayLogModal
        open={showEmailModal}
        onClose={() => setShowEmailModal(false)}
        date={date}
        dateLabel={new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
          weekday: 'long', month: 'long', day: 'numeric',
        })}
        facilityName={facilityName}
      />

      <LogSheetsModal
        open={sheetsOpen}
        onClose={() => setSheetsOpen(false)}
        role={role}
        isMasterAdmin={isMaster}
        facilities={exportFacilities}
      />

      {/* Phase 16 G11 — booking photo capture */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handlePhotoPicked(e.target.files?.[0] ?? null)}
      />
      {photoBooking && photoFile && photoPreview && (
        <div className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm flex items-end md:items-center justify-center" onClick={closePhotoCapture}>
          <div
            className="bg-white w-full md:max-w-sm rounded-t-3xl md:rounded-2xl p-5 space-y-3"
            style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-stone-800">Photo for {photoBooking.residentName}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoPreview} alt="Style photo preview" className="w-full max-h-64 object-contain rounded-xl bg-stone-50" />
            <input
              type="text"
              value={photoCaption}
              onChange={(e) => setPhotoCaption(e.target.value)}
              maxLength={300}
              aria-label="Photo caption (optional)" placeholder="Caption — e.g. 'the cut she likes' (optional)"
              className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20 transition-all"
            />
            <label className="flex items-center gap-2 text-sm text-stone-700 cursor-pointer">
              <input type="checkbox" checked={photoShare} onChange={(e) => setPhotoShare(e.target.checked)} className="accent-[#8B2E4A] w-4 h-4" />
              Share with the family in their portal
            </label>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={closePhotoCapture} disabled={photoUploading}>Cancel</Button>
              <Button size="sm" className="flex-1" loading={photoUploading} onClick={uploadBookingPhoto}>Save photo</Button>
            </div>
          </div>
        </div>
      )}

      {payBooking && (
        <TakePaymentModal
          open={!!payBooking}
          onClose={() => setPayBooking(null)}
          residentId={payBooking.resident.id}
          residentName={payBooking.resident.name}
          defaultAmountCents={
            (payBooking.priceCents ?? payBooking.service?.priceCents ?? 0) +
            (payBooking.addonTotalCents ?? 0) +
            (payBooking.tipCents ?? 0)
          }
          bookingIds={[payBooking.id]}
          onPaid={() =>
            setBookings((prev) =>
              prev.map((b) => (b.id === payBooking.id ? { ...b, paymentStatus: 'paid', paymentMethod: 'Card' } : b)),
            )
          }
        />
      )}
    </div>
    </ErrorBoundary>
  )
}
// Phase 17 — header action icons shared by the desktop and mobile action rows.
function SheetsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>
  )
}
function EmailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="4" width="20" height="16" rx="2"/>
      <path d="M22 7l-10 6L2 7"/>
    </svg>
  )
}
function ExportIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="8" y1="13" x2="12" y2="17"/>
      <line x1="12" y1="13" x2="8" y2="17"/>
    </svg>
  )
}
// Phase 23 — in-place facility switcher for the daily log (bookkeeper/master).
// Search by name or F-code (house rule); picking POSTs /api/facilities/select
// then HARD-reloads so every server-seeded list re-renders under the new
// facility (soft refresh does not re-run useState initializers).
function LogFacilityPicker({
  facilities,
  currentFacilityId,
}: {
  facilities: { id: string; name: string; facilityCode: string | null }[]
  currentFacilityId: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [switching, setSwitching] = useState(false)
  const current = facilities.find((f) => f.id === currentFacilityId)
  const filtered = filterFacilitiesForSwitcher(facilities, q)

  const pick = async (id: string) => {
    if (id === currentFacilityId) { setOpen(false); return }
    setSwitching(true)
    try {
      await switchFacility(id) // shared select + HARD reload (Phase 25)
    } catch {
      setSwitching(false)
    }
  }

  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setOpen(false)
          setQ('')
        }
      }}
    >
      <button
        type="button"
        data-tour="log-facility-picker"
        onClick={() => setOpen((v) => !v)}
        disabled={switching}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-700 hover:border-[#C4687A] hover:bg-[#F9EFF2]/40 transition-colors text-xs font-semibold min-h-[44px] max-w-[220px] disabled:opacity-60"
        title="Switch facility"
      >
        {current?.facilityCode && (
          <span className="font-mono text-stone-400 shrink-0">{current.facilityCode}</span>
        )}
        <span className="truncate">{switching ? 'Switching…' : (current?.name ?? 'Facility')}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0 text-stone-400">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 right-0 w-72 bg-white border border-stone-200 rounded-xl shadow-lg overflow-hidden">
          <div className="p-2 border-b border-stone-100">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name or F-code…"
              aria-label="Search facilities"
              className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]/50"
            />
          </div>
          <div className="max-h-72 overflow-y-auto">
            {filtered.map((f) => (
              <button
                key={f.id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); void pick(f.id) }}
                className={
                  f.id === currentFacilityId
                    ? 'w-full flex items-center gap-2 px-3 py-2 text-left text-sm bg-rose-50 text-[#8B2E4A] font-medium'
                    : 'w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-stone-50 text-stone-700'
                }
              >
                {f.facilityCode && (
                  <span className="font-mono text-xs text-stone-400 shrink-0 w-11">{f.facilityCode}</span>
                )}
                <span className="flex-1 truncate">{f.name}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-sm text-stone-400 text-center">No facilities match</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
