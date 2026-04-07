# Senior Stylist — Claude Code Rules

## Project
- Live site: https://senior-stylist.vercel.app
- GitHub: https://github.com/SeniorStylist/senior-stylist
- Supabase project: goomnlsdguetfgwjpwer

## Non-Negotiable Rules

### Database
- ALWAYS scope every DB query to facilityId — never return data across facilities
- NEVER hard delete records — always use active=false
- Prices are ALWAYS stored in cents (integers) in the DB
- Display prices by dividing by 100, NEVER store floats
- After ANY schema change run: npx dotenv -e .env.local -- npx drizzle-kit push
- facilityUsers.role is the authoritative role — not profiles.role
- facilities.working_hours is jsonb `{ days: string[], startTime: "HH:MM", endTime: "HH:MM" }` — null = default 08:00–18:00; use it to bound time slots in booking modal
- ALL tables MUST have RLS enabled with a `service_role_all` policy — when adding a new table, run `ALTER TABLE x ENABLE ROW LEVEL SECURITY` and `CREATE POLICY "service_role_all" ON x FOR ALL TO service_role USING (true) WITH CHECK (true)`
- NEVER disable RLS on any table — all DB access goes through service_role (Drizzle + SUPABASE_SERVICE_ROLE_KEY); the anon key is auth-only and must never have direct table access
- MIDDLEWARE RLS EXCEPTION: `facility_users` and `invites` have an additional scoped `authenticated` SELECT policy so that middleware (which uses the anon key / `authenticated` role) can query them. `facility_users` → `user_id = auth.uid()`; `invites` → `email = auth.jwt()->>'email'`. Without these, middleware queries silently return empty and every user gets redirected to /unauthorized. If you add a new table that middleware needs to query, add a scoped `authenticated` SELECT policy for it.

### Git
- ALWAYS use git add -A (project path has parentheses that break zsh globs)
- NEVER commit .env.local
- Always run npx tsc --noEmit before committing — fix all errors first

### Auth & Roles
- role 'admin' — full access to everything
- role 'stylist' — calendar, log, own earnings only. No reports, no settings
- role 'viewer' — read-only, no edits
- role 'super_admin' — franchise owner; scoped to only the facilities in their franchise (via franchises + franchise_facilities tables). Facility switcher in layout.tsx filters to franchise facilities only. Assigned via facility_users.role = 'super_admin' by master admin.
- Super admin (master admin) bypasses all checks via NEXT_PUBLIC_SUPER_ADMIN_EMAIL env var
- Franchise system: `franchises` table (id, name, owner_user_id → profiles). `franchise_facilities` join table (franchise_id, facility_id, CASCADE on both). When a franchise is created/updated, facilityUsers rows are upserted for the owner with role='super_admin' on all franchise facilities. API: GET/POST /api/super-admin/franchises, PUT/DELETE /api/super-admin/franchises/[id]. CRUD UI in /super-admin page Franchises section.
- Portal routes (/portal/*) are PUBLIC — token = auth, no login required
- Invoice routes (/invoice/*) are PUBLIC — printable pages

### API Routes
- Every API route must check auth via Supabase createClient().auth.getUser()
- Every API route must scope to facilityId via getUserFacility()
- Return { data: ... } on success, { error: "message" } on failure
- Always wrap DB queries in try/catch — never let a DB error crash a page

### Database Connection
- Use the pooler URL (port 5432, session mode) for DATABASE_URL
- max: 1 connection, idle_timeout: 20, connect_timeout: 30
- NEVER set max > 1 in session mode — Supabase session pooler holds a real Postgres connection per serverless instance; multiple instances with max > 1 quickly exhaust the connection limit and throw `MaxClientsInSessionMode`
- The client is a singleton via globalThis._pgClient
- When a route runs 3+ sequential DB queries, wrap them in db.transaction() to share a single connection

### UI / Design
- Design system: stone colors, #0D7377 teal primary, rounded-2xl cards
- Fonts: DM Serif Display (headings), DM Sans (body)
- Bottom sheets on mobile, modals on desktop
- All bottom sheets: fixed overlay → flex-col → justify-end structure
- Footer/save buttons ALWAYS outside scroll area (flexShrink: 0)
- viewport-fit=cover required in layout.tsx for iPhone safe areas

### Common Bugs to Avoid
- NEVER use new URL(request.url).origin for redirects on Vercel — use request.nextUrl.clone()
- Long-running API routes (OCR, AI calls) MUST export `export const maxDuration = 60` and `export const dynamic = 'force-dynamic'` at the top of the file — without maxDuration, Vercel cuts the function at 10s and the client sees a network error
- NEVER put page.tsx files inside /app/api/ directories
- NEVER set selectMirror=true on FullCalendar (causes squish bug)
- NEVER make Google Calendar sync block a response — always fire-and-forget
- NEVER use position:sticky inside overflow:auto on iOS — use flexShrink:0 footer instead
- Any `fixed` element near the bottom of the screen on mobile MUST use `style={{ bottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}` — the mobile nav bar is ~72px tall; adding 80px clears both it and the home indicator. Remove any Tailwind `bottom-N` class from the same element (inline style wins on specificity but keeping both is confusing). Floating action bars, FABs, scan buttons, multi-select bars all need this.
- Resident merge: POST /api/residents/merge moves bookings (residentId reassign), then renames merged resident to `${name}-merged` (BEFORE setting active=false) to free the unique(name, facility_id) constraint, then updates the kept resident's name. Always rename first, deactivate second. Never hard delete.
- Safe area insets in modals: use inline `style` (not Tailwind) for `env()` values — Tailwind cannot compute them. Header: `style={{ paddingTop: 'calc(env(safe-area-inset-top) + 20px)' }}`. Footer: `style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}`. Scroll areas with bottom buttons: `style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}`.
- Lightbox pattern: `const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)`. Overlay: `fixed inset-0 z-[60] bg-black/90 flex items-center justify-center` with safe-area padding inline styles. Tap overlay to close. Image `onClick` stops propagation. ✕ button: `style={{ top: 'calc(env(safe-area-inset-top) + 16px)' }}` positioned `absolute right-4`.
- pdfjs-dist (v5) client-side PDF preview: `import * as pdfjsLib from 'pdfjs-dist'`; set `workerSrc` to `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`. Turbopack (used by default in Next.js 16) handles native deps like `canvas` automatically — no webpack alias needed. Do NOT add `webpack: (config) => { config.resolve.alias.canvas = false }` — it breaks the Turbopack build. v5 `page.render()` signature: `{ canvasContext, canvas, viewport }` (must include `canvas`, not just `canvasContext`). Store rendered data URLs (JPEG 0.85) in `previews[]`; empty string `''` = still rendering → show fallback icon.
- ALWAYS call api.unselect() immediately in FullCalendar onSelect handler
- NEVER use pdf-parse or @napi-rs/canvas on Vercel — use unpdf (no native deps)
- PDF text from unpdf comes out as ONE blob with no newlines — never split('\n')
- PDF blob parsing MUST use the alternating-chunks approach: split on price numbers with capture group → alternating [text, price, text, price...] array → walk even-index text chunks → detect category changes via ' Price ' substring in the chunk. NEVER use a single regex to extract service names from a flat blob — character classes break on apostrophes/em-dashes and category names bleed into service names.
- PDF category headers (e.g. "Color", "Perms & Relaxers") appear as no-price text chunks — when hasPrice is false and the chunk is not garbage (length >= 3, not starting with *, not "Price"), treat it as the new currentCategory.
- React does NOT support indeterminate as a JSX prop — set via callback ref: ref={(el) => { if (el) el.indeterminate = ... }}
- Drizzle inArray() throws on empty array — always guard with .min(1) in Zod schema
- `revalidateTag` in Next.js 16 requires TWO arguments: `revalidateTag('tag', {})` — the second arg is a `CacheLifeConfig` object; passing an empty object `{}` satisfies the type. Single-arg form causes a TS error. Applies to all booking mutation routes.
- `unstable_cache` pattern for super-admin cross-facility reports: wrap the DB fetcher in `unstable_cache(fetcher, [cacheKey], { revalidate: 300, tags: ['bookings'] })`. Cache key must include the sorted facilityIds and the month/year so different admins/months get separate cache entries. Always call the returned function (it returns a Promise). Booking mutations call `revalidateTag('bookings', {})` to invalidate these.
- Floating action bars should use z-40 (not z-50) so they don't cover the mobile nav
- PWA icons: use `src/app/icon.tsx` + `apple-icon.tsx` with ImageResponse from `next/og` — never use @napi-rs/canvas
- Recurring bookings: self-referential FK `recurringParentId` in schema requires `(): AnyPgColumn => bookings.id` pattern
- date-fns is installed (`addWeeks`, `addDays`, `addMonths`) — use it for date arithmetic
- InstallBanner uses `beforeinstallprompt` (Android) + manual iOS Share instructions; checks `(display-mode: standalone)` to hide when already installed
- drizzle-kit push will interactively prompt when it detects constraints that already exist in the DB — if it hangs, apply the specific SQL directly via a one-off node script using the project's DATABASE_URL:
  ```js
  // scripts/migrate.mjs
  import postgres from 'postgres'
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 30, prepare: false })
  await sql`ALTER TABLE my_table ALTER COLUMN my_col DROP NOT NULL`
  await sql.end()
  ```
  Run with: `npx dotenv -e .env.local -- node scripts/migrate.mjs`. Delete the script after running.
- Route-level role guards — redirect non-permitted roles in the server page component OUTSIDE try/catch:
  - `/stylists`, `/services`, `/reports`, `/settings`: `if (facilityUser.role !== 'admin') redirect('/dashboard')`
  - `/residents`: `if (facilityUser.role === 'stylist') redirect('/dashboard')` (viewer still allowed)
  - Nav items in sidebar.tsx and mobile-nav.tsx use `roles: NavRole[]` arrays per item — filtered via `item.roles.includes(role as NavRole)`. Do NOT replace this with a STYLIST_ONLY_PATHS approach.
  - Stylist visible nav: Calendar (/dashboard), Daily Log (/log), My Account (/my-account)
- NEVER put redirect() calls inside try/catch in Next.js page components — Next.js redirect() throws a special NEXT_REDIRECT error internally, and a catch block swallows it, causing the error UI to render instead of the redirect. Always perform auth/facility checks and their redirects OUTSIDE try/catch; only wrap DB data loading in try/catch.
- Next.js 16 dynamic route params are a Promise — ALWAYS use `{ params }: { params: Promise<{ id: string }> }` and `const { id } = await params` inside the handler. The old sync pattern `{ params: { id: string } }` causes a build error.
- Super admin facility mutations: use PUT /api/super-admin/facility/[id] (not the regular /api/facility route) — it verifies NEXT_PUBLIC_SUPER_ADMIN_EMAIL and accepts `active` boolean for deactivation.
- Facility name uniqueness checks MUST include `eq(t.active, true)` — inactive/deactivated facilities should not block name reuse.
- Hard delete facilities via DELETE /api/super-admin/facility/[id] — only allowed if no bookings exist (returns 409 otherwise). Delete facility_users FK rows first, then the facility row.
- facilities.contact_email is a nullable text column — used on the /unauthorized page for the "Request Access" mailto link. Falls back to facility admin's email, then to NEXT_PUBLIC_ADMIN_EMAIL env var. Set via Settings → General → Contact Email.
- access_requests table: id, facility_id (nullable), email, full_name, status ('pending'|'approved'|'denied'), role, user_id, timestamps. POST /api/access-requests is public (no auth); facilityId is optional — new users submit with no facility. PUT /api/access-requests/[id] supports BOTH facility admin and super admin; on approve accepts facilityId + role + commissionPercent, provisions facilityUsers row + optional stylist upsert. Super admin sees all pending requests in /super-admin page and assigns facility. Settings "Requests" tab shows requests assigned to THEIR facility. Dashboard shows amber banner when count > 0.
- /unauthorized page is a 'use client' component — fetches user via createClient() from @/lib/supabase/client (NOT server). It collects name + role only; no facility picker, no fetch to /api/facilities/admin-contact. POST body: { email, fullName, userId, role } — facilityId is omitted (set to null by API). Send Request button MUST be disabled (not just silently blocked) when userEmail is null — show "Loading…" text.
- Email: use src/lib/email.ts sendEmail() for ALL transactional emails — never inline Resend fetch calls. From address is `onboarding@resend.dev` (works without domain verification). NEVER await sendEmail() in a request handler — fire-and-forget only. NEXT_PUBLIC_ADMIN_EMAIL is the access request notification target.
- Middleware public routes (no auth required): `/login`, `/auth`, `/unauthorized`, `/invite/accept`, `/portal/*`, `/api/portal/*`, `/invoice/*`. Adding new public routes requires updating the `isPublic` check in src/middleware.ts.
- Middleware invite redirect: when an authenticated user has no facilityUser and has a valid pending invite (matched by email), middleware redirects them to `/invite/accept?token=X` — do NOT let them roam protected routes without a facilityUser. The invite query selects `id, token`. If no invite, redirect to `/unauthorized`.
- Middleware /onboarding + /invite bypass: authenticated users with no facilityUser are always allowed through to `/onboarding` and `/invite` paths regardless of invite status.
- Onboarding wizard is 6 steps (type Step = 1 | 2 | 3 | 4 | 5 | 6); progress = (step / 6) * 100. Step 4 = Services (choose/manual/import), Step 5 = Residents (choose/manual/import), Step 6 = Done summary.
- CSV/Excel import in onboarding: use papaparse (CSV) and xlsx (Excel) client-side; detect columns by normalizing headers toLower().replace(/\s+/g,''); snap duration to nearest [15,30,45,60,75,90,120].
- papaparse is already installed (`Papa from 'papaparse'`); xlsx is already installed (`* as XLSX from 'xlsx'`).
- Onboarding Step 5 (Residents) uses /api/residents/bulk (not /api/residents) for CSV/Excel import — POST `{ rows: [{ name, roomNumber? }] }`, returns `{ data: { created: N } }`.
- Stylist dashboard mobile view: when role === 'stylist' && isMobile, show today's appointment list (not FullCalendar). setStylistListMode(true) in useEffect. Uses existing fetchBookings.
- Invite accept page does NOT check email — the token is the proof. Any authenticated user with a valid, unexpired, unused token is accepted. Remove/never add an email match guard.
- Invite accept page MUST set `selected_facility_id` cookie (via `cookies()` from `next/headers`) after inserting facilityUser — without it, layout falls back to `?? 'admin'` and the invited stylist sees the admin view.
- Invite accept auto-link: use `ilike(stylists.name, userFullName)` to match stylist by name — role === 'stylist' redirects to /my-account?welcome=1, others to /dashboard.
- Super admin invite flow: POST /api/invites requires `facilityId` in body when caller is super admin (bypasses getUserFacility). GET /api/facilities returns all active facilities for super admin. Settings invites tab shows a facility dropdown when isSuperAdmin (detected via NEXT_PUBLIC_SUPER_ADMIN_EMAIL vs currentUserEmail prop).
- NavigationProgress: client component in src/components/ui/navigation-progress.tsx — uses usePathname to show 2px teal bar on route change. Imported in (protected)/layout.tsx.
- Log page stylist sections are collapsible — collapsed state keyed by stylistId in useState<Record<string, boolean>>({}).
- Role permission matrix:
  - **master_admin** (super admin): all facilities, all operations, /super-admin page, can assign facility on invite/access-request
  - **admin**: full access to own facility — calendar, log, residents, stylists, services, reports, settings, invites
  - **stylist**: calendar (/dashboard), daily log (/log), my account (/my-account) only. Mobile shows today-list filtered to own bookings. Log filters to own section. Can edit price/notes on own bookings only. Cannot access /residents, /stylists, /services, /reports, /settings.
  - **viewer**: read-only, no edits. Can see residents but not stylists/services/reports/settings.
- Stylist dashboard filtering: page.tsx looks up `profiles.stylistId`, passes `profileStylistId` to DashboardClient. Mobile today-list filters via `todayBookings.filter(b => b.stylistId === profileStylistId)`.
- Log inline price/notes editing: log-client.tsx has `editingBookingId` state. Edit button (pencil icon) on non-cancelled, non-finalized rows. Edit mode shows $ price input + notes textarea. Saves via PUT /api/bookings/[id] with `{ priceCents, notes }`. Stylist role: only sees edit button on own bookings (gated by `stylistFilter`). Admin: edit button on all bookings.
- PUT /api/bookings/[id] accepts `priceCents` directly in updateSchema. Direct priceCents override takes precedence over service-change priceCents. Stylist ownership guard: stylists can only edit their own bookings (checked via profiles.stylistId match).
- Mobile nav prefetch: `<Link prefetch={true}>` on all nav links in mobile-nav.tsx and sidebar.tsx. mobile-nav.tsx also has `pendingHref` state — set on click for immediate tab highlight, cleared on pathname change.
- loading.tsx files exist for /dashboard, /log, /residents — use existing skeleton components from src/components/ui/skeleton.tsx.
- OCR log import: POST /api/log/ocr accepts multipart/form-data `images[]` (plural, multiple files allowed). Calls Gemini REST API **directly via `fetch`** — do NOT use the `@google/generative-ai` SDK (hardcodes v1beta with old model names). Model: **`gemini-2.5-flash`** on **`v1beta`** endpoint — `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=...`. Gemini 2.5 Flash is the current stable production model. Gemini 2.0 Flash is deprecated and unavailable to new API users. All Gemini 1.5 models shut down March 2026. Never use 1.5 or 2.0 model names. Gemini REST API uses **camelCase** field names — `inlineData`, `mimeType` — NEVER snake_case; the API silently ignores unknown fields. `systemInstruction` is NOT supported as a top-level field — fold the system prompt into the text part instead. Supports JPEG, PNG, WEBP, GIF, and **PDF** natively. Processes files sequentially with a 45s per-file `Promise.race` timeout guard. Returns `{ data: { sheets: [{ imageIndex, date, stylistName, entries }] } }`. Route exports `maxDuration = 60` and `dynamic = 'force-dynamic'`.
- OCR import route: POST /api/log/ocr/import — creates residents (with random portalToken), services (durationMinutes defaults to 30), and bookings (status: 'completed', spaced 30 min apart from 09:00 UTC per sheet, i-th entry = 09:00 + i*30 min) inside a single db.transaction(). Requires admin or master admin. Inserts directly via Drizzle — does NOT call /api/bookings (intentionally bypasses conflict detection for historical imports). **3-step resident/service resolution before inserting**: (1) use provided UUID if given, (2) check in-memory `residentMap`/`serviceMap` (Map<string,string>, key = name.toLowerCase().trim()) for same-import dedup, (3) fuzzy-match against all existing active DB records loaded once before the transaction (`existingServices`/`existingResidents`) using `fuzzyScore() >= 0.8` — reuse the match if found, only insert new if no match. Both maps are updated and DB arrays are appended on new inserts so subsequent entries in the same import also benefit. This prevents duplicate services/residents across imports.
- OcrImportModal: `src/app/(protected)/log/ocr-import-modal.tsx`. 3-step flow: (1) Upload: multi-file picker (JPEG/PNG/WEBP/PDF), thumbnails, "Take Photo" camera button on mobile (`md:hidden`, `<input capture="environment">`); (2) Review: tab per sheet, collapsible source image (`<details>/<summary>`), date/stylist selectors, per-entry resident + service **combo inputs** (`<input type="text" list="...">` + `<datalist>`) — type to filter or type new name to create, exact match sets ID, no match = create new with hint text; amber duplicate banners when 2+ fuzzy matches; price/notes editing; Unclear badge; all inputs `min-h-[44px]` for mobile tap targets; (3) Confirm: summary counts, import. Sheet-level stylist is required — sheets with no stylist are skipped. Per-sheet scan errors shown individually. `fuzzyMatches()` uses two-pass logic: (1) substring includes in either direction, (2) normalized word-set overlap ≥80% (lowercase, strip punctuation, sort words) — catches word-order variants like "Wash, Curl, Chin" vs "Chin Curl Wash".
- OCR service name normalization: do NOT rename service names server-side before matching — bad renaming (e.g. "w/" → "wash") creates mismatched names in the DB. Instead, use `WORD_EXPANSIONS` in `normalizeWords()` at comparison time only: `{ w: 'wash', c: 'cut', hl: 'highlight', clr: 'color' }`. `normalizeWords()` lowercases, strips punctuation, splits, filters, expands shorthands, and sorts — so "w/ Curl" and "Wash, Curl" normalize to the same word set. `fuzzyScore()` = intersection.length / Math.max(aw.length, bw.length). Threshold ≥0.8 for a match.
- POA fields on residents: `poa_name`, `poa_email`, `poa_phone`, `poa_payment_method` nullable text columns. Update schema.ts + PUT /api/residents/[id] updateSchema + Resident type in src/types/index.ts. POA section in resident-detail-client.tsx (edit + display). POA badge on resident list cards.

### File Structure Conventions
- Server components in page.tsx, client logic in [name]-client.tsx
- Shared utilities in src/lib/utils.ts
- All types in src/types/index.ts
- DB queries scoped via src/lib/get-facility-id.ts

## Reference Files
- docs/master-spec.md — full architecture reference
- src/db/schema.ts — source of truth for DB tables
- src/lib/get-facility-id.ts — how facility scoping works

## End of Every Session
ALWAYS do these four things before finishing any task:
1. Update docs/master-spec.md — new DB columns, tables, API routes, features
2. Update docs/design-system.md — new UI patterns or anti-patterns
3. Update CLAUDE.md — new rules or bugs fixed
4. Update docs/project-context.md — update Current Status section,
   Immediate Next Fix section, and Phase Roadmap if anything changed

This keeps the brain of the project always current.
