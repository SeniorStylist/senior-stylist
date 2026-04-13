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

### Phase 5 PLANNED
- Resident portal enhancements
- POA can book on behalf of resident
- CSV template export for bookkeepers
- Booking confirmations to resident and POA

### Phase 6 PLANNED
- Per-stylist Google Calendar integration
  - Add `calendar_id` column to `stylists` table
  - Add `google_refresh_token` to `stylists` table (OAuth per stylist)
  - OAuth flow: each stylist connects their personal Google Calendar
    from My Account page
  - Sync: stylist's bookings go to their personal calendar only
  - Facility calendar continues to receive ALL bookings (unchanged)
  - Stylist sees only their own appointments in their Google Calendar
  - Facility rep sees all appointments in facility calendar
  - Admin UI: show connected/disconnected status per stylist on
    Stylists page

### Phase 7 PLANNED — Compliance & Document Management
- New table: `compliance_documents` (stylist_id, document_type: license|insurance|w9|contractor_agreement|background_check, file_url, file_name, expires_at, verified, uploaded_at)
- New columns on `stylists`: license_number, license_type, license_expires_at, insurance_verified, insurance_expires_at, background_check_verified
- Stylists upload compliance docs from My Account page
- Admins verify documents on the Stylists page
- Compliance badge (green/amber/red) on stylist list rows based on expiry/verification status
- Expiration alerts at 60 days and 30 days via Resend email to admin

### Phase 8 PLANNED — Workforce Availability & Coverage
- New table: `stylist_availability` (stylist_id, day_of_week, start_time, end_time, active)
- New table: `coverage_requests` (facility_id, stylist_id, requested_date, reason, status: open|filled|cancelled, substitute_stylist_id)
- Stylists set weekly availability and submit time-off requests from My Account
- "Needs Coverage" flag on calendar days where a regular stylist has a gap
- Admin coverage queue to assign a substitute stylist
- Email alerts on gap creation and on substitute assignment

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
- PDF parser → Gemini vision (2026-04-12): replaced pdfjs-dist alternating-chunks regex parser with a direct Gemini 2.5 Flash PDF vision call. Gemini receives the raw PDF as base64 application/pdf inlineData and returns a structured JSON array. Reason: text extraction silently drops sections on PDFs with non-standard internal layouts (Symphony Manor first section was always missing). No frontend changes needed — response shape unchanged.
- Pricing UI fixes (2026-04-12): addon $0 bug fixed; tiered stepper (44px − / qty / + buttons) with live tier hint; booking modal price breakdown shows `(qty × $X/ea)` for tiered, `— OptionName` for multi_option, amber `text-amber-700` for addon checklist lines.
- Category + pricing display fixes (2026-04-13): `category` column added to services table; bulk import now persists category; services list shows category sub-label under name; `formatPricingLabel()` fixed for addon (now shows `+$15.00` not `$0.00 + $15.00`); booking modal service selector cleaned up to `"Service · $X.00"` format.
- Unified mobile booking flow + category grouping (2026-04-13): QuickBookFAB reduced to a pure FAB button (~35 lines). `booking-modal.tsx` is now the single booking UI on all platforms via `useIsMobile()` — mobile users get the full pricing stack (addon checklist, tiered stepper, multi-option select, breakdown). Dashboard wires both FAB usages to new `openQuickCreate()` (next 30-min slot from now). Service `<select>` options grouped by `service.category` via `<optgroup>` (Other last, skipped when only 1 category). Add-on checklist uses same grouping as section sub-headers. Services page list gets category section headers between rows.
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
- Phase 5 resident portal POA booking

---

## 7. IMMEDIATE NEXT FIX

QoL improvements + Phase 7 (2026-04-13). Next steps:
1. Onboard Symphony Manor + Sunrise Bethesda — invite real stylists Sierra, Mariah Owens, Senait Edwards
2. Phase 5: resident portal POA booking (plan written at docs/portal-auth-plan.md)
3. Phase 7: Compliance & Document Management — compliance_documents table, stylist license/insurance columns, upload UI in My Account, verify UI in Stylists page, expiry alerts

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
