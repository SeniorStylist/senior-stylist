// P40 — the SINGLE source of truth for what a confirmed assistant action may
// execute. Pure module (no db/react imports): consumed by the server tools
// (kind typing), the client chat hook (pre-fetch validation), and the tsx
// harness (coverage tests).
//
// Contract: the server tool builds `request` ONLY from resolved entities with
// a closed per-kind field set; the client re-validates method + path + body
// keys against these rules before fetching. The REST endpoints' own guards
// remain the real authority — this defends against a prompt-injected model,
// not against the signed-in user (who could call the endpoints directly).

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

export type AssistantActionKind =
  | 'book'
  | 'cancel'
  | 'reschedule'
  | 'update_appointment'
  | 'create_resident'
  | 'update_resident'
  | 'set_stylist_hours'
  | 'add_time_off'
  | 'decide_time_off'
  | 'add_to_waitlist'
  | 'add_signup_entry'
  | 'create_service'
  | 'update_service'
  | 'update_stylist'
  | 'reply_to_feedback'
  | 'send_receipt'

export interface PendingAction {
  kind: AssistantActionKind
  summary: { title: string; lines: string[] }
  request: {
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    path: string
    body: Record<string, unknown> | null
  }
  expiresAt: string
}

interface ActionRule {
  method: PendingAction['request']['method']
  pathRe: RegExp
  bodyKeys: string[]
}

export const ACTION_RULES: Record<AssistantActionKind, ActionRule> = {
  book: {
    method: 'POST',
    pathRe: new RegExp('^/api/bookings$', 'i'),
    bodyKeys: ['residentId', 'newResident', 'serviceId', 'startTime', 'stylistId', 'notes'],
  },
  cancel: {
    method: 'DELETE',
    pathRe: new RegExp(`^/api/bookings/${UUID}$`, 'i'),
    bodyKeys: [],
  },
  reschedule: {
    method: 'PUT',
    pathRe: new RegExp(`^/api/bookings/${UUID}$`, 'i'),
    bodyKeys: ['startTime'],
  },
  update_appointment: {
    method: 'PUT',
    pathRe: new RegExp(`^/api/bookings/${UUID}$`, 'i'),
    bodyKeys: ['status', 'paymentStatus', 'tipCents', 'notes'],
  },
  create_resident: {
    method: 'POST',
    pathRe: new RegExp('^/api/residents$', 'i'),
    bodyKeys: ['name', 'roomNumber', 'phone'],
  },
  update_resident: {
    method: 'PUT',
    pathRe: new RegExp(`^/api/residents/${UUID}$`, 'i'),
    bodyKeys: ['roomNumber', 'phone', 'poaName', 'poaPhone', 'poaEmail', 'dateOfBirth', 'notes'],
  },
  set_stylist_hours: {
    method: 'PUT',
    pathRe: new RegExp('^/api/availability$', 'i'),
    bodyKeys: ['stylistId', 'facilityId', 'availability'],
  },
  add_time_off: {
    method: 'POST',
    pathRe: new RegExp('^/api/coverage$', 'i'),
    bodyKeys: ['stylistId', 'startDate', 'endDate', 'reason'],
  },
  decide_time_off: {
    method: 'PUT',
    pathRe: new RegExp(`^/api/coverage/${UUID}$`, 'i'),
    bodyKeys: ['action', 'deniedReason'],
  },
  add_to_waitlist: {
    method: 'POST',
    pathRe: new RegExp('^/api/waitlist$', 'i'),
    bodyKeys: ['residentId', 'residentName', 'roomNumber', 'serviceId', 'serviceName', 'earliestDate', 'latestDate', 'notes'],
  },
  add_signup_entry: {
    method: 'POST',
    pathRe: new RegExp('^/api/signup-sheet$', 'i'),
    bodyKeys: ['residentId', 'residentName', 'roomNumber', 'serviceId', 'serviceName', 'requestedDate', 'preferredDate', 'notes'],
  },
  create_service: {
    method: 'POST',
    pathRe: new RegExp('^/api/services$', 'i'),
    bodyKeys: ['name', 'priceCents', 'durationMinutes'],
  },
  update_service: {
    method: 'PUT',
    pathRe: new RegExp(`^/api/services/${UUID}$`, 'i'),
    bodyKeys: ['name', 'priceCents', 'durationMinutes', 'active'],
  },
  update_stylist: {
    method: 'PUT',
    pathRe: new RegExp(`^/api/stylists/${UUID}$`, 'i'),
    bodyKeys: ['commissionPercent', 'status'],
  },
  reply_to_feedback: {
    method: 'PATCH',
    pathRe: new RegExp(`^/api/feedback/${UUID}$`, 'i'),
    bodyKeys: ['reply', 'status'],
  },
  send_receipt: {
    method: 'POST',
    pathRe: new RegExp(`^/api/bookings/${UUID}/receipt$`, 'i'),
    bodyKeys: [],
  },
}

/** Client-side gate — a proposal outside these rules is never executed. */
export function actionAllowed(a: PendingAction): boolean {
  const rule = ACTION_RULES[a.kind]
  if (!rule) return false
  if (a.request.method !== rule.method) return false
  if (!rule.pathRe.test(a.request.path)) return false
  const keys = Object.keys(a.request.body ?? {})
  return keys.every((k) => rule.bodyKeys.includes(k))
}
