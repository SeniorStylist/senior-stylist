# Senior Stylist — Project Context & Handoff Document

> This file is maintained alongside CLAUDE.md, docs/master-spec.md,
> and docs/design-system.md. Update it at the end of every session.

---

## 1. PROJECT OVERVIEW

**Senior Stylist** is a SaaS scheduling and operations app for
**in-house salon services at senior living facilities**.

Facilities hire stylists to visit residents and provide hair,
nail, and other personal care services. Senior Stylist manages:
- Scheduling appointments on a shared calendar
- Tracking residents, stylists, and services
- Daily operational logs with OCR import from handwritten sheets
- Payments, invoicing, and reporting
- Multi-facility franchise management

**Live site:** https://senior-stylist.vercel.app
**GitHub:** https://github.com/SeniorStylist/senior-stylist
**Supabase project:** goomnlsdguetfgwjpwer
**Stack:** Next.js 16 App Router, Supabase, Drizzle ORM,
Tailwind CSS 4, Vercel

---

## 2. KEY PEOPLE

| Person | Email | Role |
|--------|-------|------|
| Lisa Gerhardt | lisag@seniorstylist.com | Master Admin (owner) |
| Josh Gerhardt | gmanistheman473@gmail.com | Test account (stylist) |

**Real facilities being onboarded:**
- **Symphony Manor** — Sierra (hair), Mariah Owens (nails), ~80 tx/month
- **Sunrise Bethesda** — Senait Edwards, ~60 tx/month

---

## 3. ENVIRONMENT VARIABLES

| Variable | Purpose | Where to get it |
|----------|---------|-----------------|
| NEXT_PUBLIC_SUPABASE_URL | Supabase project URL | Supabase dashboard |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Supabase anon key | Supabase dashboard |
| SUPABASE_SERVICE_ROLE_KEY | Server-side DB access | Supabase dashboard |
| DATABASE_URL | Postgres pooler URL port 5432 session mode | Supabase dashboard |
| NEXT_PUBLIC_APP_URL | https://senior-stylist.vercel.app | Hardcode |
| NEXT_PUBLIC_SUPER_ADMIN_EMAIL | lisag@seniorstylist.com | Hardcode |
| NEXT_PUBLIC_ADMIN_EMAIL | lisag@seniorstylist.com | Hardcode |
| RESEND_API_KEY | Transactional email | resend.com |
| GEMINI_API_KEY | OCR log sheet scanning | aistudio.google.com |
| STRIPE_SECRET_KEY | Resident portal payments | stripe.com |
| UPSTASH_REDIS_REST_URL | Rate limiting (optional — no-op if unset) | upstash.com |
| UPSTASH_REDIS_REST_TOKEN | Rate limiting (optional) | upstash.com |

---

## 4. ROLE SYSTEM

| Role | Access | How detected |
|------|--------|--------------|
| master_admin | All facilities, all franchises, /super-admin | NEXT_PUBLIC_SUPER_ADMIN_EMAIL env var |
| super_admin | Only their franchise facilities, full admin within those | facility_users.role = 'super_admin' |
| admin | Their one facility only, full CRUD | facility_users.role = 'admin' |
| stylist | Calendar, Daily Log, My Account only | facility_users.role = 'stylist' |

**Stylist restrictions enforced server + client:**
- Nav: Calendar, Daily Log, My Account ONLY
- /residents /stylists /services /reports /settings redirect to /dashboard
- Daily Log filtered to own bookings via profiles.stylist_id
- Mobile lands on today appointment list not full calendar
- Can edit price and notes on own log entries only

**Franchise system:**
- franchises table: id, name, owner_user_id
- franchise_facilities join table
- Super admin sees only their franchise facilities
- Master admin manages franchises in /super-admin page

---

## 5. PHASE ROADMAP

### Phase 1 COMPLETE
- Full invite flow fixed — RLS blind spot was root cause
  facility_users and invites needed authenticated SELECT policies
- Stylist role restrictions nav filtering server-side route guards
- Log page inline price/notes editing for stylists
- Email notifications via Resend for invites access requests approvals
- Access request flow redesigned global queue super admin assigns facility
- Full codebase audit with Opus

### Phase 2 COMPLETE
- Mobile speed: prefetch nav links, instant tab highlight, skeleton screens
- OCR log import: Gemini 1.5 Flash reads handwritten and PDF log sheets
- POA fields on residents: poa_name, poa_email, poa_phone, poa_payment_method

### Phase 3 COMPLETE
- Switched OCR from Claude to Gemini 1.5 Flash
- Franchise system: franchises + franchise_facilities tables, CRUD UI in /super-admin
- super_admin role added
- Super admin invite form has facility dropdown
- Smart OCR: multi-sheet upload, auto-creates residents/services/bookings,
  duplicate detection, extracts date and stylist from sheet header

### Phase 4 COMPLETE
- Cross-facility reporting shipped (2026-04-01)
- `getSuperAdminFacilities()` helper — role-aware scope (master admin = all, super_admin = franchise)
- `/api/super-admin/reports/monthly` — per-facility revenue aggregates, 5-min cache
- `/api/super-admin/reports/outstanding` — all unpaid completed bookings across facilities
- `/api/super-admin/reports/mark-paid` — bulk or individual mark-paid with facility auth check
- `/api/super-admin/export/billing` — cross-facility CSV with Facility column + subtotals
- `ReportsTab` component — month picker, bar chart (Recharts), per-facility cards, outstanding balances with checkboxes
- `/super-admin` page upgraded to 4-tab layout: Facilities / Franchises / Requests / Reports
- Booking mutations (`POST`, `PUT`, `DELETE /api/bookings/*`) now call `revalidateTag('bookings', {})` for cache invalidation

### Phase 4.5 COMPLETE
- Flexible pricing types shipped (2026-04-09)
- Four pricing types: fixed (existing), addon, tiered, multi_option
- New columns on services: pricing_type, addon_amount_cents, pricing_tiers, pricing_options
- New columns on bookings: selected_quantity, selected_option, addon_service_ids, addon_total_cents
- New utility: src/lib/pricing.ts — resolvePrice(), formatPricingLabel(), validatePricingInput()
- Services page: pricing type dropdown + conditional fields in create/edit forms, type badges in list
- Booking modal: conditional pricing inputs (addon checkbox, quantity spinner, option dropdown) with live price preview
- Daily log: shows pricing details (selected option, add-on amount, unit count)
- PDF parser: detects addon, tiered, multi_option patterns from price sheets; shows pricing type badges in onboarding import preview
- All booking APIs (POST, PUT, recurring) accept and validate pricing inputs, resolve final price server-side
- Backward compatible: all existing services default to 'fixed', all existing bookings unaffected
- PDF parser bug fix (2026-04-09): pre-extraction of special pricing patterns before the alternating-chunks split — fixes Symphony Manor first category services being silently dropped due to embedded numbers desyncing the split algorithm
- Flexible pricing UX polish (2026-04-10): import preview shows +add-on/tiered/options badges and +$X.XX for addon services; PDF parser filters garbage rows (boilerplate, mid-sentence fragments); booking modal has multi-addon service checklist with live price breakdown; POST /api/bookings accepts addonServiceIds[]; log shows "Service + Addon1 + Addon2" with improved qty/option display; walk-in form has addon checklist
- Pricing UI fixes (2026-04-12): (1) addon $0 bug fixed — checklist and breakdown now use `(addonAmountCents ?? priceCents ?? 0)` at all three sites in booking-modal.tsx; (2) tiered quantity input replaced with 44px stepper (− stone / qty / + teal) plus live tier hint line showing active range and calculated total; (3) price breakdown contextual annotations — tiered shows `(qty × $X/ea)`, multi_option shows `— OptionName`, addon checklist lines rendered in amber (`text-amber-700`)

### Portal Service Picker SHIPPED (2026-04-14)
- Card-based service selection with category grouping, color swatches, burgundy selected state
- Tiered pricing stepper, multi-option pills/select, add-on checklist, live price breakdown
- Multi-service support (+ Add another service), Continue button (no immediate tap-to-advance)
- Book route updated: accepts `serviceIds[]`, `addonServiceIds[]`, `selectedQuantity`, `selectedOption`; uses `resolvePrice()` throughout

### Brand Alignment SHIPPED (2026-04-14)
- Portal (`src/app/(resident)/`) fully rebranded: warm blush background `#FDF8F8`, burgundy header `#8B2E4A`, all CTAs/selected states/checkboxes → burgundy, POA banner → rose-50/200/800
- Floral SVG rose accent in portal header (inline SVG, `rgba(255,255,255,0.15)` stroke)
- `--color-primary` updated to `#8B2E4A` in globals.css — affects FullCalendar toolbar buttons
- Entry pages updated: onboarding progress/CTA, invite accept button, unauthorized submit/role selector → all burgundy
- PWA `themeColor` updated to `#8B2E4A`

### POA Email Opt-In SHIPPED (2026-04-14)
- `poa_notifications_enabled boolean NOT NULL DEFAULT true` column added to `residents` table
- Staff toggle "Send booking confirmations to POA" checkbox in resident detail edit mode + "Confirmations on/off" badge in display mode
- `PATCH /api/portal/[token]/notifications` — public route for self-serve opt-out from portal preferences section
- Portal: "Notification Preferences" section shown at bottom when `poaEmail` is set; fire-and-forget toggle
- Both POA email gates (`POST /api/bookings` + `POST /api/portal/[token]/book`) check `poaNotificationsEnabled !== false`

### Phase 5 SHIPPED (2026-04-14)
- POA portal banner on `/portal/[token]` when `poaName` is set — shows "Booking on behalf of {name}"
- "Send portal link" button in resident detail Portal Link section — fires email to `poaEmail` via `POST /api/residents/[id]/send-portal-link`
- Booking confirmation emails to POA on staff-created bookings (`POST /api/bookings`) and portal bookings (`POST /api/portal/[token]/book`) — fire-and-forget via `buildBookingConfirmationEmailHtml()` in `src/lib/email.ts`
- `GET /api/export/bookkeeper?month=YYYY-MM` — admin-only CSV with Date, Resident, Room, Service, Stylist, Duration, Price, Payment Status, Payment Method, Notes; respects facility timezone
- "Bookkeeper CSV" button in Reports invoice tab action bar

### Full Brand Migration SHIPPED (2026-04-14)
- All admin app components now use burgundy `#8B2E4A` — `button.tsx`, `input.tsx`, `select.tsx`, `toast.tsx`, booking modal, sidebar active states (`#C4687A`), panels, UI primitives, email templates, manifest theme_color
- `completed` status badges remain `bg-teal-50 text-teal-700` (semantic)
- Color picker palettes and DB defaults retain `#0D7377` (user-owned data)
- 43 files changed, zero TypeScript errors

### Portal Service Picker Auto-Collapse SHIPPED (2026-04-14)
- `pickerOpen: Record<number, boolean>` state per service slot in `portal-client.tsx`
- After tapping a service card (single-row mode), card list collapses after 150ms to compact rose-50 summary row: color dot + name + price + "Change" link
- Tapping "Change" re-opens the full card grid for that slot
- Multiple service rows stay open (no auto-collapse when `totalRows > 1`)
- `pickerOpen` reset to `{}` on `startBooking()`

### Logo Integration + Sidebar Rebrand SHIPPED (2026-04-14)
- `--color-sidebar` updated to `#1C0A12` (dark warm burgundy, replaces `#0D2B2E` dark teal)
- Logo image at `/public/Seniorstylistlogo.jpg` — replaces all SVG placeholder branding
- Sidebar: white-card `<Link>` wrapper around `<Image>` (white bg preserves scissor detail on dark)
- Portal header: `<Image filter:invert>` linked to `https://seniorstylist.com` (white on burgundy)
- Login, invite-accept, unauthorized: `<Image>` on white background, no filter

### Phase 6 SHIPPED (2026-04-14)
- Per-stylist Google Calendar OAuth integration
  - `google_calendar_id` + `google_refresh_token` nullable columns added to `stylists`
  - `src/lib/google-calendar/oauth-client.ts` — OAuth2 helpers: `getAuthUrl`, `exchangeCodeForTokens`, `getAccessToken`, `createStylistCalendarEvent`, `updateStylistCalendarEvent`, `deleteStylistCalendarEvent`
  - `GET /api/auth/google-calendar/connect` — authenticated, redirects to Google OAuth
  - `GET /api/auth/google-calendar/callback` — public, decodes base64 state → stylistId, stores tokens, redirects to `/my-account?calendar=connected`
  - `POST /api/auth/google-calendar/disconnect` — clears tokens from stylist record
  - My Account: Google Calendar section (connect/disconnect with two-step confirm, success/error banners)
  - Booking create/update/delete: fire-and-forget per-stylist sync after facility GCal sync
  - Stylists detail: read-only "Calendar connected" emerald badge when `googleCalendarId` is set
  - Facility rep sees all appointments in facility calendar
  - Admin UI: show connected/disconnected status per stylist on
    Stylists page

### Security Hardening SHIPPED (2026-04-14)
- Full pre-onboarding audit fixes shipped in 7 grouped commits (C1–C7, M1, M3–M5, M7–M8, L1, L3–L5).
- `src/lib/sanitize.ts` — `sanitizeStylist`, `sanitizeFacility`, `toClientJson`: strip `googleRefreshToken` + `stripeSecretKey` at server→client boundary (applied in dashboard, settings, my-account, bookings, log, residents, facility routes).
- OAuth CSRF: new `oauth_states` table (`nonce pk`, `user_id`, `stylist_id`, `created_at`). Google Calendar connect/callback now require authenticated admin, nonce-bound state, 10-min TTL, post-success atomic delete. Old `Buffer.from(state,'base64')` → stylistId pattern removed.
- Admin guards on all privileged mutation routes: `/api/stylists*` POST/PUT/DELETE, `/api/services*` POST/PUT/DELETE, `/api/services/parse-pdf`, `/api/log/ocr`, `/api/log/ocr/import`.
- Upload caps: OCR 10MB/file + 20 files max; parse-pdf 50MB max.
- Security headers in `next.config.ts`: X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy (camera/mic/geo all off), HSTS 1yr, Content-Security-Policy.
- Facility scoping: `/api/profile` rejects stylist takeover; `/api/invites` super_admin role verifies franchise coverage via `franchise_facilities`; `/api/portal/[token]/*` routes have explicit column whitelists on every `db.query.*` call and validate `stylistId`/`serviceId`/addons belong to the resident's facility.
- Rate limiting via `src/lib/rate-limit.ts` (Upstash Redis, no-op when env vars missing): signup 5/hr/IP, portalBook 10/hr/token, ocr 20/hr/user, parsePdf 20/hr/user, sendPortalLink 10/hr/user, invites 30/hr/user.
- Zod `.max()` caps across all input schemas (name 200, room 50, notes 2000, email 320, color 20, address 500, cents 10_000_000, arrays 20 for tiers/options).
- RLS verified: every public table has RLS enabled + `service_role_all` policy.

### Phase 7 SHIPPED (2026-04-14) — Compliance & Document Management
- New table: `compliance_documents` (stylist_id, facility_id, document_type: license|insurance|w9|contractor_agreement|background_check, file_url = storage path, file_name, expires_at, verified, verified_by, verified_at, uploaded_at)
- New columns on `stylists`: license_number, license_type, license_expires_at, insurance_verified, insurance_expires_at, background_check_verified
- Private Supabase Storage bucket `compliance-docs` (10 MB cap, PDF/JPEG/PNG); API proxies all uploads — service-role key never touches the browser
- Signed URLs are regenerated per GET (1-hour TTL); DB row stores the path, never the signed URL
- Stylists upload/view/delete (unverified) their own docs from My Account; admins verify/unverify via Stylist Detail
- Verification reflects into stylist columns (license → licenseExpiresAt, insurance → insuranceVerified + insuranceExpiresAt, background_check → backgroundCheckVerified); unverify does NOT roll these back (manual edit)
- Compliance badge `computeComplianceStatus()` in `src/lib/compliance.ts` — green/amber/red/none; dot on Stylists list + status chip on Stylist Detail
- New API routes: `POST /api/compliance/upload`, `GET /api/compliance?stylistId=`, `DELETE /api/compliance/[id]`, `PUT /api/compliance/[id]/verify`, `PUT /api/compliance/[id]/unverify`
- Extended `PUT /api/stylists/[id]` Zod schema with license/insurance date fields
- Daily cron `GET /api/cron/compliance-alerts` at 09:00 UTC — Bearer `CRON_SECRET`; emails facility admins (or `NEXT_PUBLIC_ADMIN_EMAIL` fallback) when any verified compliance doc or stylist license/insurance expiry date falls exactly 30 or 60 days from today; `vercel.json` registers the schedule; middleware bypass added for `/api/cron/*`

### Phase 8 SHIPPED (2026-04-14) — Workforce Availability & Coverage
- New table: `stylist_availability` (stylist_id, facility_id, day_of_week 0–6, start_time HH:MM, end_time HH:MM, active) with `UNIQUE(stylist_id, day_of_week)`
- New table: `coverage_requests` (facility_id, stylist_id, requested_date, reason, status: open|filled|cancelled, substitute_stylist_id, assigned_by, assigned_at)
- API: `GET/PUT /api/availability` (full-week atomic replace via `db.transaction()`); `GET/POST /api/coverage` + `PUT/DELETE /api/coverage/[id]`
- My Account (stylists): Weekly Availability grid (7 days, checkbox + time inputs, 44px min-height) + Time Off card with inline request form, status badges (open/filled/cancelled), inline cancel
- Dashboard (admins): amber banner below access-requests banner, Coverage Queue card in right rail (`id="coverage-queue"`) with substitute `<select>` + Assign button (optimistic removal)
- Stylist Detail (admins): read-only Availability card between Compliance and Upcoming; consecutive same-time days collapse into `Mon–Fri 9am–5pm` style ranges
- Emails: `buildCoverageRequestEmailHtml` (to admins on new request) + `buildCoverageFilledEmailHtml` (to requester on fill); burgundy header, fire-and-forget
- Role guards: stylist can only cancel their own open request; admin owns fill/delete transitions; stylist-role GET is always forced to self regardless of query params
- RLS + `service_role_all` policy on both new tables

### Phase 8.5 SHIPPED (2026-04-14) — Franchise Stylist Directory, ST Codes, Availability-Based Portal Booking
- Schema: `stylists.facility_id` is now NULLABLE; added `stylists.franchise_id` (nullable FK → `franchises.id`); added `stylists.stylist_code` (NOT NULL, UNIQUE, `^ST\d{3,}$`, backfilled `ST001`+ in `created_at` order); replaced `coverage_requests.requested_date` with `start_date` + `end_date` (CHECK `end_date >= start_date`)
- Helper: `src/lib/stylist-code.ts` → `generateStylistCode(tx)` with `pg_advisory_xact_lock(9191)` for race-safe serial generation inside a `db.transaction()`; `getUserFranchise()` added to `src/lib/get-facility-id.ts`
- Portal flow overhaul: removed client-side stylist picker. Flow is service → date → time → confirm. Stylist assigned server-side by `resolveAvailableStylists()` + least-load picker in `src/lib/portal-assignment.ts`
- New APIs: `POST /api/stylists/import` (CSV/XLSX, 200-row cap); `GET /api/coverage/substitutes?date=` (two groups — facility + franchise pool); `GET /api/portal/[token]/available-days?month=YYYY-MM`
- Rewritten API: `GET /api/portal/[token]/available-times` consults `stylist_availability` and returns only slots with ≥1 candidate; `POST /api/portal/[token]/book` no longer requires `stylistId` and picks the least-loaded available stylist; 409 when none
- Coverage updates: POST/PUT/GET use `startDate`+`endDate`; overlap-based duplicate detection; email templates (`buildCoverageRequestEmailHtml`, `buildCoverageFilledEmailHtml`) render `Jun 3 – Jun 7` or single date
- UI: new `/stylists/directory` page (admin, franchise-scoped) with search, filter pills, inline Add Stylist, CSV/XLSX import modal; Directory nav link in sidebar between Stylists and Services; Stylist Detail gains ST code (read-only for facility admin, editable for master admin) + Facility Assignment dropdown (franchise facilities + "Unassigned"); Dashboard Coverage Queue picker now shows two `<optgroup>` groups ("This Facility" / "Franchise Pool") with `{name} ({stylistCode})` options; My Account time-off form is a date-range with two `<input type="date">`
- GET /api/stylists gains `?scope=facility|franchise|all` so every stylist-listing call makes its scope choice explicit (pool rows are silently excluded by `eq(facilityId, X)`)

### Stylist Import Enhancement SHIPPED (2026-04-15) — Bookkeeping CSV Support
- 6 new nullable columns on `stylists`: `email`, `phones` (jsonb, was `phone text`), `address`, `payment_method`, `license_state`, `schedule_notes`
- `phones` is `jsonb NOT NULL DEFAULT '[]'` storing `Array<{label: string, number: string}>` — replaced single `phone text` column; supports "443-910-1610 or 410-555-0123" parsing into two entries
- `license_state` is a separate field from `license_type` — stores which state(s) the stylist is licensed in (e.g. `MD, VA`); labeled "Licensed In" in the detail page
- Import route overhauled (`src/app/api/stylists/import/route.ts`): FNAME+LNAME column mapping, `%PD` commission parsing (strip %, parse float, round/clamp), address + ZIP combine, SKIP_HEADERS for bank/SSN fields; `parsePhones()` splits on "or", "or alternate", "/", "&"; lenient validation: bad email/ST code dropped silently (only name is a hard fail); batched single Gemini call for all SCHEDULE rows (no per-row calls); `maxDuration = 300`; real header row detection (skips leading garbage rows like bookkeeping CSV preamble)
- Gemini 2.5 Flash SCHEDULE column parsing: single batched request with indexed schedule texts, returns `{"0": [{facility, days[]}], ...}`; fallback to raw text in `scheduleNotes` on failure
- Facility fuzzy matching: exact → substring (either direction) → longest match win; unmatched → `scheduleNotes`
- `stylistAvailability` rows inserted via `onConflictDoNothing()` with day-level conflict detection (first matched facility wins, duplicate day stored in `scheduleNotes`)
- Response shape: `{ imported, updated, availabilityCreated, scheduleNotes, errors }`
- PUT `/api/stylists/[id]` `updateSchema` extended with all fields including `phones: array({label,number}).max(10)`
- Stylist detail (`stylist-detail-client.tsx`): "Licensed In" field added to License section (editable); **editable Phone numbers section** with label dropdown (mobile/office/home/work/fax/custom) + number input + remove button + "+ Add" button (admin-only); Contact section (address + paymentMethod display, phone removed); `scheduleNotes` shown below Availability card as italic muted note
- Stylists list (`stylists/page.tsx`): `licenseState` badge renders as `"MD • VA"` after the stylist name (subtle, `bg-stone-100`)
- Directory import result display (`directory-client.tsx`): shows `availabilityCreated` + `scheduleNotes` counts alongside imported/updated
- Import default changed to franchise pool: `resolvedFacilityId = null` when no `facilityName` column; stylists land in franchise pool instead of being pinned to admin's current facility
- Directory bulk delete: multi-select checkboxes, select-all header, floating action bar, per-row trash icon; `POST /api/stylists/bulk-delete` (soft-delete, franchise-scope verified)

### Phase 9 PLANNED — Territory / Region Management
- New table: `regions` (id, name, franchise_id nullable, active)
- Add `region_id` to `facilities` and `stylists` tables
- Regions tab in `/super-admin` for CRUD
- Region filter on all list and report views
- Hierarchy: Master Admin → Franchise → Region → Facility

### Phase 10 PLANNED — Payroll Operations
- New table: `payroll_periods` (start_date, end_date, status: draft|approved|paid)
- New table: `payroll_entries` (payroll_period_id, stylist_id, gross_revenue_cents, commission_cents, tips_cents, adjustments_cents, total_pay_cents, booking_ids text[], approved)
- Auto-calculates from completed bookings using stylists.commission_percent
- Admin approval workflow before marking a period paid
- QuickBooks-compatible payroll CSV export
- Payroll history on stylist detail page

### Phase 11 PLANNED — Incident & Issue Tracking
- New table: `issues` (facility_id, stylist_id nullable, booking_id nullable, reported_by, issue_type: cancellation|complaint|safety|access_problem|payment_issue|supply_issue|staff_behavior|other, severity: low|medium|high, description, action_taken, assigned_to, status: open|in_progress|resolved, resolved_at)
- "Report Issue" button on booking cards and log rows
- Issues list in Settings
- High severity triggers email to admin + red dashboard banner
- Issue count shown on facility and stylist detail pages

### Phase 12 PLANNED — Advanced KPI Dashboard
- No schema changes
- New metrics in `/reports` and super-admin reports: cancellation rate per facility, avg ticket per stylist, utilization rate, facility concentration risk, MoM/YoY trends
- Region filtering on all metrics
- Weekly email digest to NEXT_PUBLIC_SUPER_ADMIN_EMAIL
- Dashboard PDF export

### Phase 13 PLANNED — Facility Contact Portal
- New role `facility_contact` in `facility_users.role`
- New table: `service_change_requests` (facility_id, submitted_by, request_type: add_day|cancel_day|change_hours|request_substitute|special_event, requested_date, notes, status: pending|approved|denied)
- Facility contacts invited via existing invite flow with the new role
- Restricted nav: Schedule (read-only), Visit Summaries, Invoices, Submit Request
- Cannot see residents, other facilities, or stylist details

### Phase 14 PLANNED — QuickBooks Online Integration
- New columns on `facilities`: quickbooks_realm_id, quickbooks_access_token, quickbooks_refresh_token, quickbooks_token_expires_at
- New table: `quickbooks_sync_log` (facility_id, entity_type: invoice|payroll, entity_id, qb_id, status: synced|failed, error, synced_at)
- OAuth connection per facility in Settings → Integrations tab
- Push invoices and payroll entries to QuickBooks Online
- Sync payment status back from QB
- Sync error log with retry button
- CSV export remains as fallback for non-QB facilities

---

## 6. CURRENT STATUS

### Working
- Phase 9 Prompt 4 — Backfill, Who's Working Today, My Account Schedule, Stylist Invite (2026-04-15): backfill script seeded 2 `stylist_facility_assignments` rows from existing `stylists.facility_id`. Added `stylists.last_invite_sent_at` (timestamptz) via migration script. New `POST /api/stylists/[id]/invite` route (admin-only, franchise-scoped, email required, no linked profile, 24h rate limit via `lastInviteSentAt`). Dashboard right rail gains "Who's Working Today" card (admin-only, above Coverage Queue) showing color dot + name + formatted hours for today's scheduled stylists + "Tomorrow:" names line. My Account "Your Schedule" replaces the flat 7-day checkbox grid with a per-day display (facility name + hours + inline [Edit hours] button for active rows; "— not scheduled" for inactive). Stylist Detail info card now shows email field + "Send account invite →" / "Account linked ✓" / "Invite sent Nh ago" inline UI.
- Phase 9 Prompt 3 — Core query migration to `stylist_facility_assignments` + Directory Add Stylist bug fix (2026-04-15): every facility-scoped stylist query now innerJoins `stylist_facility_assignments` (active=true) and filters `stylists.status='active'` on booking surfaces. Migrated: `portal-assignment.ts`, `GET /api/stylists` (all scopes + new franchise-wide union for `scope=all`), `/api/portal/[token]/stylists`, `/api/portal/[token]/available-times`, `/api/portal/[token]/available-days`, `GET /api/coverage/substitutes` (facility pool), `GET /api/cron/compliance-alerts` (now fans out one alert per assigned facility, legacy `facility_id` fallback), `POST /api/bookings` stylist-in-facility guard, `/stylists` list page (also adds specialties pills), `/stylists/directory` page (franchise-wide union so new pool stylists survive refresh). `/available-times` + `/available-days` + `resolveAvailableStylists()` also filter availability by `stylistAvailability.facilityId` (3-column UNIQUE). Directory gains a second status filter pill row (All/Active/On Leave/Inactive) + per-row status badges (amber on_leave / stone inactive/terminated). Add Stylist inline form wrapped in `<form onSubmit>`, Enter-key submits, `pattern=` attr removed (silently blocked submit), `autoFocus` on name. `stylists.facility_id` is now officially deprecated (still used for franchise-pool `NULL` marker + legacy fallback only).
- Phase 9 Prompt 2 — Assignments, Notes, Status, Specialties (2026-04-15): added status dropdown + specialties chips to Stylist Detail info card (saved via existing handleSave → PUT /api/stylists/[id]). New `GET/POST /api/stylists/[id]/assignments` and `PUT /api/stylists/[id]/assignments/[assignmentId]` routes (admin-only, franchise-scoped, commission nullable = "use default"). New `GET/POST /api/stylists/[id]/notes` and `DELETE /api/stylists/[id]/notes/[noteId]` routes (admin-only, hard delete, `authorUserId` server-derived, `authorEmail` joined from profiles). Stylist Detail gains an Assignments card (per-facility rows with commission display via `resolveCommission()`, inline edit, active toggle, add form) and a Notes card (textarea + Add Note, list with date/author/delete) above the Compliance card. All UI updates are optimistic — no `router.refresh()`.
- Phase 9 schema foundation (2026-04-15): added `stylists.status` (`active|inactive|on_leave|terminated`, CHECK constraint) + `stylists.specialties` (jsonb `string[]`, default `[]`). Created `stylist_facility_assignments` (per-facility commission override; `commission_percent` nullable = "use stylist default"; UNIQUE on `(stylist_id, facility_id)`) and `stylist_notes` (admin-only internal notes; `body` + `author_user_id → profiles.id`). Both new tables have RLS + `service_role_all` policies. Swapped `stylist_availability` UNIQUE from `(stylist_id, day_of_week)` → `(stylist_id, facility_id, day_of_week)` so a stylist can have per-facility hours for the same weekday. Added `src/lib/stylist-commission.ts` (`resolveCommission()` pure helper — `!= null` check so `0` is a valid override). Schema, types, relations, helper only — no API routes, no UI, no backfill. Prompt 2+ will add those.
- PDF parser → Gemini vision (2026-04-12): replaced pdfjs-dist alternating-chunks regex parser with a direct Gemini 2.5 Flash PDF vision call. Gemini receives the raw PDF as base64 application/pdf inlineData and returns a structured JSON array. Reason: text extraction silently drops sections on PDFs with non-standard internal layouts (Symphony Manor first section was always missing). No frontend changes needed — response shape unchanged.
- Pricing UI fixes (2026-04-12): addon $0 bug fixed; tiered stepper (44px − / qty / + buttons) with live tier hint; booking modal price breakdown shows `(qty × $X/ea)` for tiered, `— OptionName` for multi_option, amber `text-amber-700` for addon checklist lines.
- Category + pricing display fixes (2026-04-13): `category` column added to services table; bulk import now persists category; services list shows category sub-label under name; `formatPricingLabel()` fixed for addon (now shows `+$15.00` not `$0.00 + $15.00`); booking modal service selector cleaned up to `"Service · $X.00"` format.
- Unified mobile booking flow + category grouping (2026-04-13): QuickBookFAB reduced to a pure FAB button (~35 lines). `booking-modal.tsx` is now the single booking UI on all platforms via `useIsMobile()` — mobile users get the full pricing stack (addon checklist, tiered stepper, multi-option select, breakdown). Dashboard wires both FAB usages to new `openQuickCreate()` (next 30-min slot from now). Service `<select>` options grouped by `service.category` via `<optgroup>` (Other last, skipped when only 1 category). Add-on checklist uses same grouping as section sub-headers. Services page list gets category section headers between rows.
- OCR price-aware service pre-selection (2026-04-14): `buildSheetState` now uses a two-signal resolution for primary service: (1) name fuzzy match via `fuzzyBestMatch`, (2) exact price match against `s.priceCents === ocrPrice`. Logic: if only one non-addon service has the exact OCR price AND name score < 0.85, prefer price match; if name match found, trust it (price mismatch = add-ons included in total); if no name match, fall back to unique price match. Gemini price rule updated: "price column = exact combined dollar amount, never estimate, null if unreadable".
- OCR price preservation (2026-04-14): sheet price is the source of truth — service select onChange handlers never touch `priceCents`. Gemini prompt now explicitly instructs: extract EXACT dollar amount written, never substitute catalog price, return null if not written. Price field in review UI shows "from sheet" hint below input.
- OCR Gemini context + matching fixes (2026-04-14): route now accepts `servicesJson` field (facility's service names + prices) and builds a dynamic Gemini prompt via `buildInstruction(knownServices)` that includes the service list + `ABBREVIATIONS` expansion table. Gemini uses price as a strong signal to expand "S/BDry" → "Shampoo, Blow Dry". Added name-clarity rule to prompt ("never return gibberish, write Unclear if unreadable"). Client appends `servicesJson` to each batch FormData. Primary service fuzzy matching now excludes addon-type services to prevent false matches like "S/BDry" → "Add on Deep Conditioner".
- OCR review service select + fuzzy pre-select (2026-04-14): service field changed from free-text input + datalist to a `<select>` of existing facility services (grouped by category, price shown). `fuzzyBestMatch(services, name, 0.7)` pre-selects the best match at load time — catches "S/Cut" → "Shampoo Cut" etc. `__new__${name}` option at bottom triggers new service creation. Same pattern for add-on service selects. Removed "Did you mean" amber banners for services (select makes them redundant). Added `fuzzyScore()` and `fuzzyBestMatch()` utility functions in the modal file.
- Fun loading screen during OCR scan (2026-04-14): when `scanning === true`, upload step content is replaced by an animated loading overlay — teal pulsing document SVG with bouncing sparkle, rotating `SCAN_TIPS` messages (8 tips) cycling every 3s with CSS opacity fade (400ms), and a progress bar that parses "Scanning batch X of Y" from `scanProgress` state (X/Y×100% capped at 90%, default 5%). State: `tipIndex`, `tipVisible`, `useEffect` keyed on `scanning`. Normal upload step renders when not scanning.
- PDF thumbnails and lightbox in OCR upload (2026-04-13): fixed `workerSrc = ''` (was silently failing); OCR modal now renders PDFs at scale 0.5 for upload thumbnails and scale 1.5 for review/lightbox, stored in parallel `previews[]` + `fullResPreviews[]` arrays.
- OCR batch scanning fix (2026-04-13): large uploads (>5-6 PDFs) were timing out at 60s on Vercel. Client now splits files into chunks of 3 and POSTs sequentially; sheets arrays are merged before review. Route maxDuration raised to 120.
- Recurring booking double-submission fix (2026-04-13): `setSubmitting(true)` is async state — rapid taps or simultaneous Cmd+Enter + click slip through before React re-renders. Added `submittingRef = useRef(false)` mutex in `handleSubmit` (synchronous, immune to batching). Also added missing `revalidateTag('bookings', {})` to `POST /api/bookings/recurring`.
- Inline create resident from booking modal + walk-in form (2026-04-13): type ≥3 chars with no match → "+ Create 'name'" option appears at bottom of dropdown; tap → mini-form (name pre-filled, room optional) → POST /api/residents → auto-select. `localNewResidents: Resident[]` state merges session-created residents with the prop list for filtering. Same pattern in booking-modal.tsx and log-client.tsx walk-in form. All create state resets when modal/form closes.
- QoL fixes (2026-04-13): (1) Residents page sortable column headers — name / room / last visit / total spent, same pattern as services page. (2) Settings invite form defaults `inviteFacilityId` to `facility.id` so current facility is pre-selected. (3) Booking modal + log walk-in auto-select resident's `defaultServiceId` when a resident is chosen (verified service exists in primaryServiceCandidates before selecting).
- Desktop modal top overflow fix + services sortable columns (2026-04-13): Modal overlay changed to `items-start pt-16`; panel gets `max-h-[calc(100dvh-5rem)] overflow-y-auto` so content below browser chrome is always reachable. Services page adds CATEGORY column (col-span-2) with sortable headers — name / category / duration / price. Sort logic handles all four keys including `sortablePrice()` for complex pricing types. Category section headers only shown when `sortKey === 'category'`; all other modes render flat. Category sub-label under service name removed (redundant with column).
- Booking modal visibility audit + defensive fixes (2026-04-13): audited three reported symptoms (resident field hidden on mobile, "+ Add another service" missing on mobile, category optgroups not rendering). All three hypotheses refuted by the source — BottomSheet header is a flex sibling above the scroll area (not an overlay), "+ Add another service" has no `isMobile` guard and renders unconditionally (booking-modal.tsx lines 542-551), and `Service.category` is wired end-to-end (types → Drizzle query → API → BookingModal props). Shipped two narrow defensive fixes: (1) `useIsMobile()` now lazy-initializes from `window.innerWidth` (eliminates the first-open Modal→BottomSheet frame flash on mobile); (2) booking-modal's scroll-to-top moved to a dedicated `useLayoutEffect` with deps `[open, isMobile]` so the DOM walk re-runs after the mobile-mode swap and reliably hits the BottomSheet's scroll container.
- Multi-service bookings + OCR combo detection + PDF category fixes (2026-04-12): bookings table gained `service_ids text[]`, `service_names text[]`, `total_duration_minutes integer`. Booking modal now supports N primary services via list-with-add-button; POST/PUT/recurring routes accept `serviceIds` (falling back to `serviceId` for back-compat). Calendar `eventContent()` shows "Cut + Color" on week/day views; log `serviceDisplayName()` joins primary + addon names. Addon UX polished: 24px checkboxes, 44px rows, labeled "Add-ons (optional)" divider, sticky footer with safe-area-inset-bottom. Service price display everywhere uses `formatPricingLabel()` (log walk-in dropdown + portal service cards). OCR Gemini prompt returns `additionalServices: string[]` for combos like "Shampoo + Long Hair"; review modal has per-add-on combo inputs with fuzzy match; import creates single multi-service booking. PDF parser gained three fallbacks: `CATEGORY_KEYWORDS` set for standalone headers, `inferCategoryFromName()` when currentCategory is empty/generic, Long Hair/Matted Hair inherit `previousServiceCategory`.
- Invite deduplication + clean revocation (2026-04-12): POST /api/invites now upserts — if a pending invite exists for email+facility it refreshes the token and resends; if a used invite exists it returns a clear 409 error. DELETE /api/facility/users/[userId] now clears profiles.stylist_id and cancels pending invites in a transaction on revocation. DELETE /api/invites/[id] clears profiles.stylist_id if the revoked email had a stylist linked at that facility. Team tab shows linked stylist name next to role badge. UI shows "Invite refreshed and resent" vs "Invite sent!" correctly.
- Full auth flow: invite → accept → correct facility + role (fixed 2026-04-07)
- Invite emails now send from noreply@seniorstylist.com (domain verified)
- Invite accept works for unauthenticated users: magic link + Google OAuth on same page
- Login redirect preservation: middleware passes ?redirect= through OAuth callback
- Resend invite button in Settings → Invites tab
- Expired/pending badges on invite list
- Stylist role: correct nav, correct restrictions, log filtering
- Admin role: full access to their facility
- Master admin: /super-admin, franchise management, all facilities
- Email: invites, access requests, approvals all send via Resend
- POA fields on residents
- Mobile speed improvements: prefetch, skeletons, instant tab highlight
- Franchise CRUD in super admin page
- Cross-facility reporting (Phase 4): Reports tab in /super-admin with revenue chart, outstanding balances, mark-paid, CSV export
- Flexible pricing types (Phase 4.5): addon, tiered, multi_option pricing on services; conditional booking modal inputs; PDF parser pricing detection
- PDF parser extraction fix (2026-04-09): switched from unpdf to pdfjs-dist getTextContent() with position-based sorting — unpdf silently dropped the first text layer on Symphony Manor PDF. All 16 services now parse correctly across 5 sections.
- pdfjs-dist worker fix (2026-04-09): removed createRequire workerSrc override — pdfjs v5 auto-sets "./pdf.worker.mjs" relative to pdf.mjs on Node.js and loads it via dynamic import() in main thread. Override caused "Failed to parse PDF" on Vercel because absolute path didn't match deployed bundle layout.
- Invite accept cookie fix (2026-04-10): page.tsx crashed with "Cookies can only be modified in a Server Action or Route Handler" — moved all authenticated redemption logic to GET /api/invite/redeem route handler; page.tsx now redirect()s there after confirming auth.
- User lifecycle overhaul (2026-04-10): Fixed middleware infinite redirect loop (added /api/invite/redeem to bypass list for users without facilityUser). Added Supabase session invalidation on access revocation. Team tab now shows Active/Invited/Inactive status badges. Invites tab has Re-invite button for expired invites. Invite revocation cleans up pending access_requests. Cleaned up 7 test invites, reset 2 stuck invites for cheflisa817@gmail.com.
- Remove Access button (2026-04-09): Settings → Team tab — admin can revoke any non-self user's facility access. Two-step inline confirm (click Remove → "Remove? Yes No", mouse leave cancels). API: DELETE /api/facility/users/[userId] — guards: must be admin, can't remove self, can't remove last admin. Local list updates optimistically after success.
- Test account cleanup (2026-04-09): deleted facility_users + profiles rows for joshsgerhardt@gmail.com and gmanistheman473@gmail.com. Auth users untouched.

### In Progress / Needs Testing
- OCR log sheet import — full stack shipped (2026-04-01)
  Gemini 2.5 Flash, PDF preview via pdfjs-dist, safe area insets,
  source image lightbox, dedup via fuzzy match against DB records,
  WORD_EXPANSIONS normalization. Needs real-world test with Symphony Manor.
- Resident deduplication — shipped (2026-04-01)
  GET /api/residents/duplicates (fuzzy score >= 0.6), POST /api/residents/merge
  (bookings reassigned, merged resident soft-deleted), MergeDuplicatesModal
  with Keep A/B + editable name/room + localStorage dismissed pairs.

### Not Started
- Symphony Manor and Sunrise Bethesda not yet created in app
- Real stylists Sierra, Mariah Owens, Senait Edwards not yet invited
---

## 7. IMMEDIATE NEXT FIX

Phase 9 complete (all 4 prompts shipped 2026-04-15). Next steps:
1. Set `CRON_SECRET` in Vercel (`openssl rand -hex 32`) so the daily compliance cron authenticates.
2. (optional) Provision Upstash Redis and set UPSTASH_REDIS_REST_URL/TOKEN in Vercel — without them the rate limiter is a no-op.
3. Onboard Symphony Manor + Sunrise Bethesda — create facilities, invite real stylists (Sierra, Mariah Owens, Senait Edwards), upload compliance docs, set weekly availability. Use the new "Send account invite →" button on each Stylist Detail page once email is on file.
4. Begin Phase 10 — Payroll Operations.

---

## 8. CRITICAL RULES

1. Every Claude Code prompt starts with:
   Read docs/master-spec.md, docs/design-system.md, and CLAUDE.md first.
   Use the supabase MCP to verify schema before writing code.
   Then /plan the following before writing any code:

2. RLS on every new table — service_role_all policy always.
   Tables queried by middleware also need authenticated SELECT policy.

3. Never put redirect() inside try/catch in Next.js pages.

4. DB pool max:1 in session mode — never set higher.

5. OCR uses gemini-2.0-flash on v1beta endpoint (direct fetch, no SDK). All Gemini 1.5 models shut down March 2026 — never use them.

6. All emails fire-and-forget — never await sendEmail().

7. Prices always in cents in DB, never floats.

8. Never hard delete — always active=false.

9. All DB queries scoped to facilityId via getUserFacility().

10. Next.js 16 async params — always { params: Promise<{id: string}> }.

11. `revalidateTag` in Next.js 16 takes TWO args — `revalidateTag('bookings', {})` not `revalidateTag('bookings')`.

12. Super-admin reports use `unstable_cache` with `tags: ['bookings']` and `revalidate: 300`. Cache key must include sorted facilityIds + month/year.

---

## 9. END OF SESSION CHECKLIST

At the end of every Claude Code session:
1. Update docs/master-spec.md with new routes and schema
2. Update docs/design-system.md with new UI patterns
3. Update CLAUDE.md with new rules and bugs fixed
4. Update docs/project-context.md — current status, phases, next fix
5. Re-upload all four files to Claude Projects
