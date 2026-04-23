# Senior Stylist — Claude Code Rules

## Project
- Live site: https://senior-stylist.vercel.app
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

## Non-Negotiable Rules

### Database
- ALWAYS scope every DB query to facilityId — never return data across facilities
- NEVER hard delete records — always use `active = false`
- Prices are ALWAYS stored in cents (integers) — display by dividing by 100, NEVER store floats
- After ANY schema change run: `npx dotenv -e .env.local -- npx drizzle-kit push`
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
- `role 'admin'` — full access to everything
- `role 'stylist'` — calendar, log, own earnings only; no reports, no settings
- `role 'viewer'` — read-only, no edits
- `role 'super_admin'` — franchise owner; scoped to only the facilities in their franchise (via `franchises` + `franchise_facilities` tables)
  - Facility switcher in `layout.tsx` filters to franchise facilities only
  - Assigned via `facility_users.role = 'super_admin'` by master admin
  - **`getUserFacility()` normalizes `'super_admin'` → `'admin'` at read time** so all page guards, API guards, and nav filters work correctly without touching every call site
  - Normalization is in `src/lib/get-facility-id.ts` (`normalizeRole()` helper)
  - `layout.tsx` also normalizes `activeRole` independently since it queries `facilityUsers` directly
  - The Super Admin page and link remain gated by `NEXT_PUBLIC_SUPER_ADMIN_EMAIL` email match (not role)
- Super admin (master admin) bypasses all checks via `NEXT_PUBLIC_SUPER_ADMIN_EMAIL` env var
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
  - Buckets: `signup` 5/hr/IP, `portalBook` 10/hr/token, `ocr` 20/hr/user, `parsePdf` 20/hr/user, `sendPortalLink` 10/hr/user, `invites` 30/hr/user, `checkScan` 30/hr/user
  - No-ops when UPSTASH env vars are unset
- Portal routes (`/api/portal/[token]/*`) MUST use explicit `columns:` whitelists on every `db.query.*` call, and MUST verify every `stylistId`/`serviceId`/`addonServiceIds` belongs to the resident's facility before accepting input

### Security / Payload Hygiene
- Server → client payloads MUST be sanitized — never expose internal DB columns (cost basis, internal notes, other-facility data, etc.) in API responses
- Use explicit `columns:` selects in Drizzle queries on routes that return data to unauthenticated users

---

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
- Long-running API routes (OCR, AI calls) MUST export `export const maxDuration = 60` (or 120 for OCR) and `export const dynamic = 'force-dynamic'` — without `maxDuration`, Vercel cuts the function at 10s
- Next.js 16 async params — always `{ params: Promise<{id: string}> }`
- `revalidateTag` in Next.js 16 takes TWO args — `revalidateTag('bookings', {})` not `revalidateTag('bookings')`
- **Date parsing:** Use `new Date(d + 'T00:00:00')` (appending local time) — avoid `new Date('YYYY-MM-DD')` which is UTC-midnight and shifts back one day in negative-UTC-offset timezones
- **Dashboard Services panel** — NEVER use `formatCents(service.priceCents)` in `services-panel.tsx`; always use `formatPricingLabel(service)` from `src/lib/pricing.ts`. The panel receives a pre-sorted list from `dashboard-client.tsx` (sorted via `service-sort.ts` helpers respecting `facility.serviceCategoryOrder`) — do not sort inside the panel itself

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
- Skeleton loaders use `.skeleton-shimmer` class — NOT `animate-pulse bg-stone-100`

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

### Cron Routes
- Every route under `/api/cron/*` MUST check: `request.headers.get('authorization') === \`Bearer ${process.env.CRON_SECRET}\`` — 401 otherwise
- `src/middleware.ts` already includes `pathname.startsWith('/api/cron')` in the public-route check — new cron routes need no further middleware work
- Register in `vercel.json` → `crons[]` with `{ path, schedule }`
- Cron routes set `export const maxDuration = 60` + `export const dynamic = 'force-dynamic'`

### Compliance Alerts
- Send when `expiresAt` is exactly 30 or 60 days from today (UTC), verified docs only
- Emails to facility admins (`facilityUsers.role = 'admin'` joined to profiles for email), fallback to `NEXT_PUBLIC_ADMIN_EMAIL`

### Super Admin Reports
- Use `unstable_cache` with `tags: ['bookings']` and `revalidate: 300`
- Cache key must include sorted facilityIds + month/year

### Facility Merge Tool (`/super-admin` Merge tab)
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
- **Phase 9** — Territory / Region Management: `regions` table with `franchise_id`, `region_id` on facilities + stylists, Regions tab in /super-admin, region filter on all views. Hierarchy: Master Admin → Franchise → Region → Facility
- **Phase 10** — Payroll Operations: `payroll_periods` + `payroll_entries` tables, auto-calc from completed bookings via `commission_percent`, admin approval, QuickBooks-compatible CSV, payroll history on stylist detail
- **Phase 10B** — QuickBooks Online Integration (SHIPPED 2026-04-20): OAuth per facility, Vendor sync, payroll Bill push, payment status pull back
- **Phase 11** — Incident & Issue Tracking: `issues` table (severity: low|medium|high, type: cancellation|complaint|safety|…), "Report Issue" on booking cards + log rows, high severity → email + red banner
- **Phase 12** — Advanced KPI Dashboard: no schema changes, new metrics (cancellation rate, avg ticket, utilization, concentration risk, MoM/YoY), region filtering, weekly email digest, PDF export
- **Phase 13** — Facility Contact Portal: `facility_contact` role, `service_change_requests` table (add_day|cancel_day|…), restricted nav (Schedule read-only, Visit Summaries, Invoices, Submit Request)
- **Phase 14** — QuickBooks Polish: `quickbooks_sync_log` audit table, automated retry-with-backoff worker for transient failures, optional invoice push for non-Stripe facilities
- **Phase 15** — Per-Stylist Google Calendar Integration: per-stylist OAuth2 connect, bookings sync as calendar events

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
