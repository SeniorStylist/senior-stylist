# Senior Stylist — Master Specification

> Generated from the repository state. Version pins reflect `package.json` at documentation time.

---

## Project overview

**Senior Stylist** is a web application for **senior living facilities** to run **in-house salon operations**: scheduling appointments on a shared calendar, tracking **residents** and **stylists**, managing **services** and pricing, recording **daily operational logs**, and (where configured) handling **payments** and **reporting**. Staff authenticate via **Supabase**; residents can use a **token-based portal** (`/portal/[token]`) to view bookings and book services, subject to facility payment settings.

---

## Current tech stack

| Layer | Technology (exact versions from `package.json`) |
|--------|------------------------------------------------|
| Framework | **Next.js `16.1.6`** (App Router) |
| UI | **React `19.2.3`**, **Tailwind CSS `4`** (`tailwindcss`, `@tailwindcss/postcss`) |
| Auth & backend DB | **Supabase** — `@supabase/ssr` + `@supabase/supabase-js` (native Supabase Auth; session via cookies in `middleware.ts`) |
| Data access | **Drizzle ORM `0.45.1`** with **`postgres` `3.4.8`** driver (`drizzle-kit` for migrations) |
| Calendar UI | **FullCalendar `6.1.20`** (`@fullcalendar/react`, `@fullcalendar/*` plugins) |
| Payments | **Stripe `20.4.1`** (Checkout sessions + webhook) |
| Email | **Resend `6.9.4`** (direct HTTP API in invite flow; booking confirmation email path in `src/app/api/bookings/route.ts`) |
| Integrations | **Google Calendar** via **`googleapis` `171.4.0`** (sync helpers under `src/lib/google-calendar/`) |
| Validation | **Zod `4.3.6`** |
| Parsing / export | **PapaParse `5.5.3`**, **xlsx `0.18.5`** |
| Charts | **Recharts `3.8.0`** |
| Dates | **date-fns `4.1.0`** |

---

## Role-based access

### Types (`src/types/index.ts`)

- **`UserRole`**: `’admin’ | ‘stylist’ | ‘viewer’` — used for **profile** typing.
- **`FacilityUserRole`**: `’admin’ | ‘stylist’` — TypeScript type for facility-scoped roles (the **`facility_users.role`** column is plain `text` in Drizzle; the UI also recognizes **`viewer`** and **`super_admin`** for navigation).

### Facility membership (`facility_users`)

- Each authenticated user’s access to a facility is stored in **`facility_users`** (`user_id`, `facility_id`, **`role`**).
- The **active facility** is chosen via the **`selected_facility_id`** cookie (`getUserFacility()` / `POST /api/facilities/select`).

### Franchise system

- **`franchises`** table: `id`, `name`, `owner_user_id` (FK → `profiles`), timestamps.
- **`franchise_facilities`** join table: `franchise_id` + `facility_id` composite PK, CASCADE on both FKs.
- When a franchise is created/updated, `facilityUsers` rows are upserted for the franchise owner with `role = ‘super_admin’` on all included facilities.
- **`layout.tsx`** detects `super_admin` role and filters the facility switcher to only show facilities in the user’s franchise.
- **API routes**: `GET /api/super-admin/franchises`, `POST /api/super-admin/franchises`, `PUT /api/super-admin/franchises/[id]`, `DELETE /api/super-admin/franchises/[id]` — all guarded by `NEXT_PUBLIC_SUPER_ADMIN_EMAIL`.
- **Master admin UI**: `/super-admin` page has a Franchises section with create, edit (inline), delete (confirm) flows.

### Navigation (primary UX contract) — `src/components/layout/sidebar.tsx`

| Area | `admin` | `stylist` | `viewer` |
|------|---------|-----------|----------|
| **Calendar** (`/dashboard`) | ✓ | ✓ | ✓ |
| **Residents** (`/residents`) | ✓ | — | ✓ |
| **Stylists** (`/stylists`) | ✓ | — | — |
| **Services** (`/services`) | ✓ | — | — |
| **Daily Log** (`/log`) | ✓ | ✓ | — |
| **Reports** (`/reports`) | ✓ | — | — |
| **Settings** (`/settings`) | ✓ | — | — |
| **My Account** (`/my-account`) | ✓ | ✓ | ✓ |

- Users with role **`viewer`** see a **”View Only”** badge in the sidebar.
- **`/reports`** server page redirects non-admins to **`/dashboard`** (`src/app/(protected)/reports/page.tsx`).

### Route-level guards (server page components, OUTSIDE try/catch)

| Route | Guard |
|-------|-------|
| `/stylists`, `/services`, `/reports`, `/settings` | `facilityUser.role !== 'admin'` → redirect `/dashboard` |
| `/residents` | `facilityUser.role === 'stylist'` → redirect `/dashboard` |

### Stylist role behavior

- **Dashboard mobile**: shows today-list filtered to own bookings via `profileStylistId` (looked up from `profiles.stylistId`).
- **Daily Log**: filtered to own stylist section only (via `stylistFilter` prop from page.tsx).
- **Inline editing**: can edit price and notes on own bookings. Edit button gated by `stylistFilter` match + not finalized + not cancelled.
- **API ownership guard**: `PUT /api/bookings/[id]` checks `profiles.stylistId` against `existing.stylistId` — stylists can only edit their own bookings (403 otherwise).
- **`PUT /api/bookings/[id]`** accepts `priceCents: number` directly in the update schema. A direct `priceCents` override takes precedence over service-change-derived price.

### Dashboard & settings flags

- **`isAdmin`** is `facilityUser.role === 'admin'` on the dashboard (`src/app/(protected)/dashboard/page.tsx`): non-admins do not get admin-only panel actions (e.g. add residents / services / stylists from the dashboard panels).
- Settings UI receives **`isAdmin`**; non-admins cannot use admin-only tabs/actions (`src/app/(protected)/settings/settings-client.tsx`).

### API enforcement (explicit checks in code)

These routes require **`facility_users.role === 'admin'`**:

- `PUT /api/facility` — update facility settings (including `payment_type`, calendar id, timezone).
- `GET` / `POST /api/invites`, `DELETE /api/invites/[id]`.
- `GET /api/reports/invoice`.
- `POST /api/reports/mark-paid`.

Many other authenticated routes only require a valid **facility user** and **do not** check `viewer` vs `stylist` for write operations — authorization for those roles is primarily expressed in **navigation and page-level** behavior.

### Special cases

- **`NEXT_PUBLIC_SUPER_ADMIN_EMAIL`**: if the signed-in user’s email matches, middleware skips the “must have `facility_users` or pending invite” check (`src/middleware.ts`).
- **`invite/accept`**: public route for redeeming invites (see `src/app/invite/accept/page.tsx`). Server component validates token; if authenticated, redeems immediately. If NOT authenticated, renders `InviteAcceptClient` — a self-contained auth page offering magic link (OTP) and Google OAuth. Token preserved through auth via `emailRedirectTo` / `redirectTo` → `/auth/callback?next=/invite/accept?token=X`.
- **`getSuperAdminFacilities(userId, userEmail)`** (`src/lib/get-super-admin-facilities.ts`): role-aware scope helper used by all `/api/super-admin/reports/*` routes. If `userEmail === NEXT_PUBLIC_SUPER_ADMIN_EMAIL`, returns all active facility IDs. Otherwise returns only facility IDs from the user’s franchise(s) via `franchise_facilities` join.

---

## Database schema (Drizzle — `src/db/schema.ts`)

### `profiles`

| Column | Notes |
|--------|--------|
| `id` | PK `uuid` (matches auth user id) |
| `email`, `full_name`, `avatar_url` | Optional text |
| `role` | `text`, default **`'stylist'`** |
| `stylist_id` | Optional FK → `stylists.id` |
| `created_at`, `updated_at` | Timestamps |

### `facilities`

| Column | Notes |
|--------|--------|
| `id` | PK `uuid`, default random |
| `name` | Required |
| `address`, `phone`, `calendar_id` | Optional |
| `timezone` | Default **`America/New_York`** |
| `payment_type` | `text`, default **`facility`**; API updates allow **`facility` \| `ip` \| `rfms` \| `hybrid`** |
| `stripe_publishable_key` | Optional text — per-facility Stripe publishable key |
| `stripe_secret_key` | Optional text — per-facility Stripe secret key (falls back to env var) |
| `working_hours` | `jsonb`, nullable — `{ days: string[], startTime: "HH:MM", endTime: "HH:MM" }`; null = default 08:00–18:00; set via Settings → General; bounds booking time slots |
| `contact_email` | Optional text — facility-specific reply-to for access request emails; falls back to first admin's email |
| `active` | Boolean, default true |
| `created_at`, `updated_at` | Timestamps |

### `facility_users` (composite PK)

- **`user_id`** → `profiles.id`, **`facility_id`** → `facilities.id`
- **`role`**: `text`, default **`stylist`**
- **`created_at`**
- Unique primary key: **`(user_id, facility_id)`**

### `residents`

- **`facility_id`** → `facilities`
- **`name`**, **`room_number`**, **`phone`**, **`notes`**
- **`portal_token`**: unique text (resident portal)
- **`default_service_id`**: optional FK → `services.id` — auto-set after 3+ completed bookings with same service; also manually settable on resident detail page
- **`poa_name`**, **`poa_email`**, **`poa_phone`**, **`poa_payment_method`**: nullable text — Power of Attorney info. Editable on resident detail page. `poa_payment_method` one of: `cash | check | credit card | facility billing | insurance`. POA badge on resident list when `poa_name` is set.
- **`active`**, **`created_at`**, **`updated_at`**
- Unique constraint: **`(name, facility_id)`**

### `stylists`

- **`facility_id`** → `facilities`
- **`name`**, **`color`** (default `#0D7377`), **`commission_percent`** (int, default 0)
- **`active`**, timestamps

### `services`

- **`facility_id`** → `facilities`
- **`name`**, **`description`**, **`price_cents`**, **`duration_minutes`** (default 30), **`color`**, **`category`** (nullable text), **`active`**, timestamps
- **`pricing_type`**: text, NOT NULL, default `'fixed'` — one of `fixed` \| `addon` \| `tiered` \| `multi_option`
- **`addon_amount_cents`**: integer, nullable — add-on surcharge for `addon` type
- **`pricing_tiers`**: jsonb, nullable — array of `{ minQty, maxQty, unitPriceCents }` for `tiered` type
- **`pricing_options`**: jsonb, nullable — array of `{ name, priceCents }` for `multi_option` type

### `bookings`

- FKs: **`facility_id`**, **`resident_id`**, **`stylist_id`**, **`service_id`**
- **`start_time`**, **`end_time`** (timestamptz)
- **`price_cents`**, **`duration_minutes`**, **`notes`**
- **`status`**: default **`scheduled`** (app types: `scheduled` \| `completed` \| `cancelled` \| `no_show`)
- **`payment_status`**: default **`unpaid`** (API accepts `unpaid` \| `paid` \| `waived`)
- **`cancellation_reason`**
- **`recurring`**: boolean, default false
- **`recurring_rule`**: `text` (`weekly` \| `biweekly` \| `monthly`)
- **`recurring_end_date`**: `date`
- **`recurring_parent_id`**: optional FK → `bookings.id` (self-referential)
- **`selected_quantity`**: integer, nullable — quantity chosen for `tiered` bookings
- **`selected_option`**: text, nullable — option name chosen for `multi_option` bookings
- **`addon_service_ids`**: text[], nullable — list of addon-type service IDs applied to this booking
- **`addon_total_cents`**: integer, nullable — sum of add-on surcharges included in `price_cents`
- **`service_ids`**: text[], nullable — ordered list of PRIMARY service IDs for multi-service bookings (first = "the primary"). Old single-service bookings leave this null and keep using `service_id`.
- **`service_names`**: text[], nullable — denormalized service names parallel to `service_ids` for display without re-querying
- **`total_duration_minutes`**: integer, nullable — sum of all primary services' durations (addons never add duration). Used for endTime + conflict detection on multi-service bookings.
- **`google_event_id`** (unique), **`sync_error`**
- Timestamps
- **`price_cents` is ALWAYS the final fully-resolved total** including add-ons, tier calculation, or option price — never a partial amount

### `invites`

- **`facility_id`**, **`email`**, **`invite_role`** (default **`stylist`**), **`invited_by`** → `profiles`
- **`token`** (unique), **`used`**, **`created_at`**, **`expires_at`**

### `log_entries`

- **`facility_id`**, **`stylist_id`**, **`date`** (date), **`notes`**
- **`finalized`**, **`finalized_at`**
- Timestamps
- Unique: **`(facility_id, stylist_id, date)`**

### `access_requests`

| Column | Notes |
|--------|--------|
| `id` | PK `uuid`, default random |
| `facility_id` | Optional FK → `facilities.id` — `null` when submitted (global queue); filled in when super admin approves |
| `email` | Required |
| `full_name` | Optional text |
| `status` | `text`: `'pending'` \| `'approved'` \| `'denied'` |
| `role` | `text`: requested role (`stylist` \| `admin` \| `viewer`) |
| `user_id` | Optional FK → `profiles.id` — the Supabase auth UID at submission time |
| `created_at`, `updated_at` | Timestamps |

### Declared relations

Drizzle `relations()` connect bookings ↔ resident/stylist/service/facility; facilities ↔ facility_users, residents, stylists, services, bookings, log_entries, invites; invites ↔ facility, invited profile; log_entries ↔ facility, stylist.

---

## Route groups & main pages

### `(protected)` — `src/app/(protected)/`

Authenticated app shell: sidebar (`Sidebar`), mobile nav, toast provider (`layout.tsx`).

| Path | Purpose |
|------|---------|
| `/dashboard` | FullCalendar-based scheduling; staff panels (residents, services, stylists) when admin |
| `/residents` | Resident list, stats, add resident |
| `/residents/import` | CSV/XLSX import flow |
| `/residents/[id]` | Resident detail |
| `/stylists` | Stylist list |
| `/stylists/[id]` | Stylist detail, revenue/commission views |
| `/services` | Service catalog |
| `/log` | Daily log (bookings + per-stylist notes, finalize / walk-in) |
| `/reports` | **Admin-only** (redirect for others) — monthly analytics |
| `/settings` | Facility settings, users, invites (admin-only sections gated in client) |

### `(resident)` — `src/app/(resident)/`

| Path | Purpose |
|------|---------|
| `/portal/[token]` | Resident portal UI (`portal-client.tsx`): services, stylists, booking slots, Stripe checkout when `payment_type` is `ip` or `hybrid` |

Layout: branded header “Senior Stylist — Resident Portal” (`layout.tsx`).

### Other notable app routes (not under those groups)

| Path | Purpose |
|------|---------|
| `/` | Redirects to **`/dashboard`** |
| `/login` | Login (public) |
| `/invite/accept` | Invite redemption (public) |
| `/unauthorized` | No facility access (public); submits access request (name + role, no facility picker) |
| `/invoice/[facilityId]` | Printable invoice view for a facility/month (`searchParams.month`) |
| `/my-account` | Profile page; link own profile to stylist record; shows welcome banner on first visit after invite accept |
| `/super-admin` | Super admin only; 4-tab interface: **Facilities** (CRUD + deactivate), **Franchises** (create/edit/delete), **Requests** (pending access request queue — assign facility + approve/deny), **Reports** (cross-facility revenue reporting via `ReportsTab` component). Tab navigation uses `activeTab` state with `bg-[#0D7377] text-white` active pill. |

### Middleware & auth (`src/middleware.ts`)

- **Public** (no Supabase session required): `/login`, `/auth`, `/unauthorized`, `/invite/accept`, `/portal/*`, `/api/portal/*`, `/invoice/*`.
- All other matched paths require a **logged-in** Supabase user.
- Authenticated users with no `facilityUser` are redirected to `/unauthorized` **except** when navigating to `/onboarding` or `/invite` — those bypass the redirect so invite/onboarding flows work.
- **`NEXT_PUBLIC_SUPER_ADMIN_EMAIL`** bypasses the "must have facilityUser" check in middleware.

---

## Core features implemented

The codebase does **not** label “Phase 1–12”; the following are **observable capabilities** from the current implementation.

- **Staff calendar**: FullCalendar on `/dashboard`; bookings CRUD via `/api/bookings` and `/api/bookings/[id]`; conflict detection for stylist overlap.
- **Google Calendar sync**: Optional sync of unsynced scheduled bookings to a facility `calendar_id` (`POST /api/bookings/sync`, `src/lib/google-calendar/`), with `google_event_id` / `sync_error` on bookings.
- **Google Calendar sync — per-stylist (planned Phase 6)**: `stylists.calendar_id` and `stylists.google_refresh_token` columns (not yet added); OAuth flow per stylist via My Account page; stylist bookings sync to their personal calendar only; facility calendar continues receiving all bookings.
- **Booking email**: Confirmation email via Resend when creating bookings (`src/app/api/bookings/route.ts`).
- **Residents**: CRUD, per-resident stats, `portal_token` on create, bulk insert (`/api/residents/bulk`), import UI (`papaparse` / `xlsx`).
- **Stylists & services**: CRUD APIs and admin-navigated pages; **commission** on stylists used in reports/stylist detail.
- **Daily log**: Day-scoped bookings + `log_entries` with notes, finalize, walk-in booking (`/api/log`, `/api/log/[id]`). **Smart OCR import**: `POST /api/log/ocr` accepts multipart `images[]` (multiple files), processes each with Gemini 2.0 Flash, extracts `{ date, stylistName, entries[] }` per sheet, returns `{ data: { sheets: [...] } }`. `POST /api/log/ocr/import` creates missing residents + services + completed bookings in one `db.transaction()`. UI: `OcrImportModal` 3-step flow (upload thumbnails → review per-sheet with duplicate detection → confirm summary).
- **Reports**: Monthly aggregates (`/api/reports/monthly`), charts in UI (`recharts`), CSV export (`/api/export/billing` with `?month=`).
- **Cross-facility reporting (Phase 4)**: Super-admin Reports tab in `/super-admin`. `getSuperAdminFacilities()` helper scopes to master admin (all) or franchise owner (their facilities). Monthly bar chart + per-facility cards. Outstanding balances view with facility-grouped checkboxes and bulk/individual mark-paid. Cross-facility CSV export. Booking mutations (`POST /api/bookings`, `PUT /api/bookings/[id]`, `DELETE /api/bookings/[id]`) call `revalidateTag('bookings', {})` to invalidate the 5-min cache.
- **Invoices**: Admin API (`/api/reports/invoice`), printable **`/invoice/[facilityId]`** page.
- **Payments**: Facility `payment_type` includes **`facility`**, **`ip`**, **`rfms`**, **`hybrid`**; Stripe Checkout for portal (`/api/portal/[token]/checkout`), webhook marks bookings paid (`/api/webhooks/stripe`); admin bulk mark-paid (`/api/reports/mark-paid`).
- **Resident portal**: Token APIs — portal data (`GET /api/portal/[token]`), stylists, services, available times, book, checkout.
- **Invites**: Create/list/delete invites, email via Resend (`/api/invites`), accept flow (`/invite/accept`), first-time setup (`/api/admin/setup`).
- **Stats**: `GET /api/stats` — aggregated booking counts/revenue for today/week/month.
- **Multi-facility**: `GET /api/facilities`, `POST /api/facilities` (creator becomes admin), `POST /api/facilities/select` sets cookie.
- **PWA**: `src/app/icon.tsx` + `apple-icon.tsx` (ImageResponse, burgundy #8B2E4A brand color), `manifest.ts` (Next.js MetadataRoute.Manifest), install banner (`src/components/pwa/install-banner.tsx`).
- **Super admin CRUD**: `/super-admin` page supports inline edit (name/address/phone/timezone/paymentType) and deactivate/reactivate (2-step confirm) per facility card. Edit calls `PUT /api/super-admin/facility/[id]`. Facility name uniqueness enforced (409) on both create and edit.
- **Onboarding flow**: new users with valid invite redirect to `/onboarding` (not dashboard error); middleware allows `/onboarding` for users with no facilityUser.
- **Recurring appointments**: `recurring`, `recurring_rule`, `recurring_end_date`, `recurring_parent_id` on bookings; `POST /api/bookings/recurring` creates parent + children; `cancelFuture` param on PUT `/api/bookings/[id]` cancels this + future; ↻ indicator on calendar events.
- **Resident default service**: `default_service_id` on residents; auto-set after 3+ completed bookings with same service; pre-selected in booking modal and FAB; badge on resident detail page.
- **Single booking UI**: `booking-modal.tsx` is the sole booking flow across desktop + mobile. `useIsMobile()` switches the outer shell between `<Modal>` and `<BottomSheet>`; the form body is shared. `QuickBookFAB` (`src/components/calendar/quick-book-fab.tsx`) is a pure `md:hidden` FAB button with a single `onOpen` prop; dashboard wires it to `openQuickCreate()` which picks the next 30-min slot from now and routes through `openCreateModal(start, end)`. Calendar slot-select goes through the same entrypoint. All pricing-UI features (addon checklist, tiered stepper, multi-option select, price breakdown) work automatically on mobile.
- **Service picker grouping**: booking-modal primary service `<select>` uses `<optgroup>` keyed on `service.category` (fallback `'Other'`). The addon checklist uses text sub-headers by category. Single-category services render flat (no wrapper). Services list page interleaves category section headers between rows (sorted alphabetical, "Other" last).
- **Onboarding wizard**: `/onboarding` — 6-step wizard (Welcome → Facility → Stylist → Services → Residents → Done); each content step (2–5) shows progress dots + skip links. Step 4 (Services) supports PDF/CSV/Excel import via `/api/services/parse-pdf` + `/api/services/bulk`. Step 5 (Residents) supports CSV/Excel import via `/api/residents/bulk`. Step 6 (Done) shows a setup summary (facility name, stylists/services/residents counts). Progress bar = `(step / 6) * 100`.
- **Phase 16 — Production UX**: NavigationProgress (2px teal bar on route change) in `src/components/ui/navigation-progress.tsx`; mobile-nav tap feedback (active:scale-95 + teal dot); stylist mobile dashboard shows today's appointment list with one-tap Mark Done instead of FullCalendar; log page stylist sections are collapsible; working_hours jsonb column on facilities controls booking time slot bounds (Settings → General tab; day checkboxes + start/end selects); invite accept auto-links stylist profile by ilike name match and redirects to `/my-account?welcome=1`; My Account shows welcome banner on first visit.

---

## Security

### Row Level Security (RLS)

RLS is **enabled on all 10 tables** as of March 2026. Each table has a single `service_role_all` policy:

```sql
CREATE POLICY "service_role_all" ON <table>
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

| Table | RLS | Policy |
|-------|-----|--------|
| `profiles` | ✓ | service_role_all |
| `facilities` | ✓ | service_role_all |
| `facility_users` | ✓ | service_role_all + authenticated_own_facility_users (SELECT, `user_id = auth.uid()`) |
| `residents` | ✓ | service_role_all |
| `stylists` | ✓ | service_role_all |
| `services` | ✓ | service_role_all |
| `bookings` | ✓ | service_role_all |
| `log_entries` | ✓ | service_role_all |
| `invites` | ✓ | service_role_all + authenticated_own_invites (SELECT, `email = auth.jwt()->>'email'`) |
| `access_requests` | ✓ | service_role_all |

**Why this works without breaking queries:** All server-side Drizzle queries run with `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS automatically. The anon key (used only for Supabase Auth client-side) has no direct table access — **except** for `facility_users` and `invites`, which have scoped `authenticated` SELECT policies so that middleware can query them.

**New table checklist:** Any new table must have `ALTER TABLE x ENABLE ROW LEVEL SECURITY` + the `service_role_all` policy added immediately after creation. If middleware needs to query the table, also add a scoped `authenticated` SELECT policy.

---

## API directory (`src/app/api/`)

| Route | Role / auth | Purpose |
|-------|-------------|---------|
| `GET/POST /api/bookings` | Authenticated | List/create bookings (query `start`/`end`); sends confirmation email on create. POST accepts optional `selectedQuantity`, `selectedOption`, `addonChecked` for flexible pricing — server resolves final price via `resolvePrice()`. Also accepts `serviceIds: string[]` for multi-service bookings (first = primary); `serviceId` is still accepted for single-service callers. Server populates `service_ids`, `service_names`, `total_duration_minutes` and sets `service_id = serviceIds[0]` |
| `POST /api/bookings/recurring` | Authenticated | Create parent + child recurring bookings; returns `{ parentId, count }`. Accepts same pricing + multi-service fields as POST /api/bookings |
| `GET/PUT/DELETE /api/bookings/[id]` | Authenticated | Single booking; updates sync Google Calendar when configured; supports `payment_status` |
| `POST /api/bookings/sync` | Authenticated | Push unsynced scheduled bookings to Google Calendar |
| `GET /api/stats` | Authenticated | Today / week / month totals |
| `GET/POST /api/log` | Authenticated | Day log + log entries |
| `PUT /api/log/[id]` | Authenticated | Update log entry notes / finalized |
| `POST /api/log/ocr` | Authenticated | Accept `images[]`, extract `{ date, stylistName, entries[] }` per sheet via Gemini 2.5 Flash, return `{ data: { sheets } }`. Each entry includes `additionalServices: string[]` when the handwriting lists multiple services joined by `+`/`/`/`&`/`and`/`,` |
| `POST /api/log/ocr/import` | **Admin** | Create missing residents + services + multi-service completed bookings from reviewed sheets in one `db.transaction()`; bookings spaced 30 min from 09:00 UTC. Accepts `additionalServiceIds: (string \| null)[]` + `additionalServiceNames: string[]` per entry; resolves each via the 3-step fuzzy-match algorithm and stores all IDs in `service_ids` |
| `GET/POST /api/residents` | Authenticated | List/create residents (portal token on create) |
| `GET/PUT/DELETE /api/residents/[id]` | Authenticated | Single resident |
| `POST /api/residents/bulk` | Authenticated | Bulk insert residents (conflict skip on name+facility) |
| `GET/POST /api/stylists` | Authenticated | List/create stylists |
| `GET/PUT/DELETE /api/stylists/[id]` | Authenticated | Single stylist |
| `GET/POST /api/services` | Authenticated | List/create services. POST accepts `pricingType`, `addonAmountCents`, `pricingTiers`, `pricingOptions` with `.refine()` validation |
| `GET/PUT/DELETE /api/services/[id]` | Authenticated | Single service. PUT accepts same pricing fields as POST |
| `POST /api/services/bulk` | Authenticated | Bulk insert services (conflict skip on name+facility) |
| `POST /api/services/bulk-update` | Authenticated | Bulk update `color` or `active` for a set of service IDs scoped to facility |
| `POST /api/services/parse-pdf` | Authenticated | Extract services from a PDF price sheet using **Gemini 2.5 Flash** vision (PDF sent as native `application/pdf` inlineData). No text extraction or regex — Gemini reads the visual layout. Returns `name, priceCents, durationMinutes, category, color, pricingType, addonAmountCents, pricingTiers, pricingOptions`. Switched from pdfjs-dist alternating-chunks parser because PDF text streams are unreliable (Symphony Manor first section was invisible to text extraction) |
| `PUT /api/profile` | Authenticated | Update `stylist_id` on own profile (used by My Account link-stylist selector) |
| `GET/PUT /api/facility` | Authenticated; **PUT admin** | Current facility; update settings (incl. `stripePublishableKey`, `stripeSecretKey`) |
| `GET/POST /api/facilities` | Authenticated | List user’s facilities; create facility (creator = admin) |
| `POST /api/facilities/select` | Authenticated | Set `selected_facility_id` cookie |
| `POST/GET /api/invites` | **Admin** | Create invite; list invites. POST deduplicates: if a pending invite already exists for email+facility, refreshes token/expiry and resends (returns `{ data, refreshed: true }`); if a used invite exists returns 409 "This person already has access to this facility"; otherwise inserts new. Fires invite email via `sendEmail()` with branded HTML template (`buildInviteEmailHtml`). From: `noreply@seniorstylist.com` |
| `DELETE /api/invites/[id]` | **Admin** | Revoke unused invite + clean up pending access_requests for same email+facility + clear `profiles.stylist_id` if the revoked email has a stylist linked at this facility |
| `GET /api/invite/redeem` | Authenticated (no facilityUser needed) | Redeems invite: upserts profile, inserts facilityUser, marks invite used, sets `selected_facility_id` cookie, redirects. Bypasses middleware facilityUser check. |
| `DELETE /api/facility/users/[userId]` | **Admin** | Remove user's facility access. Guards: can't remove self, can't remove last admin. In a single transaction: deletes facilityUsers row, clears `profiles.stylist_id` (frees the stylist record for re-linking), marks pending invites for that email+facility as `used=true`. Then invalidates Supabase session via admin signOut. |
| `POST /api/invites/[id]/resend` | **Admin** | Re-send invite email for unused, non-expired invites. Uses same branded template. |
| `GET /api/reports/monthly` | Authenticated | Monthly report payload |
| `GET /api/reports/invoice` | **Admin** | Completed bookings + payment status for invoice UI |
| `POST /api/reports/mark-paid` | **Admin** | Mark completed unpaid bookings paid for a month (or all) |
| `GET /api/export/billing` | Authenticated | CSV billing export for a month |
| `POST /api/webhooks/stripe` | Stripe signature | On `checkout.session.completed`, set booking `payment_status` to `paid` |
| `GET /api/portal/[token]` | **No session** (uses token) | Resident + bookings + facility payment type |
| `GET /api/portal/[token]/stylists` | Token | Active stylists for facility |
| `GET /api/portal/[token]/services` | Token | Active services |
| `GET /api/portal/[token]/available-times` | Token | Taken slots for a date |
| `POST /api/portal/[token]/book` | Token | Create booking |
| `POST /api/portal/[token]/checkout` | Token | Stripe Checkout session URL |
| `POST /api/admin/setup` | Authenticated | One-time seed: facility, profile, services, residents, stylist if user has no facility |
| `PUT /api/super-admin/facility/[id]` | Super admin email only | Edit any facility's name/address/phone/timezone/paymentType/active — returns 409 on duplicate name |
| `DELETE /api/super-admin/facility/[id]` | Super admin only | Hard delete facility (requires no bookings); wrapped in db.transaction() |
| `GET /api/super-admin/reports/monthly?month=YYYY-MM` | Super admin | Per-facility aggregate for a month: appointmentCount, totalRevenueCents (COALESCE booking/service price), unpaidCount, unpaidRevenueCents. Cached 5 min via `unstable_cache`, tag `bookings`. |
| `GET /api/super-admin/reports/outstanding` | Super admin | All completed + unpaid bookings across authorized facilities with resident/stylist/service/facilityName. Cached 5 min via `unstable_cache`, tag `bookings`. |
| `POST /api/super-admin/reports/mark-paid` | Super admin | Mark bookingIds as paid. Verifies every booking belongs to an authorized facility (403 otherwise). Calls `revalidateTag('bookings', {})`. |
| `GET /api/super-admin/export/billing?month=YYYY-MM` | Super admin | Cross-facility CSV export with Facility column prepended; per-facility subtotals; grand total row. Always fresh (`force-dynamic`). |
| `GET /api/facilities/admin-contact` | **Public** | Returns facility contact email (for `/unauthorized` mailto fallback). No facilityId param = returns `allFacilities` list. |
| `POST /api/access-requests` | **Public** | Submit access request; facilityId optional (null = global queue). Idempotent by email. Fires admin notification email to `NEXT_PUBLIC_ADMIN_EMAIL`. |
| `GET /api/access-requests` | **Facility admin** | Pending requests already assigned to their facility |
| `PUT /api/access-requests/[id]` | **Facility admin OR super admin** | Approve (with facilityId, role, optional commissionPercent) or deny. Approve provisions facilityUsers row + optional stylist record + fires approval email to requester. |

---

## Access Request Flow

New users without a facility hit `/unauthorized`. They submit name + role (no facility picker). The request goes into a global queue (`access_requests.facility_id = null`).

**Super admin** sees all pending requests at `/super-admin`, picks a facility + role + commission % per request, then approves. On approve:
1. `access_requests.status = 'approved'`, `facility_id` filled in
2. `facilityUsers` row inserted (userId → facilityId + role)
3. If role = stylist + commissionPercent: upsert stylist record by name match

**Facility admin** sees only requests assigned to their facility in Settings → Requests tab (for audit/history after super admin assigns).

---

## Types reference (`src/types/index.ts`)

- **`BookingStatus`**: `'scheduled' | 'completed' | 'cancelled' | 'no_show'`
- **Interfaces**: `Profile`, `Facility`, `Resident`, `Stylist`, `Service`, `Booking`, `BookingWithRelations`, `LogEntry`

Note: the Drizzle schema includes fields not mirrored on every TypeScript interface (e.g. **`payment_status`** on bookings and **`stylist_id`** on `profiles`); the database remains the source of truth for columns.

---

---

## Booking modal pricing UI (src/components/calendar/booking-modal.tsx)

- **Addon display**: addon-type service surcharge displayed as `(addonAmountCents ?? priceCents ?? 0)` at three sites: `multiAddonTotal` reduce, checklist label, breakdown line. Do NOT use `addonAmountCents ?? 0` — manual services store surcharge in `priceCents`.
- **Tiered stepper**: `<input type="number">` replaced with a 44px three-part stepper (`−` stone / count span / `+` teal). An IIFE below the stepper computes `activeTier` and renders a hint: `{min}–{max+}: $X each → $total`.
- **Breakdown annotations** (idx===0 primary service): IIFE computes a context-aware `nameLabel` — tiered shows `ServiceName (qty × $X/ea)`, multi_option shows `ServiceName — OptionName`, addon shows `ServiceName (+$X add-on)`. Addon checklist lines in breakdown use `text-amber-700`.
- **Service selector option text**: `` `${s.name} · ${formatPricingLabel(s)}` `` — no duration suffix. `formatPricingLabel` returns `+$X.00` for addon, `$X.00/unit` for tiered, `$X.00–$Y.00` for multi_option.

---

## Brain Files

The project brain consists of four files that must ALL be
updated at the end of every Claude Code session:

- CLAUDE.md — rules, conventions, common bugs to avoid
- docs/master-spec.md — full architecture and API reference
- docs/design-system.md — UI patterns and component rules
- docs/project-context.md — phases, current status, handoff info

These files are also uploaded to Claude Projects so the AI
assistant in chat always has full context.

*End of master specification.*
