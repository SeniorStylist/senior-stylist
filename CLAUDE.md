# Senior Stylist — Claude Code Rules

## Project
- Live site: https://portal.seniorstylist.com
- GitHub: https://github.com/SeniorStylist/senior-stylist
- Supabase project: goomnlsdguetfgwjpwer

## Agent Entry Point
- `AGENTS.md` at project root — auto-read by Claude Code on session start; imports core rules and Next.js doc-reading requirement

---

## Response Style
- Reply concisely. No preamble, no narration of steps.
- No phrases like "I'll now…", "I'm going to…", "Great, let's…"
- Lead with the action. Show results, not process.
- If a plan is needed, /plan first — then execute without re-explaining the plan.

## Context Management
- Run `/compact` with instructions before switching phases mid-session: `/compact Focus on schema changes, new API routes, and any open bugs`
- If context feels degraded (repeated questions, forgotten rules), stop and `/clear` — do not continue degraded
- Never use the final 20% of context for multi-file tasks — restart session instead

---

## Performance (Phase 13)

### DB connection pool (`src/db/index.ts`)
- Singleton via `globalThis._pgClient` — postgres-js client is reused across requests in the same serverless instance
- `max: 1` (never raise)
- `connect_timeout: 10` (never lower)
- `prepare: false` is **NOT set** — session-mode pooler (port 5432) supports prepared statements; only transaction-mode (port 6543) requires it
- `DATABASE_URL` MUST point to Supabase **session-mode** pooler (port 5432); `DIRECT_URL` (port 5432 direct connection, not pooler) is for `drizzle-kit push` only
- **postgres-js session mode requires ISO string date params** — NEVER pass raw `Date` objects into `sql\`...\`` template interpolations or `db.execute()`. Always use `date.toISOString()`. Transaction mode (port 6543) auto-coerced types; session mode does not. Drizzle ORM `insert().values()` handles `Date` objects correctly (schema type is `Date`); the restriction applies only to raw `sql` template literals and `db.execute()` params.

### `unstable_cache` registry
| Key | TTL | Tag | Where |
|---|---|---|---|
| `master-admin-facility-infos` | 5min | `facilities` | master-admin/page.tsx |
| `master-admin-pending-access-requests` | 1min | `access-requests` | master-admin/page.tsx |
| `master-admin-active-facilities-list` | 5min | `facilities` | master-admin/page.tsx (Phase 13) |
| `master-admin-franchise-list` | 5min | `facilities` | master-admin/page.tsx (Phase 13) |
| `billing-summary` | 2min | `billing` | api/billing/summary/[facilityId] |
| `cross-facility-summary` | 2min | `billing` | api/billing/cross-facility-summary (Phase 13) |
| `super-admin-monthly-report` | 5min | `bookings` | api/super-admin/reports/monthly |
| `super-admin-outstanding-report` | 5min | `bookings` | api/super-admin/reports/outstanding |

Mutation routes MUST call `revalidateTag('<tag>', {})` on success. Tags currently busted: `facilities` (6 mutation routes), `bookings` (booking + log + import-review mutations), `billing` (save-check-payment, Stripe webhook, reconcile, import-review), `pay-periods` (payroll mutations), `access-requests` (access-request POST/PUT).

### Master admin cold-cache pattern (Phase 13)
Per-facility-loop count queries are FORBIDDEN at scale. With `max: 1` connection, N facilities × 4 queries = N×4 serialized round-trips (2-4s for 30 facilities). Use `GROUP BY` aggregations instead — one `db.execute(sql\`SELECT facility_id, COUNT(*) ... GROUP BY facility_id\`)` returns all counts in one query, then build a `Map<facilityId, count>` in JS and look up per-facility values when shaping the response. The `getCachedFacilityInfos` cache function in `master-admin/page.tsx` is the canonical example.

### Middleware short-circuit (Phase 13)
`src/middleware.ts` short-circuits before calling `supabase.auth.getUser()` for paths that have their own auth (or no auth):
- `/portal/*` + `/api/portal/*` (portal session cookie)
- `/family/*` (portal session cookie)
- `/invoice/*` (public)
- `/api/cron/*` (Bearer secret)
- `/privacy` + `/terms` (public)

When adding a new public path, ALSO add it to the short-circuit list — otherwise every request makes an unnecessary network call to Supabase auth.

The `isPublic` allowlist inside the middleware body is now a SUBSET of routes that still need session refresh (`/login`, `/auth`, `/unauthorized`, `/invite/accept`, `/api/auth/google-calendar/callback`).

---

## Help Center Sync (Phase 12G/12H)

**Any UI change that adds, renames, moves, or removes a page, nav item, button, modal, or settings section MUST update the Help Center in the same commit.** Failure to sync is a bug, not a nice-to-have.

Specifically, for every such change:
1. **`src/lib/help/tours.ts`** — update any `TourStep.element` selector that pointed at the renamed/moved element; update `TourStep.route` if the page path changed; update popover copy if the UI label changed. If a new page or major feature is added, add a matching tour definition.
2. **`TUTORIAL_CATALOG` in `tours.ts`** — add a new card when a new feature, page, or workflow is introduced that users need to learn.
3. **`<HelpTip>` injections** — add a HelpTip next to any new major workflow entry point (buttons, section headers) that links to a relevant tour.
4. **`data-tour` and `data-tour-mobile` attributes** — keep these in place on refactored elements. Never strip them as "unused" HTML attributes — the tour engine depends on them.

Rules for stable selectors:
- **Dynamic-route pages** (`/residents/[id]`, `/stylists/[id]`, `/payroll/[id]`) cannot be targeted by tours. Tour steps for these pages MUST use `element: ''` (info popover) and describe what the user will see, rather than pointing a selector at the detail page.
- **Conditional elements** (only in DOM when a modal/form is open) are only safe as tour targets when the immediately preceding step is `isAction: true` and clicking it is what opens the element. If there is no such preceding action step, use `element: ''` instead.
- **Role-gated or data-dependent elements** (e.g. `billing-facility-select` only for master, `billing-invoice-list` only for IP facilities) must use `element: ''` so the tour doesn't show a warning toast to users who don't have the element.

**Phase 12J — Mobile tour system** (`src/lib/help/mobile-tour.ts` + `src/components/help/mobile-tour-overlay.tsx`):
- `startTour()` in `tours.ts` branches on `isMobile()` (`window.matchMedia('(max-width: 767px)')`). Mobile uses the spotlight + bottom sheet renderer; desktop uses Driver.js. Both share the same `TourStep[]` data and the same sessionStorage resume mechanism.
- `<MobileTourOverlay />` is mounted in `(protected)/layout.tsx` alongside `<TourResumer />` inside `ToastProvider`. Renders `null` until it receives a `help-mobile-tour-show` CustomEvent.
- **Renderer**: four absolutely-positioned `bg-black/60 z-[200]` panels surround the spotlight rectangle (target's `getBoundingClientRect()` + 8px padding). A separate `ring-4 ring-white/30 rounded-2xl pointer-events-none z-[201]` div is the visual ring. Bottom sheet card is `z-[202] bg-white rounded-t-3xl` with `env(safe-area-inset-bottom)` padding. The four panels block clicks on non-spotlight UI; the spotlight area passes clicks through to the underlying element naturally (no panel there); the ring is `pointer-events: none`.
- **Action steps** add the `mobile-tour-spotlight-pulse` class to the ring (1.5s ease-in-out infinite). Bottom sheet hides the Next/Back buttons and shows an **animated arrow + TAP HERE badge** (NOT italic hint text). Arrow is `animate-bounce text-[#8B2E4A]` pointing UP; rotates 180° when `spotlightRect.top > window.innerHeight * 0.6` (element below 60% of screen) to point DOWN. Desktop action steps get `popoverClass: 'senior-stylist-tour action-step'` which renders a pulsing `→ TAP THIS` badge via `::before` pseudo-element on the footer. The mobile engine attaches a one-time capture-phase `click` listener to the target element with a 50ms timeout (mirrors desktop logic).
- **Info steps** show stacked vertical buttons: Next on top (burgundy `#8B2E4A`, 52px min-height, `rounded-2xl`, shadow), Back below (`bg-stone-100`, hidden on first step). Last step's Next becomes `✓ Done` and dispatches close.
- **Swipe gestures** on the bottom sheet: horizontal `|deltaX| > 50px` advances (left → next, right → prev) when `|deltaX| > |deltaY|`. Vertical scroll is preserved.
- **Entrance animation**: bottom sheet `translateY(100%) → 0` over 300ms `cubic-bezier(0.32, 0.72, 0, 1)` on first show only — step transitions don't re-animate. Respects `prefers-reduced-motion` via the existing globals.css block.
- **Cross-route resume**: mobile engine saves `SessionState.mobile = true` to sessionStorage before hard-nav. `resumePendingTour()` reads the flag and routes to `startMobileTour()` directly (bypasses `startTour()`'s `isMobile()` re-check, so the renderer is sticky to the device that started the tour).
- **CustomEvents** (`window.dispatchEvent(new CustomEvent(...))`):
  - `help-mobile-tour-show` `{ tourId, stepIndex, step, totalSteps }` — engine → overlay
  - `help-mobile-tour-hide` `{}` — engine → overlay
  - `help-mobile-tour-advance` `{ direction: 'next' | 'prev' }` — overlay → engine
  - `help-mobile-tour-close` `{}` — overlay → engine
- **`mobileTitle?` / `mobileDescription?`** optional fields on `TourStep`. When `isMobile()` is true the overlay uses `step.mobileTitle ?? step.title` and `step.mobileDescription ?? step.description`.
- **Help-sync rule extension**: when adding a new tour step, include `mobileDescription` if `description.length > 120` or contains "Click". Mobile titles ≤ 40 chars, descriptions ≤ 120 chars. Use "Tap" not "Click" everywhere.
- **Helpers exported from `tours.ts`** (do NOT duplicate in mobile-tour.ts): `isMobile`, `resolveQuery`, `waitForElement`, `isOnRoute`, `saveSessionState`/`loadSessionState`/`clearSessionState`, `toastWarning`/`toastInfo`, `SESSION_KEY`/`SESSION_TTL_MS`/`ELEMENT_WAIT_MS`, `SessionState` type.

**Phase 12I anchors** — `/my-account` page anchors (all in `my-account-client.tsx`):
- `data-tour="my-account-schedule"` — outer div of Your Schedule card (always present for stylists)
- `data-tour="my-account-compliance"` — outer div of Compliance Documents card
- `data-tour="my-account-compliance-upload"` — Upload button (always present in card header)
- `data-tour="my-account-schedule-edit"` — Edit hours button inside day row map (data-conditional — tours use `element: ''`)
- `data-tour="my-account-timeoff"` — outer div of Time Off card
- `data-tour="sidebar-avatar"` — sidebar user info `<div className="flex items-center gap-3 px-3 py-2 rounded-xl">` (display-only, not a link)
- `NAV_MY_ACCOUNT = '[data-tour="nav-my-account"]'` — wired in both `sidebar.tsx` and `mobile-nav.tsx` tourSlug maps
- `stylist-my-account` tour is fully implemented (was `tourId: null` before Phase 12I)
- FullCalendar `slotLabelFormat={{ hour:'numeric', minute:'2-digit', omitZeroMinute:false, meridiem:'short' }}` in `calendar-view.tsx` — axis shows `7:00am`, `8:00am` format

---

## Non-Negotiable Rules

### Database
- ALWAYS scope every DB query to facilityId — never return data across facilities
- NEVER hard delete records — always use `active = false`
- Prices are ALWAYS stored in cents (integers) — display by dividing by 100, NEVER store floats
- After ANY schema change run: `npx dotenv -e .env.local -- npx drizzle-kit push`
- **Indexes MUST be declared in `src/db/schema.ts`** inside the `(t) => ({ ... })` extras block — never create indexes only at the DB level. Reviewers can't see DB-only indexes; the schema is the source of truth. (Phase 11J.4 created three indexes only at DB level — by April 2026 the actual DB had none of them, and the docs lied for two months. The Apr 27 audit pass added them properly.)
- `facilityUsers.role` is the authoritative role — not `profiles.role`
- `facilities.working_hours` is jsonb `{ days: string[], startTime: "HH:MM", endTime: "HH:MM" }` — null = default 08:00–18:00; use it to bound time slots in booking modal
- ALL tables MUST have RLS enabled with a `service_role_all` policy — when adding a new table, run:
  ```sql
  ALTER TABLE x ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "service_role_all" ON x FOR ALL TO service_role USING (true) WITH CHECK (true);
  ```
- NEVER disable RLS on any table — all DB access goes through service_role (Drizzle + SUPABASE_SERVICE_ROLE_KEY); the anon key is auth-only and must never have direct table access
- **MIDDLEWARE RLS EXCEPTION:** `facility_users` and `invites` have an additional scoped `authenticated` SELECT policy so middleware (which uses the anon key / `authenticated` role) can query them:
  - `facility_users` → `user_id = auth.uid()`
  - `invites` → `email = auth.jwt()->>'email'`
  - Without these, middleware queries silently return empty and every user gets redirected to /unauthorized
  - If you add a new table that middleware needs to query, add a scoped `authenticated` SELECT policy for it

### Git
- ALWAYS use `git add -A` — project path has parentheses that break zsh globs
- NEVER commit `.env.local`
- Always run `npx tsc --noEmit` before committing — fix all errors first

### Auth & Roles
- `role 'admin'` — full facility access
- `role 'super_admin'` — franchise owner; scoped to only the facilities in their franchise. **Normalized to `'admin'` by `normalizeRole()` at `getUserFacility()` read time** so all page guards, API guards, and nav filters work uniformly. The Master Admin page/link remains gated by `NEXT_PUBLIC_SUPER_ADMIN_EMAIL` email match (not role).
- `role 'facility_staff'` (Phase 11J.1) — scheduling and resident management; NO billing/payroll/analytics. Sees Calendar / Residents / Daily Log (read-only) / Settings.
- `role 'bookkeeper'` (Phase 11J.1, expanded 2026-05-06) — billing + payroll + analytics + log sheet scanning + booking field edits (service/price/paymentStatus/notes/resident — NOT date/time/stylist/cancel). READ-ONLY on residents. Sees Daily Log (scan + edit booking billing fields) / Billing / Analytics / Payroll / Settings. Home page is `/log` (redirected from `/dashboard`).
- `role 'stylist'` — calendar, daily log (own entries), my account only; no residents, no billing.
- `role 'viewer'` — legacy read-only role. Kept in the type union for backward compat; **no longer offered in the invite picker**.
- Master admin email bypasses all role checks via `NEXT_PUBLIC_SUPER_ADMIN_EMAIL` env var.

**Role helper functions** (`src/lib/get-facility-id.ts`, Phase 11J.1):
- `isAdminOrAbove(role)` → true for `admin`, `super_admin`
- `canAccessBilling(role)` → true for `admin`, `super_admin`, `bookkeeper` (use on `/api/billing/*`, statement send, scan-check, reports, rev-share, bookkeeper export)
- `canAccessPayroll(role)` → true for `admin`, `super_admin`, `bookkeeper` (use on `/api/pay-periods/*`, `/api/quickbooks/*`)
- `isFacilityStaff(role)` → true for `facility_staff` only
- `canScanLogs(role)` → true for `admin`, `super_admin`, `bookkeeper` (use on `/api/log/ocr/*`)
- Use these in route guards instead of bare `role !== 'admin'` whenever bookkeeper or facility_staff should be allowed. Other admin-only routes (services, stylists, invites, applicants, compliance, coverage, availability, super-admin) keep the bare `role !== 'admin'` guard. `/api/log/ocr/*` now uses `canScanLogs` — bookkeeper can scan.

**Server-side page guards** (Phase 11J.1 fix — guards in `page.tsx`, OUTSIDE try/catch):
- `/dashboard` → bookkeeper: redirect('/log') (their home is the daily log for scan corrections)
- `/billing`, `/analytics` → `!canAccessBilling(role)`: redirect('/dashboard')
- `/payroll`, `/payroll/[id]` → `!canAccessPayroll(role)`: redirect('/dashboard')
- `/settings` → `role === 'stylist' || role === 'viewer'`: redirect('/dashboard') — facility_staff + bookkeeper allowed
- `/my-account` → `role !== 'stylist'`: redirect('/dashboard') — stylist-only page
- `/residents/[id]` → `role === 'stylist'`: redirect('/dashboard')
- `/residents/import`, `/services/import`, `/stylists/[id]` → non-admin/facility_staff (or non-admin for the latter two)

**Sidebar nav structure** (`src/components/layout/sidebar.tsx`): four groups — SCHEDULING (Calendar / Residents / Daily Log) / MANAGEMENT (Stylists / Directory / Services) / FINANCIAL (Billing / Analytics / Payroll) / ACCOUNT (My Account, stylist-only). Settings + Master Admin render below a divider, after all groups, always last. The nav label is `Master Admin` and the route is `/master-admin` (Phase 11J.2). A redirect at `/super-admin` handles saved bookmarks.
- Portal routes (`/portal/*`) are PUBLIC — token = auth, no login required
- Invoice routes (`/invoice/*`) are PUBLIC — printable pages
- Franchise system: `franchises` table (id, name, owner_user_id → profiles). `franchise_facilities` join table (franchise_id, facility_id, CASCADE on both). When a franchise is created/updated, `facilityUsers` rows are upserted for the owner with `role='super_admin'` on all franchise facilities

### API Routes
- Every API route must check auth via `Supabase createClient().auth.getUser()`
- Every API route must scope to `facilityId` via `getUserFacility()`
- Return `{ data: ... }` on success, `{ error: "message" }` on failure
- Always wrap DB queries in try/catch — never let a DB error crash a page
- Mutation routes (POST/PUT/DELETE) on shared-state resources (stylists, services, OCR/parse-pdf) MUST add:
  ```ts
  if (facilityUser.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
  ```
  Stylist-role users can only mutate their own bookings/profile
- Every Zod input schema needs `.max()` caps: names 200, room 50, notes/description 2000, email 320, color 20, address 500, cents 10_000_000, tier/option arrays 20, additionalServices 20, timezone 100
- Rate-limit all public or expensive routes via `src/lib/rate-limit.ts` — `checkRateLimit(bucket, identifier)` + `rateLimitResponse(retryAfter)`
  - Buckets: `signup` 5/hr/IP, `portalBook` 10/hr/token, `ocr` 20/hr/user, `parsePdf` 20/hr/user, `sendPortalLink` 10/hr/user, `invites` 30/hr/user, `checkScan` 30/hr/user, `qbInvoiceSync` 3/hr/user (Phase 11M), `coverage` 10/hr/user (Apr 27 audit)
  - No-ops when UPSTASH env vars are unset
- Portal routes (`/api/portal/[token]/*`) MUST use explicit `columns:` whitelists on every `db.query.*` call, and MUST verify every `stylistId`/`serviceId`/`addonServiceIds` belongs to the resident's facility before accepting input
- **`console.log` is dev-time only.** Production routes use `console.error` for errors and (rarely) `console.warn` for unexpected-but-recoverable states. PR reviewers should reject `console.log` in `src/app/api/` and `src/lib/`.
- **Mutation routes that affect a cached tag MUST call `revalidateTag('<tag>', {})` on the success path.** Tags currently in use: `'bookings'`, `'pay-periods'`, `'billing'`, `'facilities'`, `'access-requests'`. Adding `revalidateTag` for a tag that isn't consumed is dead code; only wire it in when the table is actually cached somewhere.
- **Every `req.json()` MUST go through a Zod `safeParse()` schema** — no shape inference from `body.x` field accesses. Schemas live at the top of the route file.
- **Sequential `await db.query.X` calls inside a `page.tsx` or `route.ts` MUST be `Promise.all()`'d** when neither query depends on the other's result (e.g. both filter by the same `facilityId` or `stylistId`).

### Security / Payload Hygiene
- Server → client payloads MUST be sanitized — never expose internal DB columns (cost basis, internal notes, other-facility data, etc.) in API responses
- Use explicit `columns:` selects in Drizzle queries on routes that return data to unauthenticated users
- **HSTS and HTTP→HTTPS redirect are configured in `next.config.ts`** and must not be removed or weakened. `redirects()` fires a 301 when `x-forwarded-proto: http` is present (no-op on Vercel since CDN enforces HTTPS before requests reach Next.js; protects self-hosted environments). `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` — 2-year HSTS with preload flag. The preload flag means the domain is (or will be) submitted to browser preload lists; removing it does not undo preloading.

---

## Sign-Up Sheet (Intake Queue → Stylist Calendar)

**Purpose**: lightweight intake queue for facility staff to log resident appointment requests without picking a time slot. Stylists later convert pending entries into real bookings via the booking modal.

**Schema**: `signup_sheet_entries` table — `id`, `facility_id`, `resident_id` (nullable), `resident_name`/`room_number` (denormalized for display), `service_id` (nullable), `service_name`, `requested_time` (text 'HH:MM' tz-agnostic, nullable), `requested_date` (date), `notes`, `created_by`, `assigned_to_stylist_id`, `status` ('pending'|'scheduled'|'cancelled'), `booking_id` (set on convert), timestamps. Indexes: `(facility_id, requested_date)` and partial `(assigned_to_stylist_id, requested_date) WHERE status='pending'`. RLS `service_role_all`.

**API routes** (under `src/app/api/signup-sheet/`):
- `POST /` — admin/facility_staff create entry; verifies resident+service+stylist scope; auto-fills room from resident if not provided
- `GET /?date=YYYY-MM-DD` — any role at facility; stylists only see entries assigned to them OR unassigned (others see all)
- `PATCH /[id]` — admin/facility_staff edit any field; stylists may PATCH only `notes` on entries assigned to them; rejected once `status='scheduled'`
- `POST /[id]/convert` — admin/facility_staff/stylist; accepts the same body as `POST /api/bookings`; in a single `db.transaction` creates the booking AND marks entry `status='scheduled'`+`booking_id=newId`; fires GCal sync after commit; reuses pricing/conflict logic inline (no shared helper extracted)

**UI surfaces**:
- **Facility-side**: `<SignupSheetPanel>` opened from a "Sign-Up Sheet" button in the dashboard header (admin + facility_staff only). Right-anchored modal on desktop (`md:items-stretch md:justify-end md:pr-6`), bottom sheet on mobile (`rounded-t-3xl`). Top half = form (resident typeahead with inline create, service typeahead — NO inline service create, time, stylist, notes); bottom half = today's queue grouped by stylist with cancel-X buttons.
- **Stylist-side**: `<StylistPendingEntries>` collapsible amber panel above the calendar (and in mobile-stylist mode above the bookings list). Hidden when `entries.length === 0`. Each entry has a Schedule button that opens BookingModal with `prefillResidentId`/`prefillServiceId`/`signupSheetEntryId` props.

**BookingModal integration**: three new optional props — `prefillResidentId`, `prefillServiceId`, `signupSheetEntryId`. When `signupSheetEntryId` is set, the create POST goes to `/api/signup-sheet/[id]/convert` instead of `/api/bookings`. The basePayload always includes `stylistId: pickedStylist.id` when available (the convert endpoint requires stylistId; booking POST treats it as optional).

**Cache tag**: `'signup-sheet'` — busted by all 3 mutation routes (POST, PATCH, convert). `'bookings'` is also busted by convert (since a real booking is created).

**Help tours**: `facility-staff-signup-sheet` (6 steps, action step on `[data-tour="signup-sheet-button"]`) and `stylist-signup-sheet` (4 steps, all info — panel content is conditional UI per the selector-safety rule). `ClipboardList` is the canonical icon (added to `TutorialIcon` union + `ICON_MAP` in `tutorial-card.tsx`).

## UI Consistency Rules

- **Room number must appear wherever a resident is shown**: booking modal selected-state (read-only "Room X" below the resident field), daily log rows (already shown), OCR review (read-only for matched residents who have a room; editable input if matched resident has no room). All new-resident inline forms already have room fields — keep them. When adding a new resident-facing UI surface, include room number.
- **Facility search must be present on all facility list surfaces**: sidebar switcher dropdown (search input above the list), master admin facility grid (search bar above the grid), billing facility combobox (replaces native `<select>` with searchable inline combobox). The mobile facility header and scan-check modal already have search — don't remove it. When adding a new facility list or picker, add the same `name.includes(q) || facilityCode.includes(q)` filter pattern.

## Common Bugs to Avoid

- **NEVER** use `new URL(request.url).origin` for redirects on Vercel — use `request.nextUrl.clone()`
- **NEVER** put `page.tsx` files inside `/app/api/` directories
- **NEVER** set `selectMirror=true` on FullCalendar — causes squish bug
- **NEVER** make Google Calendar sync block a response — always fire-and-forget
- **NEVER** use `position:sticky` inside `overflow:auto` on iOS — use `flexShrink:0` footer instead
- **NEVER** `redirect()` inside try/catch in Next.js pages
- **NEVER** set DB pool max > 1 in session mode
- **NEVER** use Gemini 1.5 or 2.0 model names (1.5 shut down March 2026; 2.0 unavailable to new API users) — always use `gemini-2.5-flash` on `v1beta`
- **NEVER** use the `@google/generative-ai` SDK — it hardcodes old model names; use direct `fetch` to the REST API
- **NEVER** await `sendEmail()` — all email calls fire-and-forget
- **NEVER** use `router.push()` or `router.refresh()` after debug impersonation (`POST /api/debug/impersonate`) or reset (`POST /api/debug/reset`) — these do NOT flush server component state; the new cookie is invisible to SSR. Always use `window.location.href = '/dashboard'` (hard navigation) to ensure the impersonated role is picked up by `getUserFacility()`.
- **NEVER** convert `recharts` named exports to individual `next/dynamic` calls — recharts uses barrel exports and the runtime resolution fails. If bundle size matters, use a single `dynamic(() => import('recharts'), { ssr: false })` wrapper around a chart component, not one-per-export. (The Apr 27 audit reverted exactly this mistake — see commit 6d2c300.)
- **NEVER** name React component functions starting with lowercase (e.g. `function iOS26Mockup()`) — TypeScript and the runtime both treat them as DOM intrinsic elements. Use `IOS26Mockup` or `Ios26Mockup`.
- Long-running API routes (OCR, AI calls) MUST export `export const maxDuration = 60` (or 120 for OCR) and `export const dynamic = 'force-dynamic'` — without `maxDuration`, Vercel cuts the function at 10s
- Next.js 16 async params — always `{ params: Promise<{id: string}> }`
- `revalidateTag` in Next.js 16 takes TWO args — `revalidateTag('bookings', {})` not `revalidateTag('bookings')`
- **Date parsing:** Use `new Date(d + 'T00:00:00')` (appending local time) — avoid `new Date('YYYY-MM-DD')` which is UTC-midnight and shifts back one day in negative-UTC-offset timezones
- **Time display MUST use facility timezone, not browser timezone (Phase 12F).** NEVER use `Date.prototype.getHours()` / `.getMinutes()` / `.getDate()` / `.getDay()` for display logic — they resolve to browser-local. NEVER call `toLocaleTimeString` / `toLocaleDateString` without an explicit `timeZone` option. Use `getLocalParts(date, facility.timezone)`, `formatTimeInTz`, `formatDateInTz` from `src/lib/time.ts`. The canonical `formatTime` / `formatDate` in `src/lib/utils.ts` accept an optional `timezone` argument — pass `facility.timezone` at every call site. **`<FullCalendar timeZone={facility.timezone} />` plus `intlTzPlugin` from `src/lib/fullcalendar-tz-plugin.ts` is the calendar grid contract** — the `timeZone` prop alone only fixes axis labels; event block *positioning* requires the custom `NamedTimeZoneImpl` plugin (registered via `namedTimeZonedImpl` — note the typo in FullCalendar's PluginDefInput). NEVER remove `intlTzPlugin` from the calendar plugins array. For booking-modal `<input type="datetime-local">`, populate via `toDateTimeLocalInTz` and convert the submitted string via `fromDateTimeLocalInTz` so the round-trip preserves the original UTC instant regardless of viewer tz.
- **Dashboard Services panel** — NEVER use `formatCents(service.priceCents)` in `services-panel.tsx`; always use `formatPricingLabel(service)` from `src/lib/pricing.ts`. The panel receives a pre-sorted list from `dashboard-client.tsx` (sorted via `service-sort.ts` helpers respecting `facility.serviceCategoryOrder`) — do not sort inside the panel itself
- **NEVER add `tip_cents` to a `price_cents` SUM** — tips are stylist comp, not facility revenue. Every revenue/billing/report aggregation must filter to `priceCents` only. The 9 known SUM sites carry an inline guard comment; new SUM sites MUST add the same. Phase 12E rule.
- **App icons / favicon** — icon files are generated from `/public/Seniorstylistlogo.jpg` using `scripts/generate-icons.ts` (requires `sharp`). Run `npx ts-node --esm scripts/generate-icons.ts` to regenerate all sizes (16×16, 32×32, 180×180, 192×192, 512×512 PNGs). Uses `fit: 'contain'` + `#1C0A12` background + ~12% padding so the full wordmark is centered. Outputs: `public/favicon-16x16.png`, `public/favicon-32x32.png`, `public/apple-touch-icon.png`, `public/icon-192.png`, `public/icon-512.png`. Generated PNGs MUST be committed to git — Vercel does not run the script at build time. `layout.tsx` `metadata.icons` and `public/manifest.json` reference these files. **NEVER use SVG-only favicons** for PWA icons — iOS and Android require rasterized PNGs; SVG `src/app/icon.svg` shows as a tiny corner on black in PWA mode.
- **Help Center / Driver.js tours (Phase 12 + 12H rewrite)** — guided tours are navigation-aware: each `TourStep` declares a `route`, and the engine hard-navs (`window.location.href`) when the user is on the wrong page. State persists across hard reloads via `sessionStorage['helpTour'] = { tourId, stepIndex, expiresAt }` (5-minute TTL). The `<TourResumer />` client component mounted inside `ToastProvider` in `(protected)/layout.tsx` reads sessionStorage on mount and resumes via `resumePendingTour()`. **Each step is one of**: `isAction: true` (Next button hidden, one-time click listener attached to highlighted element auto-advances) OR `isAction: false` (informational, Next button shown). Steps with `element: ''` render a popover anchored to `body` (terminal "you're done" steps). Element resolution: `[data-tour="X"]` for desktop and shared elements, `[data-tour-mobile="X"]` for mobile-only elements (mobile-nav tabs, mobile-only buttons in `log-client.tsx`). The `resolveQuery()` helper auto-maps to `data-tour-mobile` on mobile breakpoint. `waitForElement(selector, 5000ms)` polls via `requestAnimationFrame`; on timeout the engine emits a CustomEvent that the TourResumer pipes through `useToast().error()` ("Couldn't find that element — the app may have changed") and skips to the next step. **Desktop-only tours**: tour definitions can carry `desktopOnly: true` (used for `master-add-facility` only — references Master-Admin nav link hidden on mobile). `admin-compliance` had `desktopOnly` removed in Phase 12L — it now uses `route: '/stylists', element: ''` info steps instead of a sidebar action step. On mobile, `startTour` toasts "This tour is best viewed on a larger screen" and exits early. Tour buttons use burgundy `#8B2E4A` (NEVER teal). `driver.js` is dynamic-imported inside `startTour()` so it stays out of the global bundle. CSS overrides for `.senior-stylist-tour` popover live at the bottom of `globals.css`. **All 27 tours implemented**: stylist-getting-started, stylist-calendar, stylist-daily-log, stylist-residents, stylist-finalize-day, stylist-my-account, stylist-signup-sheet, staff-getting-started, facility-staff-scheduling, facility-staff-residents, staff-daily-log, facility-staff-signup-sheet, admin-getting-started, admin-facility-setup, admin-inviting-staff, admin-residents, admin-reports, admin-family-portal, admin-compliance, bookkeeper-getting-started, bookkeeper-billing-dashboard, bookkeeper-scan-logs, bookkeeper-manual-entry, bookkeeper-duplicates, bookkeeper-payroll, master-add-facility, master-quickbooks-setup. (`bookkeeper-quickbooks` remains `tourId: null` — Coming Soon, pending Intuit production approval.) (Phase 12I added `stylist-my-account`; Phase 12K added `staff-getting-started` + `staff-daily-log` and rewrote `facility-staff-scheduling` + `facility-staff-residents`; Phase 12L added `admin-getting-started` and rewrote 6 admin tours; Phase 12M added `bookkeeper-getting-started` + `bookkeeper-manual-entry` and rewrote 4 bookkeeper tours.) **`profiles.has_seen_onboarding_tour`** (boolean default false NOT NULL) drives the first-login welcome modal — flag flips via `POST /api/profile/onboarding-seen`. **`<HelpTip tourId label description />`** in `src/components/ui/help-tip.tsx` is the canonical contextual `?` icon — desktop opens click-outside popover, mobile opens existing `<BottomSheet>`. Currently injected at: daily log date header, dashboard calendar header, residents new-button, billing Outstanding tile, settings Working Hours, settings QuickBooks header. **Modal component** (`src/components/ui/modal.tsx`) accepts `data-*` prop pass-through via index signature `[dataAttr: \`data-${string}\`]: ...` so booking-modal and other modal callers can tag the outer card directly.
- **PWA install guide** — iOS 26 Safari no longer has a share icon in the bottom toolbar. The correct flow is: tap ⋯ (three dots) on the RIGHT of the floating pill address bar → tap Share in the popup menu → tap "Add to Home Screen" → leave "Open as Web App" ON → tap Add. `iOSUIVariant` values are `'ios26+'`, `'ios16-18'`, `'ios-old'`, `'ios-unknown'` — never use `'ios15'`. `detectAndroidBrowser()` returns `'android-chrome' | 'android-samsung' | 'android-firefox' | 'android-edge' | 'android-other'`.

---

## Design System Rules

### Brand Colors (CURRENT — Burgundy Migration Complete)
- **Primary:** `#8B2E4A` (burgundy) — use everywhere; do NOT add new teal `#0D7377` anywhere in the app
- **Sidebar background:** `--color-sidebar: #1C0A12` (very dark burgundy) — defined in `globals.css`, used via `style={{ backgroundColor: 'var(--color-sidebar)' }}` in `sidebar.tsx`; do NOT use `#0D2B2E`
- `--color-primary` CSS variable in `globals.css` = `#8B2E4A` — affects FullCalendar toolbar buttons only
- Tinted backgrounds: `bg-rose-50`, borders: `border-rose-100/200`, focus rings: `focus:ring-rose-100`, checkboxes: `accent-[#8B2E4A]`
- Exception: `completed` status badges remain `bg-teal-50 text-teal-700` (intentional semantic color)

### Logo
- File: `/public/Seniorstylistlogo.jpg` — use `<Image>` from `next/image`
- **Sidebar:** wrap in `<Link href="/dashboard">`, apply `style={{ filter: 'brightness(0) invert(1)' }}` (white on dark sidebar)
- **Portal header:** same `filter: brightness(0) invert(1)` (white on `#8B2E4A`)
- **White-background pages** (login, invite-accept, unauthorized): show naturally, no filter

### Typography & Layout
- Fonts: DM Serif Display (headings), DM Sans (body)
- **DM Serif Display `<h1>` uses `font-normal`** — `font-bold` crushes the serif's counters. Leave `<h2>`/`<h3>` untouched (DM Sans, benefits from bold).
- Bottom sheets on mobile, modals on desktop
- All bottom sheets: fixed overlay → flex-col → justify-end structure
- Footer/save buttons ALWAYS outside scroll area (`flexShrink: 0`)
- `viewport-fit=cover` required in `layout.tsx` for iPhone safe areas
- **Mobile safe area:** Any `fixed` element near the bottom MUST use `style={{ bottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}` — mobile nav bar is ~72px tall; this clears both it and the home indicator. Remove any Tailwind `bottom-N` class from the same element. Applies to: floating action bars, FABs, scan buttons, multi-select bars.
- Portal layout header: `style={{ backgroundColor: '#8B2E4A' }}` with inline floral SVG rose accent (`rgba(255,255,255,0.15)` stroke, `80×96px`, positioned absolute top-right)
- Skeleton loaders use `.skeleton` (preferred, lighter) or `.skeleton-shimmer` class — NOT `animate-pulse bg-stone-100`. See "Motion & Interaction System" below.

### UI Polish v2 (2026-04-23) — house style
- **Shadow tokens** (`globals.css`): `--shadow-sm/md/lg` — use via `shadow-[var(--shadow-*)]`, do NOT roll custom shadows inline. `--color-panel-bg: #FDFCFB` for side-panel backgrounds.
- **TopBar is desktop-only** (`hidden md:flex`) and lives inside `<main>` as `shrink-0`. Main content wraps children in `flex-1 min-h-0 overflow-auto` so nested `h-full` layouts (dashboard) work. The `.main-content` class (mobile nav padding) sits on the inner scroll container, not the outer `<main>`.
- **New Booking button** in TopBar → `router.push('/dashboard?new=1')`. Dashboard reads `?new=1` via `useSearchParams()` in a `useEffect`, opens `NewBookingModal`, then strips the param via `router.replace('/dashboard')`.
- **Sidebar sections:** nav items are grouped under SCHEDULING / MANAGEMENT / ANALYTICS labels. Active pill: `bg-[#8B2E4A]/30 text-white font-semibold shadow-inner` + icon `text-[#E8A0B0]`. Radial gradient overlay at top-left.
- **Table chrome house style:** `rounded-[18px]` outer wrapper + `shadow-[var(--shadow-sm)]`, header bg `bg-stone-50/60` with `text-[11px] text-stone-400 uppercase tracking-wide` columns, row hover `hover:bg-[#F9EFF2]` (soft burgundy blush). Apply to all CSS-Grid-based "tables".
- **Persistent amber row tint** (`bg-amber-50/40 hover:bg-amber-50/70`) signals a facility/resident with outstanding balance — overrides the default blush hover. **Reserved for billing surfaces only** — never use amber tint elsewhere.
- **Primary Button:** carries `shadow-[0_2px_6px_rgba(139,46,74,0.22)]` + `hover:-translate-y-[1px]` + `hover:shadow-[0_4px_10px_rgba(139,46,74,0.28)]`. `disabled:shadow-none disabled:translate-y-0` neutralizes the lift when inert.
- **Badges** are fully rounded capsules: `rounded-full px-2.5 py-0.5`. Hardcoded badge-like pills (sort toggles, facility chips) should match this shape.
- **Underline `pnav` tab pattern** is the new design-system standard for page-level tab navigation — active state is a `#8B2E4A` underline bar via `after:`. Existing pill-style tabs are NOT migrated in this pass; use the underline pattern for any new tab surface going forward.
- **Today gradient card** lives at the TOP of the dashboard right panel (admin-only), ABOVE "Who's Working Today" — it prepends, it doesn't replace. 2×2 stat grid inside uses frosted-glass tiles (`bg-white/10 backdrop-blur-sm`).

### Motion & Interaction System (2026-04-24)
- **Motion tokens** in `globals.css`: `--ease-out` / `--ease-spring` / `--ease-in-out`, `--duration-fast` (100ms) / `--duration-base` (160ms) / `--duration-slow` (260ms). `--shadow-xl` + surface tokens (`--surface-base/card/raised/sunken`).
- **Global interaction baseline**: `button, [role="button"], a` carry a transition baseline on background/border/color/shadow/transform/opacity. `:active` scales to `0.97` with a 60ms duration. Do not add ad-hoc `transition` classes unless you need non-default properties.
- **Button** (`src/components/ui/button.tsx`) carries a `focus-visible:ring-2 focus-visible:ring-[#8B2E4A]/30 focus-visible:ring-offset-2` keyboard ring. Primary hover lift is `-translate-y-[1.5px]` with `shadow-[0_6px_16px_rgba(139,46,74,0.32)]`; `active:shadow-none` collapses the lift on press. Ghost buttons add `active:scale-[0.95]` for a stronger press.
- **Card hover lift** (`cardHover` in `src/lib/animations.ts`): `transition-[transform,box-shadow] duration-[160ms] ease-[cubic-bezier(0.25,0.46,0.45,0.94)] hover:-translate-y-[2px] hover:shadow-[var(--shadow-md)]`. Apply to standalone clickable cards; NEVER apply to list rows (use blush row-hover instead).
- **Table row timing**: rows use `transition-colors duration-[120ms] ease-out` for the blush hover sweep. Applied across residents/stylists/payroll/billing/cross-facility report tables.
- **Skeleton loaders**: use `<Skeleton>` / `<SkeletonResidentRow>` / `<SkeletonBookingCard>` / `<SkeletonStatCard>` from `src/components/ui/skeleton.tsx`, which uses the lighter `.skeleton` class (1.4s shimmer loop). `.skeleton-shimmer` remains for existing usages; prefer `.skeleton` for new ad-hoc shapes.
- **Toast notifications**: `useToast()` from `src/components/ui/toast.tsx` — method API `toast.success('…')`, `toast.error('…')`, `toast.info('…')`, `toast.loading('…')`. The legacy `toast('msg', 'success')` form still works. **Error and loading variants do NOT auto-dismiss** (only on X click). Success/info auto-dismiss at 3500ms. Visual: white bg + colored border + colored icon + `shadow-[var(--shadow-lg)]`. NEVER use `alert()` or raw error divs.
- **Empty states**: use `<EmptyState>` from `src/components/ui/empty-state.tsx` — icon (20×20 SVG) + title + optional description + optional CTA. Don't render bare "No X yet" text on primary surfaces.
- **Page-level mount animation**: add `className="page-enter"` (prefix, preserve existing classes) to the outermost div of each page client. Dashboard is excluded by design.
- **Focus ring standard** across inputs/selects/textareas: `focus:ring-2 focus:ring-[#8B2E4A]/20`. Wrapper components (`<Input>`/`<Select>`/`<NativeSelect>`) also use `focus:border-[#8B2E4A]/50`. Do NOT use `focus:ring-rose-100` (migrated) or `focus:ring-[#8B2E4A]/30` (migrated).
- **Search-input glow**: primary search inputs (residents, daily log resident search, stylist/applicant directory) carry `focus:shadow-[0_0_0_3px_rgba(139,46,74,0.08)]` — a soft burgundy halo.
- **`.balance-attention` pulse class** is reserved for **outstanding-balance dollar figures in billing views only** (`ip-view.tsx` and `rfms-view.tsx`, applied conditionally when `outstandingCents > 0`). Never apply it anywhere else.
- **Reduced motion**: `@media (prefers-reduced-motion: reduce)` in globals.css collapses animation/transition durations to 0.01ms globally — all new motion must respect this.
- **Sidebar active pill**: the nav `<Link>` uses `transition-colors duration-150 ease-out` and the icon span carries `transition-colors duration-150` so the active state crossfades rather than snapping. No framer-motion dependency — CSS-only.

### List Row Standards (2026-04-24)
- **Avatar:** `size='md'` (36px, `w-9 h-9`) on every list/panel row. Auto-tints per-letter via `getAvatarColor()` in `src/lib/avatar-colors.ts` — do NOT hardcode a single color (rose-50 uniform was retired). Stylist rows pass `color={stylist.color}` to override with calendar color.
- **Name text:** `text-[13.5px] font-semibold text-stone-900 leading-snug`.
- **Sub-text:** `text-[11.5px] text-stone-500 leading-snug mt-0.5`.
- **Row padding:** `py-3.5` minimum. `px-4` in panels, `px-5` in full-page tables.
- **Status/facility chips:** `text-[10.5px] font-semibold px-2.5 py-1 rounded-full`. Do NOT use `text-[9px]` or `text-[10px]` sizing on chips anymore.
- **Row hover:** `hover:bg-[#F9EFF2] transition-colors duration-[120ms]`. Amber outstanding-balance tint remains an exception (billing only).
- **Chevrons:** do NOT append `›` to list rows — the hover state already communicates interactivity. Disclosure-indicator chevrons (expand/collapse, accordion) are unaffected.
- **Residents list mobile layout:** uses `flex` card-per-row (not `grid-cols` table) below `md`. Names never truncate on mobile — allow 2-line wrap via `break-words`. POA moves to the subtitle line (`Room N · POA on file`). Avatar bumps to 40px (`className="!w-10 !h-10"` override on `size='md'`). Last service renders as short date (`Apr 24`) or a `New` chip — never "Never" or `—`. `Total Spent` column is hidden on mobile via `md:hidden`/`hidden md:block` branching. Sticky single-letter section headers appear only when sort is `name asc`. Avatar colors hashed by name `charCode % 6`.

### File Structure Conventions
- Server components in `page.tsx`, client logic in `[name]-client.tsx`
- Shared utilities in `src/lib/utils.ts`
- All types in `src/types/index.ts`
- DB queries scoped via `src/lib/get-facility-id.ts`
- `(public)` route group (`src/app/(public)/`) — auth-free pages (Privacy Policy, Terms of Service); uses minimal layout with burgundy header, `max-w-3xl mx-auto` prose body, no sidebar/mobile nav/auth check

---

## Feature-Specific Rules

### Bookings
- PUT `/api/bookings/[id]` accepts `priceCents` directly in `updateSchema` — direct override takes precedence over service-change priceCents
- Stylist ownership guard: stylists can only edit their own bookings (checked via `profiles.stylistId` match)
- Edit mode shows $ price input + notes textarea. Stylist role: only sees edit button on own bookings (gated by `stylistFilter`)
- Mobile nav prefetch: `<Link prefetch={true}>` on all nav links in `mobile-nav.tsx` and `sidebar.tsx`; `mobile-nav.tsx` also has `pendingHref` state — set on click for immediate tab highlight, cleared on pathname change
- **Admin booking modal is date-driven (2026-04-25)** — `stylistId` is auto-assigned via `resolveAvailableStylists()` + `pickStylistWithLeastLoad()` (the same helpers the resident portal uses). The modal previews the picked stylist read-only via `GET /api/stylists/available?facilityId=…&startTime=…&endTime=…`. The `<select>` dropdown for stylist is GONE — never re-add it. `POST /api/bookings` and `POST /api/bookings/recurring` accept `stylistId` as optional; on omit they auto-resolve, returning 409 (single) or `skipped: [{date, reason}]` (recurring) when no stylist is on schedule. `BookingModal` requires a `facilityId: string` prop (not a `stylists` array)
- **Sidebar facility switcher is admin-only** — `showSwitcher = allFacilities.length > 1 && role === 'admin'` (`sidebar.tsx:229`). The fallback "+ Add facility" link below the logo is also gated on `role === 'admin'` (line 340 region). Stylists must never see facility-switching or facility-creation UI even if they belong to multiple facilities

### Dashboard right panel layout (2026-05-06 — simplified)
- **`react-resizable-panels` was removed (2026-05-06).** The right panel is now a simple `flex-col h-full` with three zones: pinned top, scrollable middle, pinned bottom. **NEVER re-add PanelGroup/PanelResizeHandle to this component** — the drag handle caused layout bugs and content cutoff.
- **Structure** (`dashboard-client.tsx` right panel, lines ~696+):
  1. **Pinned top** (admin-only `{isAdmin && <> ... </>}`) — `TodayCard` (fixed `size="medium"`), compact "Who's Working Today" strip, Coverage Queue (capped `max-h-[160px]`)
  2. **Scrollable middle** — `<div className="flex-1 min-h-0 overflow-hidden">` wrapping `bottomZoneContent` (tabs + list)
  3. **Pinned bottom** — `shrink-0` stats tiles (This Week / This Month for admin, Today count for non-admin)
- `TodayCard` is always rendered at `size="medium"` — no adaptive `ResizeObserver` or `todayCardSize` state. The 2×2 stat grid lives in the bottom stats tiles, not TodayCard.
- Who's Working strip is compact: `text-[10px]` header label, flex-wrap row of `[colored dot] FirstName` pairs (first name only via `s.name.split(' ')[0]`). Tomorrow stylists on a single truncated line.
- `bottomZoneContent` uses `h-full flex flex-col` internally — works correctly inside `flex-1 min-h-0 overflow-hidden`.
- `overscrollBehavior: 'contain'` + `scroll-smooth` on `bottomZoneContent`'s outer div prevent scroll bubbling.

### OCR / Gemini
- Call Gemini REST API **directly via `fetch`** to `v1beta` endpoint — do NOT use the `@google/generative-ai` SDK
- Model: `gemini-2.5-flash` — the current stable production model
- Gemini REST API uses **camelCase** field names — `inlineData`, `mimeType` — NEVER snake_case (API silently ignores unknown fields)
- `systemInstruction` is NOT supported as a top-level field — fold the system prompt into the text part instead
- Supported MIME types: `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`, PDF — HEIC supported natively, no transcoding needed
- Enforce MIME allowlist + 10MB cap on both storage bucket policy AND in the `scan-check` route
- `maxDuration = 120`; per-file `Promise.race` timeout = 90s
- OCR log import (`POST /api/log/ocr`): accepts multipart `images[]` + optional `servicesJson`. Client batches into chunks of 3 with sequential POSTs
- OCR import route (`POST /api/log/ocr/import`): creates residents, services, and bookings inside a single `db.transaction()`. Status: `completed`, spaced 30 min apart from 09:00 UTC. Uses **3-step resolution** before inserting: (1) use provided UUID if given, (2) check in-memory `residentMap`/`serviceMap`, (3) fuzzy-match existing DB records with `fuzzyScore() >= 0.8`
- **`src/lib/fuzzy.ts` is the canonical fuzzy-match module** — exports `WORD_EXPANSIONS`, `STOP_WORDS`, `normalizeWords`, `fuzzyScore`, `fuzzyMatches`, `fuzzyBestMatch`. Do NOT re-implement inline
- **`STOP_WORDS`** strips 'llc', 'inc', 'corp', 'dba', 'snf', 'rfms', 'petty', 'cash', 'account', 'operating', 'disbursement', 'at', 'of', 'the', 'and' from all fuzzy comparisons. `normalizeWords` also strips `#` before numbers
- **`qb_unresolved_payments` is the only persistence path for OCR-failed documents** — never silently drop a scan

### Check Scanning (`scan-check` route)
- Uses the same direct-fetch Gemini pattern as daily-log OCR — v1beta, `gemini-2.5-flash`, `inlineData`+`text` only, no `systemInstruction`, no SDK. Do NOT abstract into a shared helper — OCR prompts diverge per surface
- **`check-images` bucket is PRIVATE** — always upload via service-role (`createStorageClient()`). Store the PATH (not a URL) in `qb_payments.check_image_url`. Regenerate signed URLs (1-hour TTL via `storage.createSignedUrl(path, 3600)`) at read time. Never cache URLs client-side beyond their 1-hour window
- **Facility matching order**: invoiceRef code → exact name → fuzzy name → word-fragment pass → payer address. `isOurAddress` guard skips steps 2–4 when payer address = "2833 smith ave" (our mailing address, not a facility)
- **Word-fragment pass (single loop)**: ≥2 shared normalized words → 'medium'; OR any single shared word ≥6 chars (unique proper nouns like "Layhill", "Brightview", "Presbyterian") → 'medium'. Both use the same `bestHit` variable — one loop, one `if (overlap > bestOverlap || (overlap === 1 && hasLongShared && !bestHit))` condition
- **Resident lines are ALWAYS mapped** from `parsed.residentLines` regardless of facility match. When facility is unmatched, lines return with `residentId: null, matchConfidence: 'none'` so the confirmation UI can show them for manual assignment. DB resident query is only made when facility IS matched
- **Total-accuracy invariant**: `residentLinesSum === amountCents` must be true before save. Cash is a SEPARATE additive payment row — it is NOT part of the invariant. Modal "Record Payment" is gated on this; save route re-checks server-side and 400s if violated
- **`resident_breakdown` has two shapes**: `ResidentBreakdownLine[]` (RFMS petty cash / IP hybrid) OR `{ type: 'remittance_lines', lines: [{ref, invoiceDate, amountCents}] }` (RFMS remittance slips). Discriminate with `!Array.isArray(bd) && (bd as {type?:string}).type === 'remittance_lines'`. Never assume it is always an array
- **`invoiceLines` in `ScanResult`**: populated for `RFMS_REMITTANCE_SLIP` only; always `[]` for other types. Entries: `{ ref, invoiceDate, amountCents, confidence }`. Stored as `{ type: 'remittance_lines', lines }` in `resident_breakdown`. Auto-memo generated from invoice dates + check number when no memo provided
- **Total-accuracy invariant for remittance**: when `documentType === 'RFMS_REMITTANCE_SLIP'` and `invoiceLines.length > 0`, the invariant uses `invoiceLines.reduce(sum)` instead of `editLines.reduce(sum)`
- **Cash annotation detection**: Gemini prompt includes `cashAlsoReceivedCents` field — detects handwritten "+440 Cash" / "+$440 cash" annotations anywhere on the document. When `value != null`, modal auto-enables the cash checkbox and pre-fills the amount. Field always returned (never omitted); `null` value = not found
- **Resident-name facility inference**: when all 5 facility passes fail AND ≥2 resident lines exist, the route fetches ALL active residents (no facility scope, columns: id/name/facilityId/roomNumber) and fuzzy-matches each line at threshold **0.55** (lowered from 0.65 in Round 4). The inference loop calls `normalizeResidentName(rawName)` to generate both the original and swapped "first last" candidates for comma-format names (e.g. "LEMPGES, CLAUDE" → also tries "claude lempges"). Facility with ≥2 hits AND ≥50% of lines AND no tie wins with confidence 'medium'. The pre-fetched list is reused in the resident matching step (filter rather than re-query). Response gains `inferredFromResidents: boolean` + `residentMatchCount: number` on the `facilityMatch` object
- **`normalizeResidentName` helper** (in `scan-check/route.ts`): converts Gemini's "LAST, FIRST" comma format into `[original_lowercase, "first last"]` candidates. Splits on comma BEFORE stripping punctuation so the swap is meaningful. Single-form names return a one-element array. NOT in `fuzzy.ts` — it's scan-domain-specific.
- **`scan_corrections` table** — few-shot learning for Gemini. Rows inserted in `save-check-payment` transaction (step 9) when user edits Gemini-extracted field values before saving. Before the Gemini call in `scan-check`, last 10 corrections for the facility are fetched and injected into the prompt via `buildFewShotBlock()` (deduped by fieldName, max 5 lines).
- **`FacilityMatch` inference fields** — `inferenceAttempted: boolean` (true when ≥2 resident lines existed and facility was unmatched at inference entry) and `inferenceResidentCount: number` (total non-empty lines tried). Modal shows amber "Could not auto-match from N resident names" when `inferenceAttempted && !inferredFromResidents`.
- **Payment total row** — always rendered in scan modal confirm step above buttons: "Check: $X = Total Received: $X"; when `cashEnabled && cashCents > 0`: adds cash term and shows total in burgundy.
- **`facilities.rev_share_percentage`** — nullable integer column. Populated via `POST /api/super-admin/import-facilities-csv` (master admin only, matches by `facilityCode` col[1] via `Map`, always-overwrite). `contactEmail` is fill-if-null only.
- **`import-facilities-csv` route uses fixed column positions** — col[0]=notes, col[1]=F-code (`/^F\d{2,4}$/`), col[2]=priority, col[3]=NAME, col[4]=billing type, col[5]=rev share %, col[6]=contact email, col[8]=phone, col[9]=address. Matches by `facilityCode` exact key lookup (`Map<string, facility>`) NOT fuzzy name. Name fills if `!match.name || match.name.trim() === ''`. Email fills if null (regex extract from col[6]). Phone/address always overwrite. `mapBillingType()` maps: IP+F→hybrid, IP/IPM/IP*→ip, F/NB/SC/F*→rfms. Returns `namesFilled` in addition to other counts. No junk-row filter — `F_CODE_RE` is sufficient guard.
- **Check image lightbox** (scan-check-modal.tsx) — `lightboxOpen` state, reset in `resetEditState()`. Image wrapped in `<button className="cursor-zoom-in">`. Lightbox is `z-[60] fixed inset-0 bg-black/90` rendered as sibling to `<Modal>` — the component return MUST be wrapped in `<>...</>` fragment. Click backdrop closes; `e.stopPropagation()` on inner `<img>` prevents accidental dismiss.
- **`requiresResidentMatch` in modal**: `result?.documentType !== 'RFMS_REMITTANCE_SLIP'`. When false, "Record Payment" is enabled even with unmatched resident lines (remittance slips are facility-level records)
- **ResidentCombobox** (in `scan-check-modal.tsx`): searchable combobox replacing `<select>` in resident lines. Owns its own `open` state. When `disabled` (no facility selected or loading), renders a non-interactive placeholder `"Select facility first"`. `useEffect` keyed on `selectedFacilityId` fetches `/api/residents?facilityId=X`, resets line matches via `clearLineMatches()`, cleans up with `AbortController`. `GET /api/residents?facilityId=X` supports master admin (any facility) and admin (own facility only, 403 otherwise); returns minimal columns (id/name/roomNumber) when param present
- **Save route returns** `{ data: { paymentIds: string[], updatedBalanceCents: number } }` — `paymentIds` enables future linking back to scanned check images; `updatedBalanceCents` drives optimistic UI updates
- **`qb_unresolved_payments` migration was ADDITIVE** — original Phase 11A scaffolding columns are preserved and marked `// @deprecated 11A scaffolding, unused` in `schema.ts`. Do not remove them without a separate migration; they are nullable and harmless

### Coverage
- Coverage is a **DATE RANGE**: `start_date` + `end_date` (CHECK `end_date >= start_date`) — overlap-based duplicate-open rejects use `new.start ≤ existing.end AND new.end ≥ existing.start`
- Substitute picker has two groups: facility pool (facility stylists with DoW availability) + franchise pool (`facilityId IS NULL AND franchiseId = caller's franchise`, active)
- `GET /api/coverage/substitutes?date=YYYY-MM-DD` (admin-only) returns both groups

### Resident Portal
- `/available-times` returns only `availableSlots` (slots with ≥1 candidate)
- `/available-days?month=` drives the date picker's greyed-out days
- Both are public (token auth), rate-limited under `portalBook` bucket
- Portal returns 409 when zero candidates

### Stylist Import / Bulk Operations
- Import cap: 200 rows (lighter than residents/services at 500)
- Import facility default is franchise pool (`resolvedFacilityId = null`) — only sets a specific `facilityId` when `facilityName` column fuzzy-matches a franchise facility
- `POST /api/stylists/bulk-delete` — soft-delete only (`active: false`), max 200 UUIDs, verifies franchise scope
- `POST /api/stylists/bulk-update` — exactly one of `status`/`facilityId`/`commissionPercent` must be provided (enforced by Zod `.refine`), verifies franchise scope

### Billing / QuickBooks
- `formatDollars`: `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })` singleton in `billing-shared.tsx` — all money values use this
- **Invoice decrement is EXACT-MATCH ONLY** — only when `invoiceMatchConfidence === 'high'` AND `matchedInvoiceIds.length > 0` do we zero out matched invoices. `partial` and `none` leave invoices untouched
- Cross-facility drill-down panel: `CrossFacilityPanel` `type='unresolved'` has no "View Full Report →" footer link
- `cross-facility-report-client.tsx` has local `ReportPanelType = Exclude<PanelType, 'unresolved'>` — the four drill-down report pages cannot be `'unresolved'`
- Unresolved banner: `bg-amber-50 border-amber-200`, shown when `unresolvedCount > 0`; scoped to facility for admins, to currently-selected facility for master admin
- Cross-facility grid is `md:grid-cols-5` on master views, `md:grid-cols-4` otherwise
- **Expandable check detail in `rfms-view.tsx`**: Check # cell is a dotted-underline button when `residentBreakdown.type === 'remittance_lines'`. Click toggles an inline expand row (`expandTransition` from `@/lib/animations`) showing ref/date/amount per line + total (emerald when matches `amountCents`, amber otherwise). Only one row expanded at a time (`expandedCheckId` state)
- **Cross-facility drill-down pages** (`/billing/{outstanding,collected,invoiced,overdue}`) — master-admin-only; each `page.tsx` redirects non-masters to `/billing` BEFORE try/catch. CSV export is client-side only (`Blob` + `URL.createObjectURL`); reflects current sort. Row click → `router.push('/billing?facility=' + id)`
- **`GET /api/billing/cross-facility-detail?type=...`** rows accessed as iterable (`rows[0]`) — the project's `postgres` driver does NOT return `.rows`. Always `Number(row.value_cents)` to normalize postgres `bigint` (returned as string)
- **Revenue share toggle lives in Settings → Billing & Payments** (Phase 11J.3). The `/billing` page only renders a one-line read-only summary linking to `/settings?section=billing`. Do NOT re-add the toggle to `billing-client.tsx`.
- **`bookings.active` (Phase 12C)** — boolean default true. **Distinct from `status='cancelled'`**: `active=false` is set by the import-rollback flow only (whole-batch via `DELETE /api/super-admin/import-batches/[batchId]`, or per-booking via `DELETE /api/super-admin/import-bookings/[bookingId]`). User-cancelled bookings continue to use `status='cancelled'`. The reconciliation queue, calendar (`/api/bookings`), daily log, and monthly report all filter `eq(bookings.active, true)`. **Every booking-listing query MUST include `eq(bookings.active, true)`** — omitting it causes rolled-back imports to appear in the UI (residents showed 4× in daily log when `GET /api/log` was missing the filter). Known required sites: `GET /api/bookings`, `GET /api/log`, `residents/[id]/page.tsx`, `master-admin/imports/page.tsx`, `import-service-log` dedup query. When adding a new booking query, add the filter unconditionally.
- **Reconciliation queue routes (Phase 12C)**: `GET /api/super-admin/import-review` returns needs_review bookings + per-booking top-3 service suggestions + full per-facility service list (so the linker UI works without a dedicated master-admin services endpoint). `POST /api/super-admin/import-review/resolve` takes a Zod discriminated union body keyed on `action: 'link' | 'create' | 'keep'`. `'create'` inserts a new service (`pricingType='fixed', durationMinutes=30`) inside a transaction. `'keep'` flips `needsReview=false` only — `serviceId` stays null and the booking remains a permanent historical record. `'link'` validates the chosen serviceId belongs to the booking's facility (cross-facility leak guard).
- **Sidebar amber badge for needs_review** (Phase 12C, patched 12C-hotfix): `<NeedsReviewBadge />` (`src/components/layout/needs-review-badge.tsx`) is a lazy client component imported directly in `sidebar.tsx`. It fetches `GET /api/super-admin/import-review/count` via `useEffect` — no count query in the server layout. The badge renders null until the fetch resolves (no hydration flash). **Never move a sidebar badge back into `layout.tsx`** — it blocks every page render for master admin. The `/count` endpoint is 403'd for non-master users. `bookings_needs_review_idx` partial index is `WHERE needs_review = true AND active = true` (both conditions required — the count query filters on both).
- **`import_batches` table (Phase 12B)** — audit row per import (one of `'service_log' | 'qb_billing' | 'qb_customer' | 'facility_csv'`). Columns: `facilityId` NOT NULL, `stylistId` nullable, `uploadedBy` NOT NULL → profiles, `fileName`, `sourceType`, `rowCount/matchedCount/unresolvedCount`, `createdAt`, `deletedAt` (nullable, soft-delete for 12C rollback). RLS enabled with `service_role_all`. The `/master-admin/imports` hub queries this table grouped by source_type for "last imported" + total count cards.
- **`bookings.serviceId` is NULLABLE since Phase 12B** (was NOT NULL). Historical-import bookings start with `service_id = null` when no resolved service, and a `serviceIds: []` array. Defensive access pattern: `b.priceCents ?? b.service?.priceCents ?? 0` and `b.service?.name ?? b.rawServiceName ?? 'Unknown service'`. NEVER deference `b.service.X` without a null guard. ~30 sites already updated; new code must follow.
- **`bookings.source` values** (Phase 12B): `'scheduled'` (live), `'historical_import'` (Phase 12B import), `'walk_in'` (manual entry). `null` = legacy pre-Phase-12B booking (treat as `'scheduled'`). Historical bookings render with an `H` badge in calendar + daily log + tooltip showing the source XLSX file name (`booking.importBatch?.fileName`).
- **Service log import matching cascade** (`src/lib/service-log-import.ts::matchService`): (a) fuzzy name ≥0.72 → (b) unique exact-price match → (c) combo (size 2-3, factorial guard above 30 services, addon services excluded via `pricingType !== 'addon'`) → (d) unmatched (`needsReview: true`). Memo matching is NOT implemented — `qb_invoices` has no memo column. QB cross-reference uses amount (hard) + resident name fuzzy (≥0.70) + closest date as tiebreaker, claim-once per import transaction.
- **`parseServiceLogXlsx(buffer, fileName?)`** extracts `meta.facility` and `meta.stylist` via **mode detection** across ALL rows — collects every non-empty, non-`"Doesn't Fill"` value via `mostFrequent()` helper and picks the most frequent. Falls back to parsing the filename when `facility` is still empty: strip extension, split on `" - "`, take last segment (`"F177 - Sunrise of Bethesda.xlsx"` → `"Sunrise of Bethesda"`). `POST /api/super-admin/import-service-log` passes `file.name` as the second arg. **Column names**: actual XLSX headers are `'Facility Name'` and `'Stylist Name'` (not `'Facility'`/`'Stylist'`). The parser uses a case-insensitive, trim-safe `resolveKey(...names)` helper that builds a `Map<normalizedKey, actualKey>` once from the first row, then falls back through aliases — `resolveKey('Facility Name', 'Facility')` handles both old and new formats. Facility cell values include an F-code prefix (`"F177 - Sunrise of Bethesda"`) which is stripped before mode detection. Full alias list: `'Facility Name'|'Facility'`, `'Stylist Name'|'Stylist'`, `'Room#'|'Room'`.
- **Historical bookings never sync to Google Calendar** — `src/app/api/bookings/[id]/route.ts` and `src/app/api/bookings/sync/route.ts` short-circuit with `if (!booking.service)` before calling `createCalendarEvent`/`updateCalendarEvent`. Don't remove these guards.
- **Historical import start-time assignment** (two-priority): (1) if a `source='scheduled'` booking already exists for `(residentId, YYYY-MM-DD)`, reuse its startTime; (2) otherwise use `facilityDateAt9amPlusSlot(date, tz, slotIndex)` — 9:00am + slotIndex×30min, DST-safe, same Intl.DateTimeFormat approach as `serviceDateAtNoonInTz`. `slotCountMap` is keyed by **`dateStr` only** (YYYY-MM-DD, NOT residentId|dateStr) — all bookings on the same calendar date share one global counter so they spread across 9:00, 9:30, 10:00 … The `existingScheduledMap` lookup still uses `residentId|dateStr` (needs the specific resident). Do NOT use `serviceDateAtNoonInTz` for new historical imports — it causes all same-day rows to stack.
- **Import dedup query MUST filter `active = true`** — the batch rollback soft-deletes bookings (`active = false`). Without `eq(bookings.active, true)` in the dedup pre-fetch, rolled-back bookings are still found and counted as duplicates on re-import, blocking every row (266 duplicates skipped, 0 created). Always keep `eq(bookings.active, true)` in the `existingBookings` query inside the import transaction.
- **`quickbooks_sync_log` table (Phase 11N)**: one row per QB operation; `payPeriodId` is NULLABLE — `syncVendorsForFacility` is called both from its own POST handler (no period context) and from `sync-bill` (has context). The third param `payPeriodId: string | null = null` must stay optional with a null default. All log inserts are fire-and-forget (`.catch()`) — never await, never let failure propagate.
- **`syncVendorsForFacility` signature**: `(facilityId: string, filterStylistIds?: string[], payPeriodId: string | null = null)` — the `sync-bill` route passes `periodId` as the third arg when auto-syncing missing vendors.
- **`QB_INVOICE_SYNC_ENABLED` env flag (Phase 11M)** — gates `POST /api/quickbooks/sync-invoices/[facilityId]` and the related UI buttons. Default `false` locally and unset in Vercel. Setting it to `'true'` in Vercel turns on live invoice pulls from QuickBooks; flip ONLY after Intuit production approval is granted. Route returns 503 with "awaiting Intuit production approval" message when the flag is anything other than `'true'`. UI shows a `<DisabledActionButton>` with the same tooltip when the flag is off, so there's no way for an admin to accidentally invoke it before approval.
- **Invoice sync engine** (`src/lib/qb-invoice-sync.ts::syncQBInvoices(facilityId, { fullSync? })`): paginates QB Online's `SELECT * FROM Invoice` query API at 100 rows per page, capped at 5000 invoices per call. On incremental syncs uses `WHERE Metadata.LastUpdatedTime > '<cursor>'`; on `fullSync: true` ignores the cursor. Cursor is an ISO 8601 timestamp stored on `facilities.qb_invoices_sync_cursor` and bumped to `now()` after every successful run; `qb_invoices_last_synced_at` (timestamptz) drives the UI label. Resident match order is **exact `qbCustomerId` → fuzzy at 0.7 → null** — unmatched invoices are still stored. Status derivation matches the legacy CSV import (`open === 0 'paid' / open < 0 'credit' / open < amount 'partial' / else 'open'`). Skip detection: pre-fetch existing rows and compare on `(openBalanceCents, status, qbInvoiceId)` to avoid redundant writes. After upserts, `qb_outstanding_balance_cents` is recomputed for the facility and every resident in scope. Rate limit bucket: `qbInvoiceSync` 3/h/user.
- **`BillingFacility.hasQuickBooks` + `qbInvoicesLastSyncedAt`** are derived in the cached `getBillingSummaryData` and returned to the client (tokens are read but stripped before serialization). The Sync from QB button + status line on `/billing` reads from this; `revalidateTag('billing', {})` after a sync auto-refreshes both. Don't add a separate prop pipeline.

### Settings (`/settings`, Phase 11J.3)
- Layout: Apple-style two-pane — left rail of categories, right content panel. Mobile collapses to a category list that drills into a content view via `mobileShowingContent` state.
- Categories: `general | team | billing | integrations | notifications | advanced`. Each lives as its own component under `src/app/(protected)/settings/sections/`. The shell (`settings-client.tsx`) only owns nav + URL sync + role-gated visibility.
- URL convention: `?section=<id>`. Legacy `?tab=<id>` values still resolve via `TAB_TO_SECTION` map for back-compat with saved bookmarks. New inbound links MUST use `?section=`.
- QuickBooks OAuth callback (`?qb=connected` / `?qb=error&reason=…`) auto-resolves the active section to `billing`; the toast surfaces in the Billing & Payments section.
- Role-gated visibility (built in `settings-client.tsx::visibleCategories`):
  - `admin` (and normalized `super_admin`) → all 6 categories
  - `facility_staff` → only General (read-only — every input rendered as `<p>` text, no Save button, amber "contact your admin" banner)
  - `bookkeeper` → only Notifications (read-only)
  - `stylist` / `viewer` → already redirected at `page.tsx:20` (Phase 11J.1 guard)
- Server `page.tsx` passes `role: facilityUser.role` (NOT `isAdmin`) and `adminEmail: process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? null` to the client.
- Section card style: `rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)]`. Section headers inside a category: `text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3`.
- The page container is `max-w-5xl mx-auto px-4 py-8` (NOT `max-w-2xl` like the old flat layout).
- Sign-out button always renders below all sections, at the bottom of the page.

### Payment Reconciliation (Phase 11K)
- Schema: `qb_payments` gained 4 nullable columns — `reconciliation_status` (text, default `'unreconciled'`, CHECK in `unreconciled|reconciled|partial|flagged`), `reconciled_at` (timestamptz), `reconciliation_notes` (text), `reconciliation_lines` (jsonb).
- `ReconciliationLine` type lives in `src/types/index.ts`; the schema column references it via `import type` to avoid duplication.
- **Engine**: `src/lib/reconciliation.ts` exports `reconcilePayment(paymentId, facilityId)`. It only does per-line matching when `residentBreakdown.type === 'remittance_lines'` — non-remittance payments are auto-marked `'reconciled'` with empty lines.
- **Match strategy** for each line:
  1. Same-day booking exists for `(facilityId, residentId, invoiceDate)` → `'high'`
  2. ±1 day booking exists → `'medium'` with `flagReason: 'Date off by 1 day …'`
  3. Otherwise → `'unmatched'`
- **Booking-status filter** (load-bearing): `notInArray(bookings.status, ['cancelled', 'no_show', 'requested'])`. Cancelled/no-show bookings explicitly do NOT count as evidence the service was performed; portal-`requested` bookings are not yet confirmed by an admin.
- **`logEntryId` field naming**: actually stores a `bookings.id`, not a `log_entries.id`. The user-facing concept is "the daily log entry that proves the service happened" — that's a booking. Don't try to dereference it against `log_entries`.
- **Timezone math**: `bookings.startTime` is `timestamptz`; the invoice date is `'YYYY-MM-DD'` in the facility's local time. The engine converts a date+timezone to a UTC `[start, end)` range using `Intl.DateTimeFormat` to derive the offset (DST-aware). Helper `dayRangeInTimezone` is private to `reconciliation.ts`.
- **Status rollup**: any unmatched → `'flagged'`; all high → `'reconciled'`; otherwise → `'partial'`.
- **API**: `POST /api/billing/reconcile/[paymentId]` runs reconciliation + persists; `GET` returns the stored result without re-running. Both use `canAccessBilling(role)` + facility scope (master-admin bypass via env email match). POST calls `revalidateTag('billing', {})`.
- **UI**: lives in `rfms-view.tsx` only. Status pill on the parent row's Memo cell when `reconciliationStatus !== 'unreconciled'`; expanded row gains a `<ReconciliationPanel>` (Reconcile button if `unreconciled`, results table otherwise). One-line summary above the checks table: `Reconciliation: N reconciled · M partial · K flagged · [View flagged →]`. The flagged-only filter is local-state, not a route.
- **Resident resolution**: only the parent payment's `residentId` is used (all lines on a remittance slip share the same payee). Per-line resolution via `qb_invoices.invoice_ref` was deferred — note it as the obvious next iteration if Lisa flags multi-resident remittance slips.
- **HybridView** must forward `onPaymentUpdated` from `billing-client.tsx` through to its inner `<RFMSView>` so reconciliation works on hybrid facilities too.

### Revenue Share Integration (Phase 11L)
- Schema gained 7 nullable columns:
  - `qb_payments`: `rev_share_amount_cents`, `rev_share_type`, `senior_stylist_amount_cents`
  - `stylist_pay_items`: `qb_invoice_id`, `invoice_amount_cents`, `rev_share_amount_cents`, `rev_share_type`
- **Engine**: `src/lib/rev-share.ts` exports `calculateRevShare(totalCents, revSharePercentage, revShareType) → { totalCents, seniorStylistCents, facilityShareCents, revShareType, revSharePercentage }`. When percentage is null/0 or type is null, returns the full amount as senior-stylist-only with `facilityShareCents: 0`. **Rounding rule**: `facilityShareCents = Math.round(total * pct / 100)`, then `seniorStylistCents = totalCents - facilityShareCents` (never two independent rounds — avoids 1¢ drift).
- **Math is identical** for `we_deduct` and `facility_deducts` — only the operational flow / label differs. Don't branch on type for the numbers.
- **`POST /api/billing/save-check-payment`** computes the split once per request from the facility row and writes the 3 new columns on every `qb_payments` insert — all 4 code paths (per-resident IP, RFMS facility-level, lump facility, cash). The facility row is fetched inside the route (not from the request body).
- **`POST /api/pay-periods`** does a best-effort booking↔invoice match: a left-join from `bookings` to `qb_invoices` on `(facility_id, resident_id)` plus `qb_invoices.invoice_date BETWEEN bookings.start_time::date - 30 days AND bookings.start_time::date + 30 days`. Each pay item stores the **first** matched invoice (best-effort — pay items are 1-many to bookings; multi-invoice cases lose detail). Always also stores `revShareAmountCents = round(grossRevenueCents * revSharePct / 100)` and `revShareType = facility.qbRevShareType`.
- **Booking-status filter on the JOIN**: not applied (pay-period query already filters on `status='completed'`).
- **`logEntryId` field naming** (Phase 11K) and `qbInvoiceId` field naming (Phase 11L) both store best-effort references that may be wrong if data shifts. Treat them as informational, not load-bearing.
- **Cross-facility rev share rollup** in `GET /api/billing/cross-facility-summary` adds two SUM aggregates from `qb_payments` over ALL rows (not month-scoped). Returns `totalRevShareCents` + `totalNetCents`. **Caveat**: only payments inserted post-Phase-11L populate the new columns — historical rows contribute 0. No backfill performed.
- **UI**: 
  - `rfms-view.tsx` Memo cell appends a 2-line rev share sub-block (Senior Stylist / Facility share with percentage badges) when `revShareAmountCents > 0` AND `facility.revSharePercentage > 0`. Style: `text-xs text-stone-400 leading-tight`, badges `bg-stone-100 text-stone-600 rounded-full px-2 py-0.5 text-[10px] font-semibold`.
  - `billing-client.tsx` adds a "Net to Senior Stylist: $X" sub-line below the Total Received tile when `facility.revSharePercentage > 0`, plus a 2-tile cross-facility rollup row (master admin only) below the existing 5-tile cross-facility bar.
  - `payroll-detail-client.tsx` adds a 2-line indented sub-block below each stylist row (border-l accent) showing rev share + net to Senior Stylist. Plus a 3-segment footer summary line at the bottom of the items table.
  - `analytics/reports-client.tsx` adds a Revenue Share card above the Total Revenue / Appointments tiles when `revSharePercentage > 0`. 3-column grid: Gross / Rev share deducted / Net.
  - `settings/sections/billing-section.tsx` rev share card adds a `bg-stone-50` calculation preview block under the toggle row showing "On a $10,000 payment → $X to Senior Stylist, $Y to facility" — recomputes live as the toggle changes (label only — math is identical between types).
- **0%-facility behavior**: every rev share UI element is hidden when `revSharePercentage` is null/0. Don't render an empty card.
- **`save-check-payment` does NOT pass facility from the request body** — it always re-fetches `facilities.findFirst` to read `revSharePercentage` + `qbRevShareType` server-side. Don't trust client-supplied rev share values.

### Performance / Caching (Phase 11J.4)
- **`loading.tsx`**: every server-rendered page with non-trivial data fetch MUST have a sibling `loading.tsx` exporting a skeleton — without it Next.js shows a blank screen on cold renders. Use `.skeleton-shimmer rounded-2xl` blocks (class lives in `globals.css`). Existing files: `master-admin/`, `billing/`, `payroll/`, `payroll/[id]/`, `residents/`, `residents/[id]/`, `stylists/`, `stylists/[id]/`, `services/`, `my-account/`, `settings/`, `analytics/`, `log/`, `dashboard/`. Skeleton shape should roughly match the page (header bar + content cards/rows).
- **Heavy libs go through `next/dynamic`** in client components: `recharts`, `pdfjs-dist`, `xlsx`, `papaparse`. Top-level imports inflate the route bundle for users who never hit the chart/import flow. Pattern for components: `const BarChart = dynamic(() => import('recharts').then(m => m.BarChart), { ssr: false })`. For one-off util calls in event handlers: `const Papa = (await import('papaparse')).default`.
- **`unstable_cache` registry** (existing wrapped queries):
  - `master-admin/page.tsx` — `getCachedFacilityInfos(yearMonthKey)`: keyParts `['master-admin-facility-infos']`, `revalidate: 300`, tag `'facilities'`. The function arg `yearMonthKey` (e.g. `'2026-04'`) auto-rotates the cache when the calendar month flips so `bookingsThisMonth` stays correct.
  - `master-admin/page.tsx` — `getCachedPendingAccessRequests()`: keyParts `['master-admin-pending-access-requests']`, `revalidate: 60`, tag `'access-requests'`.
  - `super-admin/reports/{outstanding,monthly}/route.ts` — keyParts include facilityIds + month, `revalidate: 300`, tag `'bookings'`.
  - `billing/summary/[facilityId]/route.ts` — `getBillingSummaryData(facilityId, from, to)`: keyParts `['billing-summary']`, `revalidate: 120`, tag `'billing'`. Busted by `revalidateTag('billing', {})` in save-check-payment, Stripe webhook, and reconcile routes. **Row limits**: 500 invoices, 200 payments. **Default date range**: current month (API always filters by date range — no unbounded all-history fetch). DB indexes (declared in `src/db/schema.ts` AND created in DB by Apr 27 audit pass — they were missing in DB despite being claimed by Phase 11J.4): `qb_invoices_facility_date_idx (facility_id, invoice_date DESC)`, `qb_payments_facility_date_idx (facility_id, payment_date DESC)`, `residents_facility_active_idx (facility_id) WHERE active = true`.

**Index audit (Apr 27 2026)**: full DB inspection produced 9 missing indexes on heavily-queried columns. All are now declared in `src/db/schema.ts` and present in DB:
  - `bookings`: `bookings_facility_start_idx (facility_id, start_time DESC)`, `bookings_stylist_start_idx (stylist_id, start_time DESC)`, `bookings_resident_idx (resident_id)`
  - `log_entries`: `log_entries_facility_date_idx (facility_id, date DESC)` — existing compound unique has stylist_id 2nd, prefix mismatch
  - `stylist_facility_assignments`: `stylist_facility_assignments_facility_idx (facility_id)` — existing unique has stylist_id leftmost, can't serve facility-only filters
  - `compliance_documents`: `compliance_documents_stylist_facility_idx (stylist_id, facility_id)`
  - `qb_invoices`: `qb_invoices_facility_date_idx (facility_id, invoice_date DESC)` (was claimed by 11J.4, never existed)
  - `qb_payments`: `qb_payments_facility_date_idx (facility_id, payment_date DESC)` (was claimed by 11J.4, never existed)
  - `residents`: `residents_facility_active_idx (facility_id) WHERE active = true` (was claimed by 11J.4, never existed)
- **Cache tags in use**: `'bookings'`, `'pay-periods'`, `'billing'`, `'facilities'`, `'access-requests'`. Always call `revalidateTag('<tag>', {})` (Next.js 16 second-arg signature) on the success path of any mutation that affects cached data.
- **`'facilities'` revalidation**: every facility mutation MUST call `revalidateTag('facilities', {})` — already wired on `POST /api/facilities`, `PUT /api/facility`, `PATCH /api/facilities/[facilityId]/rev-share`, `POST /api/super-admin/merge-facilities`, `POST /api/super-admin/import-quickbooks`, `POST /api/super-admin/import-facilities-csv`.
- **`'access-requests'` revalidation**: `POST /api/access-requests`, `PUT /api/access-requests/[id]` (approve + deny paths).
- **Parallel `Promise.all` in `page.tsx`**: data fetches that don't depend on each other MUST be wrapped in `Promise.all([...])`. When a query depends on `facilityUser.facilityId`, keep it sequential (don't try to parallelize through it). The billing page uses a conditional `Promise.all` to skip `getUserFacility` for master admins (they don't need a facilityUser).
- **`force-dynamic` is redundant** when a route uses `cookies()`, `getUserFacility()`, or `request.nextUrl.searchParams` — Next.js auto-detects dynamic from those. Only keep `export const dynamic = 'force-dynamic'` on routes that have `maxDuration` set, on `scan-check` / `save-check-payment` / QB sync routes, and on family/portal pages.
- **DB pool** (`src/db/index.ts`): `max: 1`, `idle_timeout: 20`, `connect_timeout: 10`. **`prepare` is NOT set** — `DATABASE_URL` points at the session-mode pooler (port 5432), which supports prepared statements natively (only transaction mode / port 6543 requires `prepare: false`). Do not raise `max` above 1. Do not lower `connect_timeout` below 10. Do not re-add `prepare: false` — see the canonical Database section at the top of this file.
- **Drizzle migrations**: `drizzle.config.ts` reads `DIRECT_URL` (with `DATABASE_URL` fallback). `drizzle-kit push` should always go through the direct connection, not pgBouncer.

### Tips (Phase 12E)
- **`bookings.tip_cents`** — nullable integer. `null` = no tip; never store `0`. Stylist-only — must NEVER aggregate into facility revenue, rev-share splits, or QB invoice totals. Every `priceCents` SUM site carries an inline `// price_cents only — never add tip_cents` comment; new SUM sites MUST add the same.
- **`residents.default_tip_type` / `default_tip_value`** — discriminated pair. `default_tip_type` is `'percentage' | 'fixed' | null`; `default_tip_value` is integer percent (`15` = 15%) when type is `'percentage'`, integer cents when type is `'fixed'`. Both null when no preference. Auto-fills the booking modal tip field on resident pick.
- **`computeTipCents(priceCents, type, value)`** lives in `src/lib/tips.ts`. Single source of truth — never roll your own % math. Booking modal uses it for live preview.
- **`stylist_pay_items.tip_cents_total`** — per-period sum, default 0 NOT NULL. `computeNetPay` adds it on top of base pay; deductions then apply. Pay-period creation aggregates `bookings.tip_cents` into this field SEPARATELY from `gross_revenue_cents`.
- **QB Bill split**: when pushing payroll to QB, the per-stylist net pay is broken into two Bill lines: `<Stylist> — <period> commission` (= netPayCents − tipCentsTotal) and `<Stylist> — <period> tips` (= tipCentsTotal, only when > 0). Lines sum to netPayCents — total is unchanged, just decomposed for QB reporting.
- **`<DefaultTipPicker />`** (`src/components/residents/default-tip-picker.tsx`) is the shared 3-state (None/%/$) picker. Used by both the admin resident edit form AND the family portal `/profile` page. Don't duplicate this UI elsewhere.
- **POA portal endpoint**: `POST /api/portal/residents/[residentId]/tip-default` is portal-session-gated, NOT admin-gated. The admin `PUT /api/residents/[id]` route remains admin-only. POA can only update tip defaults for residents linked to their portal account (cross-resident leak guard).

### SMS / Twilio
- **`TWILIO_ENABLED` is checked as the literal string `'true'`** — not just truthy. `process.env.TWILIO_ENABLED !== 'true'` short-circuits `sendSms()` to a logging no-op. This lets receipt-send code paths run safely in dev without a Twilio account.
- **`sendSms(to, body)`** in `src/lib/sms.ts` is fire-and-forget — never throws, logs and returns on every error path. Match the email convention.
- **Required env vars** (Vercel + `.env.local`): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (e.g. `+12025551234`), `TWILIO_ENABLED` (set to `'true'` to activate). Default the flag to `false` until Twilio production approval is in place.
- **Receipts**: `POST /api/bookings/[id]/receipt` (admin/facility_staff guard, master-admin bypass, `receiptSend` rate-limit bucket) builds a receipt via `buildBookingReceiptHtml` + `buildReceiptSms` and sends to `resident.poaEmail` / `resident.poaPhone` respectively. Auto-fired from the Stripe webhook after the bookingId paid-flip; manually triggered from the BookingModal "Send Receipt" button (edit mode, admin only). No-contact case is silent — return `{ emailSent: false, smsSent: false }`.

### Cron Routes
- Every route under `/api/cron/*` MUST check: `request.headers.get('authorization') === \`Bearer ${process.env.CRON_SECRET}\`` — 401 otherwise
- `src/middleware.ts` already includes `pathname.startsWith('/api/cron')` in the public-route check — new cron routes need no further middleware work
- Register in `vercel.json` → `crons[]` with `{ path, schedule }`
- Cron routes set `export const maxDuration = 60` + `export const dynamic = 'force-dynamic'`

### Debug Role Impersonation (Super Admin Only)
- Cookie name: `__debug_role` — `httpOnly: false` (client badge reads it via `document.cookie`), `sameSite: lax`, `path: /`, 8-hour `maxAge`. Value: JSON `{ role: 'admin' | 'stylist'; facilityId: string; facilityName: string }`
- Gate: BOTH API routes (`POST /api/debug/impersonate`, `POST /api/debug/reset`) check `user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL` — 403 otherwise. Never expose to non-master users
- `getUserFacility()` reads `__debug_role` first — if present, returns a synthetic facilityUser object; skips DB entirely. This means ALL API routes and pages automatically see the impersonated role/facilityId without any per-route changes
- `(protected)/layout.tsx` independently reads the cookie to override `activeRole` + `facilityName` + `activeFacilityId` sent to Sidebar and `MobileDebugButton` (layout doesn't use `getUserFacility`). `activeFacilityId` is `debug.facilityId` when in debug mode, else the active facility from the `selected_facility_id` cookie (or first facility in `allFacilities`).
- `DebugBadge` (`src/components/debug/debug-badge.tsx`): client component, reads `document.cookie` on mount, renders fixed amber pill at **`top-4 right-4 z-[200]`** (top-right corner, always visible above all other chrome). Shows "Debug · {role} · {facilityName}" + "← Exit to Master Admin" button. Reset POSTs `/api/debug/reset` then does `window.location.href = '/master-admin'` (hard redirect, NOT `router.refresh()`). No `useRouter` import needed.
- Sidebar (`src/components/layout/sidebar.tsx`): `debugMode?: boolean` prop — when true, shows amber "DEBUG MODE" chip below the facility name. **Super Admin nav link is hidden when `debugMode === true`** (`&& !debugMode` added to the email check) so the simulated role is fully faithful
- `MobileNavProps` accepts `debugMode?: boolean` (unused — no Super Admin link in mobile nav — but passed from layout for API consistency)
- `MobileDebugButton` (`src/components/layout/mobile-debug-button.tsx`): receives `currentFacilityId` from layout. Facility dropdown initializes to `currentFacilityId` via `useState(currentFacilityId)` — no useEffect needed since the value comes from the server render and doesn't change after mount.
- Debug tab (`src/app/(protected)/master-admin/debug-tab.tsx`): last tab in super-admin, four action rows (Admin / Facility Staff / Bookkeeper / Stylist) + Family Portal. **Persistent status block** always shown at top — amber dot + role/facility when impersonating, emerald dot + "Master Admin (normal)" when clean. `useEffect` adds `visibilitychange` listener so status updates on tab focus-return. Family Portal row opens `/family/[facilityCode]` in new tab (no cookie involved). Facility dropdown pre-selects `currentFacilityId` via lazy `useState` initializer — validates against `eligible` list (facilities with facilityCode) so an ineligible current facility defaults to blank rather than a phantom value.
- Debug tab receives `currentFacilityId` prop: `master-admin/page.tsx` reads `selected_facility_id` cookie (httpOnly, readable server-side) and threads it through `MasterAdminClient` → `DebugTab`.
- "Resident Portal" row in debug tab is only enabled when selected facility has a `facilityCode` — required for the `/family/` URL
- **`selected_facility_id` is httpOnly** — cannot be read from `document.cookie` in client components. Always pass it as a prop from the server component layer.

### Family Portal (Phase 11E / 11I)
- URL home: `/family/[facilityCode]/*` — the only portal UI. Legacy `/portal/[token]` UI pages were deleted; a redirect-only page at `src/app/portal/[token]/page.tsx` catches old links and redirects to `/family/[facilityCode]`. The `/api/portal/[token]/*` API routes are kept for backward compat with old Stripe checkout flows
- Middleware: `pathname.startsWith('/family')` is in the public-route allowlist (no Supabase session required)
- Auth identity = `residents.poaEmail`. One `portal_accounts` row per email; one POA can be linked to many residents across many facilities via `portal_account_residents`
- Magic link: 72-hr expiry, one-time use (`portal_magic_links.used_at`). Verifying a link AUTO-LINKS every active resident with `poaEmail = email` (auto-discovery), so the user gets all their family members in one shot
- Session cookie: `__portal_session` — `httpOnly`, `secure` (production only), `sameSite: 'lax'` (NOT `strict` — magic-link redirects are top-level navigations and would drop a strict cookie), `path: '/'`, `maxAge: 30 days`. The cookie value IS the opaque server-side token; no signing — there is no `PORTAL_SESSION_SECRET` env var
- Password hashing: Web Crypto PBKDF2-SHA256, **210,000 iterations**, 16-byte salt, 32-byte hash. Encoded as `pbkdf2$210000$<saltHex>$<hashHex>`. Constant-time compare via `crypto.timingSafeEqual`. No bcrypt/argon2 deps
- Auth helper: `requirePortalAuth(facilityCode)` from `src/lib/portal-auth.ts` — call from every server page under `/family/[facilityCode]/*`. Throws `redirect('/family/[code]/login')` on missing/expired session OR when the session has no resident at this facility code
- Rate-limit buckets (in `src/lib/rate-limit.ts`): `portalRequestLink` 5/hr per `${ip}:${emailHash}`, `portalLogin` 10/hr per IP, `portalSetPassword` 5/hr per portalAccountId, `portalRequestBooking` 5/hr per portalAccountId, `portalStatement` 20/hr per portalAccountId, `portalCheckout` 10/hr per portalAccountId
- `POST /api/portal/request-link` ALWAYS returns `{ data: { sent: true } }` — never leak whether an email matches a real account
- `POST /api/portal/login` returns generic `'Invalid email or password'` for any failure mode — never distinguish reasons
- Service requests: `bookings.status = 'requested'` + `requestedByPortal = true` + `portalNotes` set. Stylist is assigned at request time via `resolveAvailableStylists()` + `pickStylistWithLeastLoad()` (or first active facility stylist as fallback). Admin reviews and confirms by changing status to `'scheduled'`
- Stripe Checkout: `POST /api/portal/stripe/create-checkout` writes `metadata.type = 'portal_balance'`. Webhook `/api/webhooks/stripe` discriminates on `session.metadata?.type` — `'portal_balance'` runs FIFO invoice-decrement + inserts `qb_payments(paymentMethod='stripe')` in a single `db.transaction`. Existing booking-payment path is unchanged. ONE webhook endpoint, ONE `STRIPE_WEBHOOK_SECRET`
- Per-facility Stripe key: prefer `facility.stripeSecretKey`, fall back to `process.env.STRIPE_SECRET_KEY`. When BOTH are unset, hide the "Pay online" CTA and show only the mail-payment block
- Statement download: `GET /api/portal/statement/[residentId]` returns printable HTML (reuses `buildResidentStatementHtml`). Adds a `<button onclick="window.print()">` and `@media print` CSS. NO PDF dependency — user invokes browser print
- Cron: `/api/cron/portal-cleanup` (daily 04:00 UTC, `vercel.json`) deletes magic-link rows older than 7 days past expiry and expired sessions
- Resident detail **unified "Family Portal" card** (admin-only): two buttons — **Send Link** (POSTs `/api/portal/send-invite`, fires email, 24h UI cooldown, refreshes page) and **Copy Link** (POSTs `/api/portal/create-magic-link`, writes URL to clipboard, 3s "✓ Copied!" feedback). Both disabled when `!resident.poaEmail`. No old "Portal Link" card exists anymore — `portalToken` removed from the `Resident` TypeScript type (DB column kept)
- `POST /api/portal/create-magic-link` — admin-only, rate-limited `portalRequestLink`. Returns `{ data: { link } }` without sending email or updating `lastPortalInviteSentAt`

### Compliance Alerts
- Send when `expiresAt` is exactly 30 or 60 days from today (UTC), verified docs only
- Emails to facility admins (`facilityUsers.role = 'admin'` joined to profiles for email), fallback to `NEXT_PUBLIC_ADMIN_EMAIL`

### Super Admin Reports
- Use `unstable_cache` with `tags: ['bookings']` and `revalidate: 300`
- Cache key must include sorted facilityIds + month/year

### Facility Merge Tool (`/master-admin` Merge tab)
- Both routes gated on `user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL` — master admin only, NOT franchise super_admin
- `GET /api/super-admin/merge-candidates` fuzzy-matches no-FID active facilities against FID active facilities via `fuzzyScore` at threshold **0.6** (below `fuzzyBestMatch`'s 0.7 default — no-FID variants often drop abbreviations). Confidence bucketing: `score === 1.0` → high, `≥0.8` → medium, `≥0.6` → low
- `POST /api/super-admin/merge-facilities` MUST wrap every write in a single `db.transaction()` — Drizzle auto-rolls back on throw. Never break the transaction apart
- **Resident re-pointing order is LOAD-BEARING**: secondary residents are re-pointed BEFORE the bookings `facility_id` bulk update so any conflicted residents' bookings get their `resident_id` remapped inside the same transaction. Do not reorder
- Resident soft-conflict key: `normalizeWords(name).join(' ') + '|' + (roomNumber ?? '').trim().toLowerCase()`. Match = re-point bookings/qb_invoices/qb_payments/qb_unresolved_payments.resolved_to_resident_id + soft-delete secondary resident. No match = simple `facilityId` update
- Unique-constraint tables where the secondary row must be DELETED when the primary already has a matching key: `log_entries(facility_id, stylist_id, date)`, `stylist_facility_assignments(stylist_id, facility_id)`, `stylist_availability(stylist_id, facility_id, day_of_week)`, `facility_users(user_id, facility_id)` PK, `qb_invoices(invoice_num, facility_id)` unique index. Do not attempt to merge the rows — primary wins
- `franchise_facilities` secondary rows are always DELETED (primary keeps its own franchise memberships)
- Field inheritance (copy-if-null only, secondary → primary) — exactly these 15 columns: `address, phone, contactEmail, calendarId, qbRealmId, qbAccessToken, qbRefreshToken, qbTokenExpiresAt, qbExpenseAccountId, qbCustomerId, workingHours, stripePublishableKey, stripeSecretKey, revSharePercentage, serviceCategoryOrder`. NEVER inherited: `id, name, facilityCode, paymentType, qbRevShareType, timezone, active, createdAt`
- Secondary facility is ALWAYS soft-deactivated (`active = false`) — never hard-deleted, consistent with the project-wide no-hard-delete rule
- `facility_merge_log` row is the final step of the transaction — every merge MUST produce exactly one audit row with all transfer counts + `fields_inherited text[]`. RLS enabled with `service_role_all` policy (required for all new tables)
- Confirmation modal requires the operator to type the secondary facility name exactly (case-insensitive) before the destructive action enables. Never remove this gate

### Applicant ZIP Radius Search
- `src/lib/zip-coords.ts` — static `ZIP_COORDS` table (~1200 entries: DC/MD 20xxx–21xxx, VA 22xxx–23xxx, MN Twin Cities 55xxx)
- Helpers: `getZipsWithinMiles(zip, miles): string[]` (Haversine O(n) scan), `extractZip(location): string | null`
- Toolbar shows radius `<select>` (5/10/15/25/50 miles) when search is exactly 5 digits

---

## UI Animation Patterns

### OCR Loading Screen (`ocr-import-modal.tsx`)
- Replaces upload step content with animated overlay when `scanning === true`
- Tip rotation: `useEffect` keyed on `scanning` runs a 3s `setInterval` — fade out → 400ms later increment `tipIndex` + fade in
- Progress bar: `scanProgress.match(/Scanning batch (\d+) of (\d+)/)` → `(X/Y)*100` capped at 90, default 5

### Full-Page Async Overlay with Two-Phase Progress Bar (`import-client.tsx` PDF parse)
- `parsing: boolean` + `progress: number` state
- On PDF drop: `setParsing(true)`, `setProgress(0)`, then `setTimeout(() => setProgress(70), 50)` — the 50ms delay forces a browser paint at 0% before the animation starts (batching without it causes the animation to never play)
- On Gemini response: `setProgress(100)`, `await new Promise(r => setTimeout(r, 400))`, then continue; `setParsing(false)` in `finally`
- Progress bar `transition`: `progress === 70 ? 'width 2s cubic-bezier(0.4, 0, 0.2, 1)' : 'width 0.4s ease-out'`
- Overlay: `fixed inset-0 bg-black/40 backdrop-blur-sm z-50` with centered `bg-white rounded-2xl shadow-xl` panel

### Searchable Combobox Pattern (`FacilityCombobox` in `scan-check-modal.tsx`)
- Component owns its own `open: boolean` state internally — parent only controls `searchValue` and `selectedId`
- `onBlur` on the container `<div>` (via `containerRef`) closes dropdown when focus leaves entirely; if user typed but didn't pick and `!selectedId`, clears the input via `onSearchChange('')`
- Use `onMouseDown={(e) => { e.preventDefault(); onSelect(...) }}` on dropdown options — prevents the input's `onBlur` from firing before the click registers
- Dropdown: `absolute z-50 mt-1 w-full bg-white border border-stone-200 rounded-xl shadow-lg max-h-64 overflow-y-auto`; each option `px-3 py-2 text-sm hover:bg-stone-50`; selected option `bg-rose-50 text-[#8B2E4A] font-medium`
- X clear button: `absolute right-2 top-1/2 -translate-y-1/2`, `tabIndex={-1}`, `onMouseDown` with `e.preventDefault()` to avoid blur race
- Facility code display: `<span className="text-stone-400 font-mono text-xs mr-1.5">{code} ·</span>` before the name

### Document Type Badge (`scan-check-modal.tsx`)
- `DOC_TYPE_LABEL` map at module level: `RFMS_PETTY_CASH_BREAKDOWN` → `'Petty Cash'`, `RFMS_REMITTANCE_SLIP` → `'Remittance'`, `RFMS_FACILITY_CHECK` / `FACILITY_CHECK` → `'Facility Check'`, `IP_PERSONAL_CHECK` → `'Personal Check'`
- Style: `bg-stone-100 text-stone-600 text-xs font-semibold px-2 py-0.5 rounded-full`
- Placed inside a `flex items-center gap-1.5` wrapper alongside the confidence badge; hidden when `documentType === 'UNREADABLE'`

---

## Locked Phase Roadmap

> These phases are locked and must not be re-ordered or re-scoped without explicit user instruction.

- **Phase 7** — Compliance & Document Management: `compliance_documents` table, license/insurance columns on stylists, upload from My Account, admin verify, compliance badge (green/amber/red), 60/30-day expiry email alerts
- **Phase 8** — Workforce Availability & Coverage: `stylist_availability` table, `coverage_requests` table, time-off from My Account, "Needs Coverage" calendar flag, admin coverage queue, email alerts
- **Phase 9** — Territory / Region Management: `regions` table with `franchise_id`, `region_id` on facilities + stylists, Regions tab in /master-admin, region filter on all views. Hierarchy: Master Admin → Franchise → Region → Facility
- **Phase 10** — Payroll Operations: `payroll_periods` + `payroll_entries` tables, auto-calc from completed bookings via `commission_percent`, admin approval, QuickBooks-compatible CSV, payroll history on stylist detail
- **Phase 10B** — QuickBooks Online Integration (SHIPPED 2026-04-20): OAuth per facility, Vendor sync, payroll Bill push, payment status pull back
- **Phase 11** — Incident & Issue Tracking: `issues` table (severity: low|medium|high, type: cancellation|complaint|safety|…), "Report Issue" on booking cards + log rows, high severity → email + red banner
- **Phase 12A** (SHIPPED 2026-05-03) — Import Hub: `/master-admin/imports` 4-card hub (Service Log / QB Customer / QB Billing / Facility CSV), `import_batches` audit table, `bookings.source/raw_service_name/import_batch_id` columns
- **Phase 12B** (SHIPPED 2026-05-03) — Service Log Import: `POST /api/super-admin/import-service-log` pipeline (parse → fuzzy-match facility/stylist → resident upsert → service-match cascade → dedup → bulk insert → QB cross-reference), `parseServiceLogXlsx` + `resolveKey` + `facilityDateAt9amPlusSlot` helpers, calendar/log H-badge
- **Phase 12C** (SHIPPED 2026-05-03) — Reconciliation Queue + Batch Rollback: `bookings.needs_review/qb_invoice_match_id/active` columns, `/master-admin/imports?tab=review` UI, `POST /api/super-admin/import-review/resolve` (link/create/keep), `DELETE /api/super-admin/import-batches/[batchId]` soft-delete, sidebar amber badge via `<NeedsReviewBadge />`
- **Phase 12D** (SHIPPED 2026-05-03) — Interactive Import Result Stat Tiles: `ResultTile` in `service-log-client.tsx` with `href` (navigate) and `tooltip` (click-toggle popover) modes; `imports-client.tsx` reads `?tab=review` on mount via `URLSearchParams` (avoids Suspense boundary)
- **Phase 12E** (SHIPPED 2026-05-04) — Tips & Receipts: `tip_cents` on bookings, `default_tip_type/value` on residents, `tip_cents_total` on stylist_pay_items; `<DefaultTipPicker />` shared between admin + new family portal `/profile` page; booking modal tip row with resident-default auto-fill; QB Bill push splits commission/tips into separate lines; `POST /api/bookings/[id]/receipt` (email via Resend, SMS via Twilio gated by `TWILIO_ENABLED='true'`); Stripe webhook auto-sends receipt after card payment; revenue-guard comments at 9 priceCents SUM sites
- **Phase 13** (SHIPPED 2026-05-04) — Performance Pass: `DATABASE_URL` switched to session-mode pooler (port 5432), `prepare: false` removed, `Promise.race` resolve-not-reject in `layout.tsx` (`LAYOUT_TIMEOUT_MS = 8000`), master-admin cold-cache rewritten as 5 flat `GROUP BY` queries (was 4×N), 4 cached functions wrapped in try/catch returning `[]`, cross-facility summary cached (2min, `billing` tag), 3 new partial indexes, middleware short-circuit for `/portal/*` + `/family/*` + `/api/cron/*` + `/api/portal/*` + `/invoice/*` + `/privacy` + `/terms`
- **Phase 14** — Facility Contact Portal: `facility_contact` role, `service_change_requests` table (add_day|cancel_day|…), restricted nav (Schedule read-only, Visit Summaries, Invoices, Submit Request)
- **Phase 15** — QuickBooks Polish: automated retry-with-backoff worker for transient failures, optional invoice push for non-Stripe facilities. (`quickbooks_sync_log` audit table shipped in Phase 11N.)
- **Phase 16** — Per-Stylist Google Calendar Integration: per-stylist OAuth2 connect, bookings sync as calendar events
- **Phase 17** — Advanced KPI Dashboard: no schema changes, new metrics (cancellation rate, avg ticket, utilization, concentration risk, MoM/YoY), region filtering, weekly email digest, PDF export

---

## Reference Files
- `docs/master-spec.md` — full architecture reference (API routes, schema, feature specs)
- `docs/design-system.md` — UI patterns and component rules
- `docs/project-context.md` — current status, phases, handoff info
- `src/db/schema.ts` — source of truth for DB tables
- `src/lib/get-facility-id.ts` — how facility scoping works

---

## End of Every Session

ALWAYS do these four things before finishing any task:
1. Update `docs/master-spec.md` — new DB columns, tables, API routes, features
2. Update `docs/design-system.md` — new UI patterns or anti-patterns
3. Update `CLAUDE.md` — new rules or bugs fixed
4. Update `docs/project-context.md` — Current Status section, Immediate Next Fix section, and Phase Roadmap if anything changed
