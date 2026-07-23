// P45 — the assistant's POINTING VOCABULARY for coworker-mode guided walks.
// Every anchor here is a real `data-tour` element validated by check:tours;
// the walk engine resolves mobile variants automatically (tour-dom
// resolveQuery). RULE: when you add a data-tour anchor the assistant should
// guide to, add it HERE too (route, label, kind, requires) — this allowlist
// is the only thing the model may point at. Pure module (no db/react) —
// consumed by the start_guided_walk tool and the harness.

import type { ScriptedStep } from '@/lib/help/scripted-tour-types'

export interface GuideAnchor {
  /** Page the element lives on. '*' = global chrome (nav, header). */
  route: string
  label: string
  kind: 'nav' | 'button' | 'input' | 'select' | 'area'
  /** Conditional anchors exist only AFTER one of these anchors is clicked. */
  requires?: string[]
  desktopOnly?: boolean
  mobileOnly?: boolean
}

export const GUIDE_ROUTES = [
  '/dashboard', '/log', '/residents', '/billing', '/analytics', '/payroll',
  '/settings', '/signup-sheet', '/my-account', '/stylists',
  '/stylists/directory', '/master-admin', '/help',
] as const

const BOOKING_MODAL_OPENERS = ['dashboard-new-booking-fab', 'calendar-time-grid', 'stylist-pending-convert']

export const GUIDE_ANCHORS: Record<string, GuideAnchor> = {
  // ── Global navigation (sidebar + mobile bottom bar — resolver picks) ──
  'nav-calendar': { route: '*', label: 'Calendar tab', kind: 'nav' },
  'nav-daily-log': { route: '*', label: 'Daily Log tab', kind: 'nav' },
  'nav-residents': { route: '*', label: 'Residents tab', kind: 'nav' },
  'nav-billing': { route: '*', label: 'Billing (sidebar)', kind: 'nav', desktopOnly: true },
  'nav-analytics': { route: '*', label: 'Analytics tab', kind: 'nav' },
  'nav-payroll': { route: '*', label: 'Payroll tab', kind: 'nav' },
  'nav-stylists': { route: '*', label: 'Stylists (sidebar)', kind: 'nav', desktopOnly: true },
  'nav-my-account': { route: '*', label: 'My Account tab (stylists)', kind: 'nav' },
  'nav-signup-sheet': { route: '*', label: 'Sign-Up Sheet tab', kind: 'nav' },
  'nav-help': { route: '*', label: 'Help tab', kind: 'nav' },
  'nav-settings': { route: '*', label: 'Settings tab', kind: 'nav' },
  'nav-master-admin': { route: '*', label: 'Master Admin (sidebar)', kind: 'nav', desktopOnly: true },
  'nav-more': { route: '*', label: 'More menu (mobile bottom bar)', kind: 'nav', mobileOnly: true },

  // ── /dashboard (Calendar) ──
  'calendar-time-grid': { route: '/dashboard', label: 'calendar time grid (tap a slot to book)', kind: 'area' },
  'calendar-today-btn': { route: '/dashboard', label: 'Today button', kind: 'button' },
  'dashboard-new-booking-fab': { route: '/dashboard', label: '+ new booking button', kind: 'button', mobileOnly: true },
  'signup-sheet-button': { route: '/dashboard', label: 'Sign-Up Sheet panel opener', kind: 'button' },
  'copy-day-button': { route: '/dashboard', label: 'Copy day', kind: 'button' },
  'print-week-button': { route: '/dashboard', label: 'Print week', kind: 'button', desktopOnly: true },
  'waitlist-panel': { route: '/dashboard', label: 'Waitlist panel', kind: 'area' },
  'waitlist-add': { route: '/dashboard', label: '+ Add to waitlist', kind: 'button' },
  'due-for-visit': { route: '/dashboard', label: 'Due-for-a-visit panel', kind: 'area' },
  'checkin-banner': { route: '/dashboard', label: "stylist check-in banner (only when they have appointments)", kind: 'area' },
  'checkin-button': { route: '/dashboard', label: "\"I'm Here\" check-in button", kind: 'button' },
  'stylist-pending-panel': { route: '/dashboard', label: 'pending sign-up requests panel (stylists)', kind: 'area' },
  'stylist-pending-convert': { route: '/dashboard', label: '"Pick time" on a pending request', kind: 'button' },

  // ── Booking modal (opens from FAB / calendar slot / pending request) ──
  'booking-modal-resident': { route: '/dashboard', label: 'resident search box', kind: 'input', requires: BOOKING_MODAL_OPENERS },
  'booking-modal-resident-option': { route: '/dashboard', label: 'first resident result', kind: 'button', requires: BOOKING_MODAL_OPENERS },
  'booking-modal-service': { route: '/dashboard', label: 'service picker', kind: 'select', requires: BOOKING_MODAL_OPENERS },
  'booking-modal-stylist': { route: '/dashboard', label: 'stylist picker (auto-assign default)', kind: 'select', requires: BOOKING_MODAL_OPENERS },
  'booking-modal-date': { route: '/dashboard', label: 'date & time field', kind: 'input', requires: BOOKING_MODAL_OPENERS },
  'booking-modal-submit': { route: '/dashboard', label: 'Book Appointment button', kind: 'button', requires: BOOKING_MODAL_OPENERS },

  // ── /log (Daily Log) ──
  'daily-log-scan-sheet': { route: '/log', label: 'Scan log sheet (camera) button', kind: 'button' },
  'daily-log-add-walkin': { route: '/log', label: 'Add Walk-in button', kind: 'button' },
  'log-export-excel': { route: '/log', label: 'Export (Excel) button', kind: 'button' },
  'log-email-day': { route: '/log', label: 'Email day log button', kind: 'button' },
  'daily-log-finalize-button': { route: '/log', label: 'Finalize Day button', kind: 'button' },
  'daily-log-entry-row': { route: '/log', label: "the day's appointment rows", kind: 'area' },
  'log-payment-toggle': { route: '/log', label: 'payment chip on a row (tap to cycle paid)', kind: 'button' },
  'log-facility-picker': { route: '/log', label: 'facility picker (bookkeeper/master)', kind: 'select' },
  'peek-resident-trigger': { route: '/log', label: 'a resident name (tap for quick profile)', kind: 'button' },
  'ocr-upload-area': { route: '/log', label: 'photo upload area (scan modal)', kind: 'area', requires: ['daily-log-scan-sheet'] },
  'ocr-results-table': { route: '/log', label: 'scanned results review table', kind: 'area', requires: ['daily-log-scan-sheet'] },
  'ocr-import-button': { route: '/log', label: 'Import confirm button (scan modal)', kind: 'button', requires: ['daily-log-scan-sheet'] },
  'daily-log-walkin-form': { route: '/log', label: 'walk-in form', kind: 'area', requires: ['daily-log-add-walkin'] },
  'walkin-resident-search': { route: '/log', label: 'walk-in resident search', kind: 'input', requires: ['daily-log-add-walkin'] },
  'walkin-resident-option': { route: '/log', label: 'first walk-in resident result', kind: 'button', requires: ['daily-log-add-walkin'] },
  'walkin-service-select': { route: '/log', label: 'walk-in service picker', kind: 'select', requires: ['daily-log-add-walkin'] },
  'walkin-submit': { route: '/log', label: 'walk-in submit button', kind: 'button', requires: ['daily-log-add-walkin'] },

  // ── /residents ──
  'residents-table': { route: '/residents', label: 'resident list', kind: 'area' },
  'residents-search': { route: '/residents', label: 'resident search box', kind: 'input' },
  'residents-new-button': { route: '/residents', label: '+ Add Resident button', kind: 'button' },
  'residents-import-button': { route: '/residents', label: 'Import residents button', kind: 'button' },
  'residents-duplicates-button': { route: '/residents', label: 'Duplicates finder button', kind: 'button' },
  'residents-add-name': { route: '/residents', label: 'new resident name field', kind: 'input', requires: ['residents-new-button'] },
  'residents-add-submit': { route: '/residents', label: 'save new resident button', kind: 'button', requires: ['residents-new-button'] },

  // ── /billing ──
  'billing-outstanding': { route: '/billing', label: 'outstanding balance card', kind: 'area' },
  'billing-facility-select': { route: '/billing', label: 'facility picker', kind: 'select' },
  'billing-send-statement': { route: '/billing', label: 'Send Statement button', kind: 'button' },
  'billing-monthly-view': { route: '/billing', label: 'Monthly view button', kind: 'button' },
  'billing-aging': { route: '/billing', label: 'invoice aging strip', kind: 'area' },

  // ── /settings (only the ACTIVE section is mounted — click its nav first) ──
  'settings-nav-general': { route: '/settings', label: 'General section', kind: 'nav' },
  'settings-nav-team': { route: '/settings', label: 'Team section', kind: 'nav' },
  'settings-nav-billing': { route: '/settings', label: 'Billing & Payments section', kind: 'nav' },
  'settings-nav-notifications': { route: '/settings', label: 'Notifications section', kind: 'nav' },
  'settings-nav-portal': { route: '/settings', label: 'Family Portal section', kind: 'nav' },
  'settings-working-hours': { route: '/settings', label: 'working hours editor', kind: 'area', requires: ['settings-nav-general'] },
  'settings-invite-form': { route: '/settings', label: 'invite teammate form', kind: 'area', requires: ['settings-nav-team'] },
  'settings-invite-role-select': { route: '/settings', label: 'invite role picker', kind: 'select', requires: ['settings-nav-team'] },
  'settings-invite-submit': { route: '/settings', label: 'send invite button', kind: 'button', requires: ['settings-nav-team'] },
  'settings-quickbooks': { route: '/settings', label: 'QuickBooks connection card', kind: 'area', requires: ['settings-nav-billing'] },

  // ── /signup-sheet (standalone page — form always present) ──
  'signup-sheet-form': { route: '/signup-sheet', label: 'request form', kind: 'area' },
  'signup-sheet-resident': { route: '/signup-sheet', label: 'resident search', kind: 'input' },
  'signup-sheet-service': { route: '/signup-sheet', label: 'service picker', kind: 'select' },
  'signup-sheet-preferred-date': { route: '/signup-sheet', label: 'preferred date', kind: 'input' },
  'signup-sheet-notes': { route: '/signup-sheet', label: 'notes field', kind: 'input' },
  'signup-sheet-submit': { route: '/signup-sheet', label: 'Add to Sheet button', kind: 'button' },

  // ── /my-account (stylists) ──
  'my-account-schedule': { route: '/my-account', label: 'weekly schedule card', kind: 'area' },
  'my-account-compliance': { route: '/my-account', label: 'compliance documents card', kind: 'area' },
  'my-account-compliance-upload': { route: '/my-account', label: 'upload document button', kind: 'button' },
  'my-account-timeoff': { route: '/my-account', label: 'time off card', kind: 'area' },

  // ── /analytics ──
  'analytics-revenue-summary': { route: '/analytics', label: 'revenue summary', kind: 'area' },
  'analytics-by-stylist': { route: '/analytics', label: 'by-stylist breakdown', kind: 'area' },
  'analytics-date-range': { route: '/analytics', label: 'month picker', kind: 'select' },
  'analytics-export-excel': { route: '/analytics', label: 'Export button', kind: 'button' },

  // ── /payroll, /stylists, /master-admin, /help ──
  'payroll-period-list': { route: '/payroll', label: 'pay period list', kind: 'area' },
  'payroll-period-row': { route: '/payroll', label: 'a pay period row', kind: 'button' },
  'stylists-table': { route: '/stylists', label: 'stylist roster', kind: 'area' },
  'master-facility-list': { route: '/master-admin', label: 'facility grid', kind: 'area', desktopOnly: true },
  'master-add-facility-btn': { route: '/master-admin', label: 'Add Facility button', kind: 'button', desktopOnly: true },
  'help-home': { route: '/help', label: 'Help Center home', kind: 'area' },
}

// ── Model-facing walk step shape (validated, then mapped to ScriptedStep) ──
export interface GuideStepInput {
  anchor?: string
  route?: string
  instruction: string
  action: 'point' | 'click' | 'type'
  typeValue?: string
}

const MAX_STEPS = 12

/** Compact per-route digest for the tool description (models read schemas). */
export function buildAnchorVocab(): string {
  const byRoute = new Map<string, string[]>()
  for (const [slug, a] of Object.entries(GUIDE_ANCHORS)) {
    const key = a.route
    const entry = `${slug}${a.requires ? `(after ${a.requires[0]})` : ''}`
    byRoute.set(key, [...(byRoute.get(key) ?? []), entry])
  }
  return [...byRoute.entries()].map(([route, slugs]) => `${route === '*' ? 'any page' : route}: ${slugs.join(', ')}`).join(' | ')
}

/**
 * Validate a model-authored walk. Returns the mapped ScriptedStep[] or a
 * human-readable error the model can self-correct from.
 */
export function validateWalkSteps(
  raw: unknown,
): { ok: true; steps: ScriptedStep[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'steps must be a non-empty array.' }
  if (raw.length > MAX_STEPS) return { ok: false, error: `Too many steps — keep walks to ${MAX_STEPS} or fewer.` }

  const clickedSoFar = new Set<string>()
  const steps: ScriptedStep[] = []

  for (let i = 0; i < raw.length; i++) {
    const s = raw[i] as Partial<GuideStepInput> | null
    if (!s || typeof s !== 'object') return { ok: false, error: `Step ${i + 1} is not an object.` }
    const action = s.action
    if (action !== 'point' && action !== 'click' && action !== 'type') {
      return { ok: false, error: `Step ${i + 1}: action must be point, click, or type.` }
    }
    const instruction = typeof s.instruction === 'string' ? s.instruction.trim().slice(0, 160) : ''
    if (!instruction) return { ok: false, error: `Step ${i + 1}: instruction is required.` }

    const anchor = typeof s.anchor === 'string' ? s.anchor.trim() : ''
    if ((action === 'click' || action === 'type') && !anchor) {
      return { ok: false, error: `Step ${i + 1}: ${action} steps need an anchor.` }
    }
    let anchorDef: GuideAnchor | null = null
    if (anchor) {
      anchorDef = GUIDE_ANCHORS[anchor] ?? null
      if (!anchorDef) return { ok: false, error: `Step ${i + 1}: unknown anchor "${anchor}". Use only documented anchors.` }
      if (anchorDef.requires && !anchorDef.requires.some((r) => clickedSoFar.has(r))) {
        return {
          ok: false,
          error: `Step ${i + 1}: "${anchor}" only exists after clicking ${anchorDef.requires.join(' or ')} — add that click step first.`,
        }
      }
    }

    let route = typeof s.route === 'string' ? s.route.trim() : ''
    if (route && !(GUIDE_ROUTES as readonly string[]).includes(route.split('?')[0])) {
      return { ok: false, error: `Step ${i + 1}: route "${route}" is not an app page.` }
    }
    // Stamp the anchor's page so the engine navigates there when needed
    // (idempotent — the engine skips when already on the route). Conditional
    // anchors inherit their parent page; nav anchors ('*') stamp nothing.
    if (!route && anchorDef && anchorDef.route !== '*') route = anchorDef.route

    const typeValue = typeof s.typeValue === 'string' ? s.typeValue.trim().slice(0, 200) : ''
    if (action === 'type' && !typeValue) {
      return { ok: false, error: `Step ${i + 1}: type steps need typeValue.` }
    }

    if (action === 'click' && anchor) clickedSoFar.add(anchor)

    steps.push({
      type: action === 'point' ? 'highlight' : action,
      selector: anchor ? `[data-tour="${anchor}"]` : '',
      title: `Step ${i + 1} of ${raw.length}`,
      description: instruction,
      ...(route ? { route } : {}),
      ...(action === 'type' ? { typeValue } : {}),
    })
  }

  return { ok: true, steps }
}
