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
- `role 'admin'` — full facility access
- `role 'super_admin'` — franchise owner; scoped to only the facilities in their franchise. **Normalized to `'admin'` by `normalizeRole()` at `getUserFacility()` read time** so all page guards, API guards, and nav filters work uniformly. The Master Admin page/link remains gated by `NEXT_PUBLIC_SUPER_ADMIN_EMAIL` email match (not role).
- `role 'facility_staff'` (Phase 11J.1) — scheduling and resident management; NO billing/payroll/analytics. Sees Calendar / Residents / Daily Log (read-only) / Settings.
- `role 'bookkeeper'` (Phase 11J.1) — billing + payroll + analytics; READ-ONLY on residents and daily log. Sees Daily Log (read-only) / Billing / Analytics / Payroll / Settings.
- `role 'stylist'` — calendar, daily log (own entries), my account only; no residents, no billing.
- `role 'viewer'` — legacy read-only role. Kept in the type union for backward compat; **no longer offered in the invite picker**.
- Master admin email bypasses all role checks via `NEXT_PUBLIC_SUPER_ADMIN_EMAIL` env var.

**Role helper functions** (`src/lib/get-facility-id.ts`, Phase 11J.1):
- `isAdminOrAbove(role)` → true for `admin`, `super_admin`
- `canAccessBilling(role)` → true for `admin`, `super_admin`, `bookkeeper` (use on `/api/billing/*`, statement send, scan-check, reports, rev-share, bookkeeper export)
- `canAccessPayroll(role)` → true for `admin`, `super_admin`, `bookkeeper` (use on `/api/pay-periods/*`, `/api/quickbooks/*`)
- `isFacilityStaff(role)` → true for `facility_staff` only
- Use these in route guards instead of bare `role !== 'admin'` whenever bookkeeper or facility_staff should be allowed. Other admin-only routes (services, stylists, invites, applicants, compliance, coverage, availability, super-admin, log/ocr) keep the bare `role !== 'admin'` guard — that already excludes the new roles.

**Server-side page guards** (Phase 11J.1 fix — guards in `page.tsx`, OUTSIDE try/catch):
- `/dashboard` → bookkeeper: redirect('/billing') (their home is billing, not the calendar)
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
  - Buckets: `signup` 5/hr/IP, `portalBook` 10/hr/token, `ocr` 20/hr/user, `parsePdf` 20/hr/user, `sendPortalLink` 10/hr/user, `invites` 30/hr/user, `checkScan` 30/hr/user, `qbInvoiceSync` 3/hr/user (Phase 11M)
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

### Dashboard right panel resize
- Dashboard right panel uses `react-resizable-panels` v2 (`PanelGroup direction="vertical" autoSaveId="dashboard-right-panel"`) to split the top zone (Today + Who's Working + Coverage) from the bottom zone (Tabs + list). Stat pills are a `shrink-0` sibling BELOW the PanelGroup — not inside it. `autoSaveId` handles localStorage persistence; no manual read/write.
- Panel sizes are percentages (not pixels): top `defaultSize={28} minSize={14} maxSize={70}`, bottom `defaultSize={60} minSize={30}`. The top `maxSize=70` is intentionally the complement of the bottom `minSize=30` — the two panels always sum to 100 and neither can be pushed below the other's floor. Bottom has no maxSize (top's minSize of 14 allows bottom to expand up to 86%). Library clamps drags automatically.
- The Today card has three adaptive layout modes driven by a `ResizeObserver` on the top panel content div: `tall` (>220px, shows 2×2 stat grid), `medium` (140–220px, hides stat grid, keeps date + summary line), `compact` (<140px, single-row flex with big count + date stack). See `TodayCard` component in `dashboard-client.tsx`. Compact uses `px-4 py-2.5` internal padding so the card squishes to ~72px minimum.
- Non-admins skip the `PanelGroup` entirely — the list zone renders in a plain `flex-1 min-h-0` div. No resize handle.
- Handle visual: horizontal divider line (`bg-stone-200`) with a white "grab dots" pill centred on top. Uses `group-data-[resize-handle-active]` Tailwind selector to switch to burgundy while dragging (the library sets that data attribute natively).
- Motion: `[data-panel]` has `transition: flex-basis 180ms cubic-bezier(0.25, 0.46, 0.45, 0.94)` + `will-change: flex-basis` (globals.css). Transition is suppressed during active drag via `[data-panel-group][data-dragging] [data-panel] { transition: none !important }` — the `data-dragging` attribute is toggled on the PanelGroup root via `document.querySelector('[data-panel-group-id="dashboard-right-panel"]')` inside `PanelResizeHandle.onDragging`.
- Magnetic snap: three resting positions (18 / 28 / 48 percent) with a 5pp threshold. On drag release, `topPanelRef.current.getSize()` is compared to the nearest snap point; if within threshold, `topPanelRef.current.resize(nearest)` triggers the animated settle via the CSS transition. `ImperativePanelHandle` from `react-resizable-panels` provides `getSize` + `resize`.
- Handle dots wrapper carries `.resize-handle-dots` class; CSS rule scales child dots to `1.4×` and fills them `#8B2E4A` via `[data-resize-handle-active] .resize-handle-dots > div`. Dot divs drop inline hover/active color classes — CSS is the source of truth.
- `TodayCard` uses a single DOM for `tall` + `medium` so the 2×2 stats grid and the summary line can crossfade via `opacity + max-h + scale` (200ms ease-out). `compact` stays its own branch because flex-direction flips to row.
- `bottomZoneContent` outer has `overscrollBehavior: 'contain'` + `scroll-smooth` so inner list scroll doesn't bubble into the page.

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
- **`loading.tsx`**: every server-rendered page with non-trivial data fetch MUST have a sibling `loading.tsx` exporting a skeleton — without it Next.js shows a blank screen on cold renders. Use `.skeleton-shimmer rounded-2xl` blocks (class lives in `globals.css`). Existing files: `master-admin/`, `billing/`, `payroll/`, `residents/`, `settings/`, `analytics/`, `log/`, `dashboard/`. Skeleton shape should roughly match the page (header bar + content cards/rows).
- **`unstable_cache` registry** (existing wrapped queries):
  - `master-admin/page.tsx` — `getCachedFacilityInfos(yearMonthKey)`: keyParts `['master-admin-facility-infos']`, `revalidate: 300`, tag `'facilities'`. The function arg `yearMonthKey` (e.g. `'2026-04'`) auto-rotates the cache when the calendar month flips so `bookingsThisMonth` stays correct.
  - `master-admin/page.tsx` — `getCachedPendingAccessRequests()`: keyParts `['master-admin-pending-access-requests']`, `revalidate: 60`, tag `'access-requests'`.
  - `super-admin/reports/{outstanding,monthly}/route.ts` — keyParts include facilityIds + month, `revalidate: 300`, tag `'bookings'`.
  - `billing/summary/[facilityId]/route.ts` — `getBillingSummaryData(facilityId, from, to)`: keyParts `['billing-summary']`, `revalidate: 120`, tag `'billing'`. Busted by `revalidateTag('billing', {})` in save-check-payment, Stripe webhook, and reconcile routes. **Row limits**: 500 invoices, 200 payments. **Default date range**: current month (API always filters by date range — no unbounded all-history fetch). DB indexes: `qb_invoices_facility_date_idx (facility_id, invoice_date DESC)`, `qb_payments_facility_date_idx (facility_id, payment_date DESC)`, `residents_facility_active_idx (facility_id) WHERE active = true`.
- **Cache tags in use**: `'bookings'`, `'pay-periods'`, `'billing'`, `'facilities'`, `'access-requests'`. Always call `revalidateTag('<tag>', {})` (Next.js 16 second-arg signature) on the success path of any mutation that affects cached data.
- **`'facilities'` revalidation**: every facility mutation MUST call `revalidateTag('facilities', {})` — already wired on `POST /api/facilities`, `PUT /api/facility`, `PATCH /api/facilities/[facilityId]/rev-share`, `POST /api/super-admin/merge-facilities`, `POST /api/super-admin/import-quickbooks`, `POST /api/super-admin/import-facilities-csv`.
- **`'access-requests'` revalidation**: `POST /api/access-requests`, `PUT /api/access-requests/[id]` (approve + deny paths).
- **Parallel `Promise.all` in `page.tsx`**: data fetches that don't depend on each other MUST be wrapped in `Promise.all([...])`. When a query depends on `facilityUser.facilityId`, keep it sequential (don't try to parallelize through it). The billing page uses a conditional `Promise.all` to skip `getUserFacility` for master admins (they don't need a facilityUser).
- **`force-dynamic` is redundant** when a route uses `cookies()`, `getUserFacility()`, or `request.nextUrl.searchParams` — Next.js auto-detects dynamic from those. Only keep `export const dynamic = 'force-dynamic'` on routes that have `maxDuration` set, on `scan-check` / `save-check-payment` / QB sync routes, and on family/portal pages.
- **DB pool** (`src/db/index.ts`): `max: 1`, `idle_timeout: 20`, `connect_timeout: 10`, `prepare: false`. Do not raise `max` above 1 in transaction-mode pgBouncer. Do not lower `connect_timeout` below 10.
- **Drizzle migrations**: `drizzle.config.ts` reads `DIRECT_URL` (with `DATABASE_URL` fallback). `drizzle-kit push` should always go through the direct connection, not pgBouncer.

### Cron Routes
- Every route under `/api/cron/*` MUST check: `request.headers.get('authorization') === \`Bearer ${process.env.CRON_SECRET}\`` — 401 otherwise
- `src/middleware.ts` already includes `pathname.startsWith('/api/cron')` in the public-route check — new cron routes need no further middleware work
- Register in `vercel.json` → `crons[]` with `{ path, schedule }`
- Cron routes set `export const maxDuration = 60` + `export const dynamic = 'force-dynamic'`

### Debug Role Impersonation (Super Admin Only)
- Cookie name: `__debug_role` — `httpOnly: false` (client badge reads it via `document.cookie`), `sameSite: lax`, `path: /`, 8-hour `maxAge`. Value: JSON `{ role: 'admin' | 'stylist'; facilityId: string; facilityName: string }`
- Gate: BOTH API routes (`POST /api/debug/impersonate`, `POST /api/debug/reset`) check `user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL` — 403 otherwise. Never expose to non-master users
- `getUserFacility()` reads `__debug_role` first — if present, returns a synthetic facilityUser object; skips DB entirely. This means ALL API routes and pages automatically see the impersonated role/facilityId without any per-route changes
- `(protected)/layout.tsx` independently reads the cookie to override `activeRole` + `facilityName` sent to Sidebar (layout doesn't use `getUserFacility`)
- `DebugBadge` (`src/components/debug/debug-badge.tsx`): client component, reads `document.cookie` on mount, renders fixed amber pill at **`top-4 right-4 z-[200]`** (top-right corner, always visible above all other chrome). Shows "Debug · {role} · {facilityName}" + "← Exit to Master Admin" button. Reset POSTs `/api/debug/reset` then does `window.location.href = '/master-admin'` (hard redirect, NOT `router.refresh()`). No `useRouter` import needed.
- Sidebar (`src/components/layout/sidebar.tsx`): `debugMode?: boolean` prop — when true, shows amber "DEBUG MODE" chip below the facility name. **Super Admin nav link is hidden when `debugMode === true`** (`&& !debugMode` added to the email check) so the simulated role is fully faithful
- `MobileNavProps` accepts `debugMode?: boolean` (unused — no Super Admin link in mobile nav — but passed from layout for API consistency)
- Debug tab (`src/app/(protected)/master-admin/debug-tab.tsx`): last tab in super-admin, three action rows (Admin View / Stylist View / Family Portal). **Persistent status block** always shown at top — amber dot + role/facility when impersonating, emerald dot + "Master Admin (normal)" when clean. `useEffect` adds `visibilitychange` listener so status updates on tab focus-return. Family Portal row opens `/family/[facilityCode]` in new tab (no cookie involved)
- "Resident Portal" row in debug tab is only enabled when selected facility has a `facilityCode` — required for the `/family/` URL

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
- **Phase 12** — Advanced KPI Dashboard: no schema changes, new metrics (cancellation rate, avg ticket, utilization, concentration risk, MoM/YoY), region filtering, weekly email digest, PDF export
- **Phase 13** — Facility Contact Portal: `facility_contact` role, `service_change_requests` table (add_day|cancel_day|…), restricted nav (Schedule read-only, Visit Summaries, Invoices, Submit Request)
- **Phase 14** — QuickBooks Polish: automated retry-with-backoff worker for transient failures, optional invoice push for non-Stripe facilities. (`quickbooks_sync_log` audit table shipped in Phase 11N.)
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
