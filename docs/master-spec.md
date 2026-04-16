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
- **`layout.tsx`** detects `super_admin` role (raw DB value) and filters the facility switcher to only show facilities in the user’s franchise. It then normalizes `activeRole` from `’super_admin’` to `’admin’` before passing to Sidebar/MobileNav.
- **`getUserFacility()` in `src/lib/get-facility-id.ts`** normalizes `’super_admin’` → `’admin’` at read time via a `normalizeRole()` helper. This means all page guards (`role !== ‘admin’`) and API guards automatically treat franchise owners as admins without per-call-site changes. The Super Admin page is gated by `NEXT_PUBLIC_SUPER_ADMIN_EMAIL` email match, not role — normalization does not affect that access.
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
- **`poa_notifications_enabled`**: `boolean NOT NULL DEFAULT true` — when `false`, POA confirmation emails are suppressed for both staff and portal bookings. Staff toggle in resident detail edit mode; self-serve toggle via `PATCH /api/portal/[token]/notifications` from portal preferences section.
- **`active`**, **`created_at`**, **`updated_at`**
- Unique constraint: **`(name, facility_id)`**

### `stylists`

- **`facility_id`** → `facilities`, **NULLABLE** (Phase 8.5) — `NULL` means franchise-pool (unassigned)
- **`franchise_id`** → `franchises`, NULLABLE (Phase 8.5) — scope for pool stylists and cross-facility reassignment
- **`stylist_code`** (text, NOT NULL, UNIQUE, Phase 8.5) — human ID matching `^ST\d{3,}$` (e.g. `ST001`). Generated server-side via `src/lib/stylist-code.ts` (`pg_advisory_xact_lock(9191)` serialization).
- **`name`**, **`color`** (default `#0D7377`), **`commission_percent`** (int, default 0)
- **`google_calendar_id`** (text, nullable) — personal Google Calendar ID after OAuth connect
- **`google_refresh_token`** (text, nullable) — OAuth refresh token; cleared on disconnect
- **`license_number`** (text, nullable), **`license_type`** (text, nullable), **`license_expires_at`** (date, nullable) — compliance mirrors, populated when admin verifies a license doc
- **`license_state`** (text, nullable) — which state(s) the stylist is licensed in (e.g. `"MD, VA"`); separate from `license_type`; editable in Stylist Detail "Licensed In" field; shown as `"MD • VA"` badge on the Stylists list
- **`insurance_verified`** (boolean, NOT NULL, default false), **`insurance_expires_at`** (date, nullable) — populated when admin verifies an insurance doc
- **`background_check_verified`** (boolean, NOT NULL, default false)
- **`email`** (text, nullable), **`phones`** (jsonb NOT NULL DEFAULT `[]`, type `Array<{label: string, number: string}>` — replaced `phone text`), **`address`** (text, nullable), **`payment_method`** (text, nullable) — contact/admin info imported from bookkeeping CSV; phones fully editable in Stylist Detail with label dropdown; **address and paymentMethod now editable** — address is a text `<input>`, paymentMethod is a `<select>` (Commission / Hourly / Flat Rate / Booth Rental); both wired into `isDirty` and saved via `handleSave → PUT /api/stylists/[id]`
- **`schedule_notes`** (text, nullable) — unmatched facility schedules from CSV import or Gemini parse fallback; shown in Stylist Detail below Availability card
- **`status`** (text, NOT NULL, default `'active'`, Phase 9) — lifecycle status; CHECK constraint `status IN ('active','inactive','on_leave','terminated')`. Separate from `active` (soft-delete). UI will render as a status badge in Prompt 2+.
- **`specialties`** (jsonb NOT NULL DEFAULT `[]`, Phase 9) — string tag list, e.g. `["color", "cut", "perm"]`
- **`last_invite_sent_at`** (timestamptz nullable, Phase 9 Prompt 4) — timestamp of the last successful Supabase Admin invite email sent from Stylist Detail. Used to enforce the 24h rate limit in `POST /api/stylists/[id]/invite`. Updated server-side after a successful invite; never trusted from client.
- **`active`**, timestamps

### `stylist_facility_assignments` (Phase 9)

Per-facility assignment rows for multi-facility stylists with optional per-facility commission override. A stylist may have N rows (one per facility they work at). Backfill of existing `stylists.facility_id` + `stylists.commission_percent` into this table is an explicit separate step — Prompt 1 only creates the schema.

**Phase 9 Prompt 3 made this the authoritative facility-scope mechanism** — `stylists.facility_id` is deprecated. Every facility-scoped stylist query (API routes, portal flows, coverage substitutes, compliance cron, booking guard, stylists list page, directory) joins `stylist_facility_assignments` with `active=true` and filters `stylists.status='active'` on booking surfaces. `stylists.facility_id` is retained as the franchise-pool marker (`IS NULL AND franchise_id = F`) and as a legacy-data fallback in the compliance cron. **Phase 9 Prompt 4**: backfill script seeded assignment rows from `stylists.facility_id` (2 rows inserted, `ON CONFLICT DO NOTHING`).

| Column | Notes |
|--------|-------|
| `id` | PK `uuid`, default random |
| `stylist_id` | FK → `stylists.id` ON DELETE CASCADE |
| `facility_id` | FK → `facilities.id` ON DELETE CASCADE |
| `commission_percent` | `integer`, **nullable** — `NULL` means "use `stylists.commission_percent` default". Zero is a valid explicit override. Resolved via `resolveCommission()` in `src/lib/stylist-commission.ts`. |
| `active` | Boolean NOT NULL default true |
| `created_at`, `updated_at` | Timestamps |
| Unique | `(stylist_id, facility_id)` |

### `stylist_notes` (Phase 9)

Admin-only internal notes attached to a stylist. Never exposed via portal or stylist-role routes. Hard delete is fine (no `active` column) — notes are mutable operational data.

| Column | Notes |
|--------|-------|
| `id` | PK `uuid`, default random |
| `stylist_id` | FK → `stylists.id` ON DELETE CASCADE |
| `author_user_id` | FK → `profiles.id` — admin who wrote the note |
| `body` | `text` NOT NULL |
| `created_at`, `updated_at` | Timestamps |

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

### `oauth_states`

| Column | Notes |
|--------|--------|
| `id` | PK `uuid`, default random |
| `nonce` | `text` unique — random UUID passed as `state` to Google OAuth |
| `user_id` | FK → `profiles.id` — caller who initiated the connect flow |
| `stylist_id` | FK → `stylists.id` — target stylist for the Google Calendar link |
| `created_at` | Timestamp; rows older than 10 minutes are treated as expired |

Used by `/api/auth/google-calendar/connect` + `/callback` to bind the OAuth callback to the authenticated user and prevent CSRF. Row is deleted atomically on successful callback.

### `compliance_documents`

| Column | Notes |
|--------|--------|
| `id` | PK `uuid`, default random |
| `stylist_id` | FK → `stylists.id` NOT NULL |
| `facility_id` | FK → `facilities.id` NOT NULL — all queries scope to this |
| `document_type` | `text` NOT NULL: `license` \| `insurance` \| `w9` \| `contractor_agreement` \| `background_check` |
| `file_url` | `text` NOT NULL — **Supabase Storage PATH** (`{facilityId}/{stylistId}/{type}-{ts}.{ext}`), NOT a URL; signed URLs regenerate per GET |
| `file_name` | `text` NOT NULL — original filename shown in UI |
| `expires_at` | `date`, nullable — required for license/insurance, ignored for tax/agreement docs |
| `verified` | `boolean` NOT NULL, default false |
| `verified_by` | FK → `profiles.id`, nullable — admin who verified |
| `verified_at` | `timestamp`, nullable |
| `uploaded_at` | `timestamp` NOT NULL, default now |
| `created_at` | `timestamp`, default now |

Storage bucket: **`compliance-docs`** — private (`public=false`), `fileSizeLimit: 10485760` (10 MB), `allowedMimeTypes: ['application/pdf','image/jpeg','image/png']`. All reads/writes go through service-role API routes — the service-role key never reaches the browser.

### `stylist_availability`

| Column | Notes |
|--------|--------|
| `id` | PK `uuid`, default random |
| `stylist_id` | FK → `stylists.id` NOT NULL |
| `facility_id` | FK → `facilities.id` NOT NULL |
| `day_of_week` | `integer` NOT NULL — 0 = Sunday … 6 = Saturday |
| `start_time` | `text` NOT NULL — `HH:MM` 24h |
| `end_time` | `text` NOT NULL — `HH:MM` 24h |
| `active` | `boolean` NOT NULL, default true — inactive rows represent checked-off days and are kept for a stable 7-day response |
| `created_at` / `updated_at` | `timestamp`, default now |

Constraint: `UNIQUE(stylist_id, facility_id, day_of_week)` (Phase 9 — was `(stylist_id, day_of_week)`). Lets a stylist declare different hours on the same day-of-week at different facilities. Writes replace the full week atomically inside `db.transaction()` — never a partial upsert.

### `coverage_requests`

| Column | Notes |
|--------|--------|
| `id` | PK `uuid`, default random |
| `facility_id` | FK → `facilities.id` NOT NULL |
| `stylist_id` | FK → `stylists.id` NOT NULL — the requester |
| `start_date` | `date` NOT NULL (Phase 8.5 — replaced `requested_date`) |
| `end_date` | `date` NOT NULL, with CHECK `end_date >= start_date` |
| `reason` | `text`, nullable |
| `status` | `text` NOT NULL, default `open` — `open` \| `filled` \| `cancelled` |
| `substitute_stylist_id` | FK → `stylists.id`, nullable — set when filled |
| `assigned_by` | FK → `profiles.id`, nullable — admin who filled |
| `assigned_at` | `timestamp`, nullable |
| `created_at` / `updated_at` | `timestamp`, default now |

Two Drizzle relations to `stylists` via named `relationName`: `coverage_stylist` (requester) + `coverage_substitute` (assigned substitute). POST derives `stylistId` from the caller's `profiles.stylistId` — never trusted from body.

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

Layout: branded header with `<Image>` logo (filter:invert for white on burgundy) + floral SVG accent (`layout.tsx`). Logo links to `https://seniorstylist.com`.

Portal service picker (`portal-client.tsx`): card-based, grouped by category, tiered stepper, multi-option pills/select, add-on checklist, live price breakdown, multi-service. Auto-collapses to compact summary row after selection when single row; "Change" link reopens. `pickerOpen: Record<number, boolean>` state.

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
- **Google Calendar sync — per-stylist (Phase 6, shipped 2026-04-14)**: `stylists.google_calendar_id` + `stylists.google_refresh_token` nullable columns. OAuth2 via `googleapis` — `src/lib/google-calendar/oauth-client.ts` (`getAuthUrl`, `exchangeCodeForTokens`, `createStylistCalendarEvent`, `updateStylistCalendarEvent`, `deleteStylistCalendarEvent`). Routes: `GET /api/auth/google-calendar/connect` (authenticated, redirects to Google), `GET /api/auth/google-calendar/callback` (public, stores tokens → `/my-account?calendar=connected`), `POST /api/auth/google-calendar/disconnect` (clears tokens). Booking create/update/delete fire-and-forget per-stylist sync after facility GCal sync. My Account shows Google Calendar section. Stylist detail shows "Calendar connected" emerald badge.
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
- **PWA**: `src/app/icon.tsx` + `apple-icon.tsx` (ImageResponse, burgundy #8B2E4A brand color), `manifest.ts` (Next.js MetadataRoute.Manifest), install banner (`src/components/pwa/install-banner.tsx`). `themeColor: '#8B2E4A'` in root layout.
- **Brand alignment (full migration complete 2026-04-14)**: Entire app — portal, admin, and all components — uses burgundy `#8B2E4A` (`#72253C` hover, `#C4687A` accent). Portal uses warm blush `#FDF8F8` background. `--color-primary` in globals.css is `#8B2E4A`. Exceptions: `completed` status badge (`bg-teal-50 text-teal-700`, semantic), color picker palette arrays, service/stylist color fallbacks, and DB default column (user-owned data — all retain `#0D7377`).
- **Super admin CRUD**: `/super-admin` page supports inline edit (name/address/phone/timezone/paymentType) and deactivate/reactivate (2-step confirm) per facility card. Edit calls `PUT /api/super-admin/facility/[id]`. Facility name uniqueness enforced (409) on both create and edit.
- **Onboarding flow**: new users with valid invite redirect to `/onboarding` (not dashboard error); middleware allows `/onboarding` for users with no facilityUser.
- **Recurring appointments**: `recurring`, `recurring_rule`, `recurring_end_date`, `recurring_parent_id` on bookings; `POST /api/bookings/recurring` creates parent + children; `cancelFuture` param on PUT `/api/bookings/[id]` cancels this + future; ↻ indicator on calendar events.
- **Resident default service**: `default_service_id` on residents — manual admin-settable field. Booking modal and walk-in form now use `mostUsedServiceId` (computed at page load, NOT stored in DB) instead. New helper `src/lib/resident-service-usage.ts` → `getMostUsedServiceIds(facilityId): Promise<Map<string, string>>` — queries `bookings` grouped by `(residentId, serviceId)` (non-cancelled), picks top service per resident in JS. Called in `dashboard/page.tsx` and `log/page.tsx`; merged onto residents as `mostUsedServiceId` before passing to clients. New residents with no history get `null` → service selector shows placeholder (no auto-select). `mostUsedServiceId?: string | null` added to `Resident` interface in `src/types/index.ts`.
- **Single booking UI**: `booking-modal.tsx` is the sole booking flow across desktop + mobile. `useIsMobile()` switches the outer shell between `<Modal>` and `<BottomSheet>`; the form body is shared. `QuickBookFAB` (`src/components/calendar/quick-book-fab.tsx`) is a pure `md:hidden` FAB button with a single `onOpen` prop; dashboard wires it to `openQuickCreate()` which picks the next 30-min slot from now and routes through `openCreateModal(start, end)`. Calendar slot-select goes through the same entrypoint. All pricing-UI features (addon checklist, tiered stepper, multi-option select, price breakdown) work automatically on mobile.
- **Service picker grouping**: booking-modal primary service `<select>` uses `<optgroup>` keyed on `service.category` (fallback `'Other'`). The addon checklist uses text sub-headers by category. Single-category services render flat (no wrapper). Services list page interleaves category section headers between rows (sorted alphabetical, "Other" last).
- **Onboarding wizard**: `/onboarding` — 6-step wizard (Welcome → Facility → Stylist → Services → Residents → Done); each content step (2–5) shows progress dots + skip links. Step 4 (Services) supports PDF/CSV/Excel import via `/api/services/parse-pdf` + `/api/services/bulk`. Step 5 (Residents) supports CSV/Excel import via `/api/residents/bulk`. Step 6 (Done) shows a setup summary (facility name, stylists/services/residents counts). Progress bar = `(step / 6) * 100`.
- **Phase 16 — Production UX**: NavigationProgress (2px teal bar on route change) in `src/components/ui/navigation-progress.tsx`; mobile-nav tap feedback (active:scale-95 + teal dot); stylist mobile dashboard shows today's appointment list with one-tap Mark Done instead of FullCalendar; log page stylist sections are collapsible; working_hours jsonb column on facilities controls booking time slot bounds (Settings → General tab; day checkboxes + start/end selects); invite accept auto-links stylist profile by ilike name match and redirects to `/my-account?welcome=1`; My Account shows welcome banner on first visit.

---

## Security

### Row Level Security (RLS)

RLS is **enabled on all 13 tables** (including `oauth_states`, `franchises`, `franchise_facilities`) as of April 2026. Each table has a single `service_role_all` policy:

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
| `oauth_states` | ✓ | service_role_all |
| `franchises` | ✓ | service_role_all + owner_select |
| `franchise_facilities` | ✓ | service_role_all + owner_select |

**Why this works without breaking queries:** All server-side Drizzle queries run with `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS automatically. The anon key (used only for Supabase Auth client-side) has no direct table access — **except** for `facility_users` and `invites`, which have scoped `authenticated` SELECT policies so that middleware can query them.

**New table checklist:** Any new table must have `ALTER TABLE x ENABLE ROW LEVEL SECURITY` + the `service_role_all` policy added immediately after creation. If middleware needs to query the table, also add a scoped `authenticated` SELECT policy.

### Payload sanitization (server → client)

`src/lib/sanitize.ts` exports the helpers used at every server→client boundary to strip secrets:

- `sanitizeStylist(row)` — drops `googleRefreshToken`.
- `sanitizeFacility(row)` — drops `stripeSecretKey`, adds derived `hasStripeSecret: boolean`.
- `toClientJson(value)` — recursive JSON replacer that nukes `googleRefreshToken` and `stripeSecretKey` anywhere in nested shapes. Use it in place of `JSON.parse(JSON.stringify(x))` whenever a payload contains embedded stylist or facility objects.

Applied in: `/(protected)/dashboard/page.tsx`, `/(protected)/settings/page.tsx`, `/(protected)/log/page.tsx`, `/(protected)/residents/[id]/page.tsx`, `/(protected)/my-account/page.tsx`, `/(protected)/stylists/[id]/page.tsx`, `/api/facility`, `/api/bookings`, `/api/bookings/[id]`, `/api/log`. Settings UI treats `stripeSecretKey` as write-only — server never sends it; client renders a masked placeholder plus "Stored securely" confirmation when `hasStripeSecret` is true.

### OAuth CSRF (Google Calendar)

`oauth_states` table: `{ nonce text pk, user_id uuid, stylist_id uuid, created_at timestamp }`. Flow:

1. `GET /api/auth/google-calendar/connect` — requires authenticated admin, validates target `stylistId` belongs to the caller's facility, generates `crypto.randomUUID()` nonce, inserts `oauth_states` row, passes `state=nonce` to Google.
2. `GET /api/auth/google-calendar/callback` — requires same authenticated user, looks up the state row by nonce, rejects if missing / >10 min old / `user_id` mismatch / stylist no longer in caller's facility, persists tokens, atomically deletes the state row.

The old `Buffer.from(state,'base64')` pattern (where any attacker could forge a stylist id) is removed.

### Response headers (`next.config.ts`)

Applied to all routes via `headers()`:

- `X-Frame-Options: DENY` — clickjacking defense.
- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `Permissions-Policy: camera=(), microphone=(), geolocation=()` — all off; mobile OCR upload uses `<input capture="environment">` which is a file-picker and does not require camera permission.
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` — 1-year HSTS.
- `Content-Security-Policy` — `default-src 'self'`, allowlists for Supabase, Google APIs, Upstash, Vercel Insights, Gemini, cdnjs (pdfjs worker); `'unsafe-inline'` for styles (Tailwind); `frame-ancestors 'none'`.

### Rate limiting (`src/lib/rate-limit.ts`)

Upstash Redis sliding-window limiter behind `checkRateLimit(bucket, identifier)` + `rateLimitResponse(retryAfter)` helpers. No-op when `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are unset (e.g. local dev) — always sets them in Vercel production.

| Bucket | Limit | Scope | Applied to |
|---|---|---|---|
| `signup` | 5 / hour | client IP | `POST /api/access-requests` |
| `portalBook` | 10 / hour | portal token | `POST /api/portal/[token]/book` |
| `ocr` | 20 / hour | user id | `POST /api/log/ocr` |
| `parsePdf` | 20 / hour | user id | `POST /api/services/parse-pdf` |
| `sendPortalLink` | 10 / hour | user id | `POST /api/residents/[id]/send-portal-link` |
| `invites` | 30 / hour | user id | `POST /api/invites` |

### Upload caps

- `/api/log/ocr` — reject if `files.length > 20` or any `file.size > 10MB`.
- `/api/services/parse-pdf` — reject if `file.size > 50MB`.

### Input validation (Zod caps)

Every input schema includes `.max()` caps to bound payload size: name/residentName/serviceName 200, roomNumber 50, notes/description 2000, email 320, color 20, address 500, timezone 100, cents 10_000_000, duration 1440 (24h), tier/option arrays 20, additionalServices 20. Cap recommendations in `CLAUDE.md` "API Routes" section.

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
| `POST /api/log/ocr` | Authenticated | Accept `images[]` + optional `servicesJson` (JSON `{ name, priceCents }[]`). Route calls `buildInstruction(knownServices)` to inject facility service list + abbreviation table into the Gemini prompt so it can expand shorthand (e.g. "S/BDry" → "Shampoo, Blow Dry") and use price as a matching signal. Prompt instructs Gemini to extract EXACT written price (never substitute catalog price) and write full legible names. `maxDuration = 120`, per-file timeout 90s. Returns `{ data: { sheets } }`. Review step service fields are `<select>` dropdowns pre-populated via two-signal matching: name fuzzy score + exact price match (`s.priceCents === ocrPrice`); price match wins when nameScore < 0.85 and only one service at that price; price from sheet is the source of truth and is never overwritten by service selection. |
| `POST /api/log/ocr/import` | **Admin** | Create missing residents + services + multi-service completed bookings from reviewed sheets in one `db.transaction()`; bookings spaced 30 min from 09:00 UTC. Accepts `additionalServiceIds: (string \| null)[]` + `additionalServiceNames: string[]` per entry; resolves each via the 3-step fuzzy-match algorithm and stores all IDs in `service_ids` |
| `GET/POST /api/residents` | Authenticated | List/create residents (portal token on create) |
| `GET/PUT/DELETE /api/residents/[id]` | Authenticated | Single resident |
| `POST /api/residents/bulk` | Authenticated | Bulk insert residents (conflict skip on name+facility) |
| `GET/POST /api/stylists` | Authenticated | List/create stylists. GET accepts `?scope=facility\|franchise\|all` and optional `?franchiseId=` (master admin). POST is admin-only; `stylistCode` auto-generated via `generateStylistCode(tx)` (advisory lock 9191) when omitted; accepts `facilityId: null` to create franchise-pool stylists |
| `GET/PUT/DELETE /api/stylists/[id]` | Authenticated | Single stylist. PUT accepts `facilityId`, `franchiseId`, `stylistCode` (master admin only for existing ST code edits), `status` enum, `specialties string[]`; facility moves must stay within the caller's franchise |
| `GET/POST /api/stylists/[id]/assignments` | **Admin** | List per-facility assignments (with `facilityName` joined) / upsert an assignment. POST validates `facilityId` is in caller's franchise. Returns rows with `commissionPercent` (nullable — `null` = use stylist default), `active`. Commission display: `null` → "Default (X%)" using `resolveCommission()`. |
| `PUT /api/stylists/[id]/assignments/[assignmentId]` | **Admin** | Update `commissionPercent` (nullable) and/or `active` on a specific assignment row. Verifies stylist + assignment are in caller's franchise scope. |
| `GET/POST /api/stylists/[id]/notes` | **Admin** | List admin-only notes (with joined `authorEmail`), ordered newest-first / create note. `authorUserId` is always server-derived from the authenticated user — never trusted from body. |
| `DELETE /api/stylists/[id]/notes/[noteId]` | **Admin** | Hard delete a note. Verifies note belongs to the given stylist and caller has franchise scope. |
| `POST /api/stylists/[id]/invite` | **Admin** | Send a Supabase magic-link invite to the stylist's email. Guards: email must exist (400), no linked profile (409), franchise scope (403), 24h rate limit (429). Uses `supabaseAdmin.auth.admin.inviteUserByEmail` with `redirectTo = APP_URL/invite/accept`. Updates `stylists.last_invite_sent_at` server-side after success. Returns `{ data: { invited: true } }`. |
| `POST /api/stylists/import` | **Admin** | CSV/XLSX stylist import (200 row cap). Bookkeeping CSV columns: FNAME/LNAME (or name), ST code (or id/stcode/code), %PD/commission, How PD, License ST, SCHEDULE, email, phone, address, ZIP, licenseNumber, licenseType, licenseExpires. Silently skips bank/SSN fields. Gemini 2.5 Flash parses SCHEDULE column → availability rows (onConflictDoNothing). Returns `{ data: { imported, updated, availabilityCreated, scheduleNotes, errors } }` |
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
| `GET /api/export/bookkeeper?month=YYYY-MM` | **Admin** | Bookkeeper CSV: Date, Resident, Room, Service, Stylist, Duration, Price, Payment Status, Payment Method, Notes. Completed bookings only, facility timezone aware. |
| `POST /api/residents/[id]/send-portal-link` | Authenticated | Send portal link email to resident's `poaEmail`. Guards: resident must exist in facility, have `poaEmail` and `portalToken`. |
| `POST /api/webhooks/stripe` | Stripe signature | On `checkout.session.completed`, set booking `payment_status` to `paid` |
| `GET /api/portal/[token]` | **No session** (uses token) | Resident + bookings + facility payment type + `poaName` + `poaEmail` |
| `GET /api/portal/[token]/stylists` | Token | Active stylists for facility |
| `GET /api/portal/[token]/services` | Token | Active services |
| `GET /api/portal/[token]/available-times` | Token | **Rewritten in Phase 8.5.** Returns `{ availableSlots, bookedSlots }` computed from `stylist_availability` + `resolveAvailableStylists()`. Only slots with ≥1 candidate stylist are listed. Accepts `?duration=` |
| `GET /api/portal/[token]/available-days?month=YYYY-MM` | Token | New in Phase 8.5. Returns `{ availableDates: ['YYYY-MM-DD'] }` — every date that has ≥1 active stylist available (by availability + coverage) |
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
| `POST /api/compliance/upload` | Authenticated; admin or stylist-owner | Multipart upload (`file`, `stylistId`, `documentType`, `expiresAt?`). Caps: 10 MB, PDF/JPEG/PNG. Uploads to private `compliance-docs` bucket at `{facilityId}/{stylistId}/{type}-{ts}.{ext}` and inserts the row with `file_url = path`. |
| `GET /api/compliance?stylistId=` | Authenticated; admin any, stylist self only | Facility-scoped docs list. Generates a fresh **signed URL (1 h TTL)** per row; signed URLs are never persisted. |
| `DELETE /api/compliance/[id]` | Admin OR (stylist-owner AND unverified) | Removes the storage object, then the DB row. |
| `PUT /api/compliance/[id]/verify` | **Admin** | Sets `verified=true`, `verified_by`, `verified_at`. In one `db.transaction()` mirrors to stylist columns: `license` → `license_expires_at`; `insurance` → `insurance_verified=true` + `insurance_expires_at`; `background_check` → `background_check_verified=true`. |
| `PUT /api/compliance/[id]/unverify` | **Admin** | Clears `verified`/`verified_by`/`verified_at`. Does NOT roll back stylist mirror columns. |
| `GET /api/availability?stylistId=` | Authenticated; admin any, stylist self only | Returns `{ availability: StylistAvailability[] }` ordered by `dayOfWeek`. |
| `PUT /api/availability` | Stylist-self or admin in facility | Body `{ stylistId, availability: DayRow[] }`. Replaces the full week atomically inside `db.transaction()` — never a partial upsert. Active rows require `startTime < endTime`. |
| `GET /api/coverage` | Admin (facility-wide) / stylist (forced self) / viewer 403 | Optional `?status=` + `?stylistId=` (admin only). Joins requester + substitute stylist via named relations. |
| `POST /api/coverage` | Stylist only | Body `{ startDate, endDate, reason? }` (Phase 8.5 — replaced single `requestedDate`). `stylistId` derived server-side. 409 on overlapping open request for same stylist (`new.start ≤ existing.end AND new.end ≥ existing.start`). Past start-dates rejected. Fires `buildCoverageRequestEmailHtml` with range label. |
| `PUT /api/coverage/[id]` | Admin any; stylist only to cancel own open request | Admin can set status/substituteStylistId/reason/startDate/endDate. On `status='filled'` substitute must be in caller's facility OR a franchise-pool stylist in the caller's franchise, active, ≠ requester; sets `assignedBy`/`assignedAt`; fires `buildCoverageFilledEmailHtml` with range. |
| `DELETE /api/coverage/[id]` | Admin any; stylist-owner only when `status='open'` | Hard delete — coverage requests are transient. |
| `GET /api/coverage/substitutes?date=YYYY-MM-DD` | **Admin** | Returns `{ data: { facilityStylists, franchiseStylists } }` — both lists are `{ id, name, stylistCode }`. Facility pool = active stylists at caller's facility with availability on that day-of-week, not themselves on coverage that date. Franchise pool = active stylists with `facilityId IS NULL AND franchiseId = caller's franchise`. |
| `GET /api/cron/compliance-alerts` | **Vercel Cron** (`Bearer CRON_SECRET`) | Daily at 09:00 UTC via `vercel.json`. Emails facility admins when any verified doc or stylist license/insurance `expires_at` is exactly **today+30** or **today+60**. Fallback recipient: `NEXT_PUBLIC_ADMIN_EMAIL`. All `sendEmail()` fire-and-forget. Returns `{ data: { alertsSent } }`. |

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

## Booking modal submit guard

`handleSubmit` uses a `submittingRef = useRef(false)` mutex in addition to `submitting` state. The ref check (`if (submittingRef.current) return`) fires synchronously before any async work, preventing concurrent invocations from rapid taps, simultaneous Cmd+Enter + click, or any React batching edge case. The `submitting` state still drives the button's `loading`/`disabled` UI.

## Booking modal pricing UI (src/components/calendar/booking-modal.tsx)

- **Addon display**: addon-type service surcharge displayed as `(addonAmountCents ?? priceCents ?? 0)` at three sites: `multiAddonTotal` reduce, checklist label, breakdown line. Do NOT use `addonAmountCents ?? 0` — manual services store surcharge in `priceCents`.
- **Tiered stepper**: `<input type="number">` replaced with a 44px three-part stepper (`−` stone / count span / `+` teal). An IIFE below the stepper computes `activeTier` and renders a hint: `{min}–{max+}: $X each → $total`.
- **Breakdown annotations** (idx===0 primary service): IIFE computes a context-aware `nameLabel` — tiered shows `ServiceName (qty × $X/ea)`, multi_option shows `ServiceName — OptionName`, addon shows `ServiceName (+$X add-on)`. Addon checklist lines in breakdown use `text-amber-700`.
- **Service selector option text**: `` `${s.name} · ${formatPricingLabel(s)}` `` — no duration suffix. `formatPricingLabel` returns `+$X.00` for addon, `$X.00/unit` for tiered, `$X.00–$Y.00` for multi_option.
- **Inline create resident**: resident combobox supports inline creation when ≥3 chars typed with no match. "+ Create 'name'" button opens a mini-form inside the same dropdown (name pre-filled, room optional) → POST /api/residents → auto-select. `localNewResidents: Resident[]` state merged with `residents` prop for filtering. Same pattern in log walk-in form. All state resets on close. 409 → "A resident with this name already exists".

---

## Planned phases (schema preview)

### Phase 7 — Compliance & Document Management (SHIPPED 2026-04-14)
See the `compliance_documents` schema section above and the `/api/compliance/*` + `/api/cron/compliance-alerts` rows in the API directory. Admin UI lives on Stylist Detail (verify/unverify + license edits); stylist-facing UI lives on My Account (upload/view/delete own unverified docs). `computeComplianceStatus()` helper in `src/lib/compliance.ts` drives the dot on the Stylists list. Uploads proxy through the API — the service-role key is never exposed to the browser.

### Phase 8 — Workforce Availability & Coverage (SHIPPED 2026-04-14)
See the `stylist_availability` + `coverage_requests` schema sections above and the `/api/availability` + `/api/coverage*` rows in the API directory. Stylist-facing UI on My Account: Weekly Availability grid + Time Off request list. Admin-facing UI on the Dashboard: amber coverage banner + Coverage Queue card (`id="coverage-queue"`) in the right rail with substitute `<select>` + Assign (optimistic removal). Stylist Detail gets a read-only Availability card that collapses consecutive same-time days into `Mon–Fri 9am–5pm` ranges. Emails: `buildCoverageRequestEmailHtml` fires to admins on POST; `buildCoverageFilledEmailHtml` fires to the requester when an admin PUTs status=filled. **Phase 8.5 replaced `requested_date` with `start_date` + `end_date` — see below.**

### Phase 8.5 — Franchise Stylist Directory, ST Codes, Availability-Based Portal Booking (SHIPPED 2026-04-14)
Three interlocking changes shipped in a single phase:
1. **Franchise stylist directory** — `stylists.facility_id` is now nullable, new `stylists.franchise_id` (nullable FK → `franchises.id`), new `stylists.stylist_code` (NOT NULL, UNIQUE, `^ST\d{3,}$`, backfilled as `ST001`…`ST###` in `created_at` order). New helper `src/lib/stylist-code.ts` → `generateStylistCode(tx)` uses `pg_advisory_xact_lock(9191)` inside `db.transaction()` for race-safe serial generation. New `/stylists/directory` page (admin, franchise-scoped) with search, filter pills (All / Assigned / Unassigned), inline Add Stylist form, and CSV/XLSX import modal. `POST /api/stylists/import` (200-row cap) parses CSV/XLSX, upserts by `stylistCode`, returns `{ imported, updated, errors }`. Sidebar "Directory" link between Stylists and Services. `GET /api/stylists?scope=facility|franchise|all` makes the franchise-pool inclusion explicit at every call site. `getUserFranchise()` helper added to `src/lib/get-facility-id.ts`.
2. **Availability-based portal booking** — Portal no longer exposes stylist picking. Flow is now service → date → time → confirm. New `GET /api/portal/[token]/available-days?month=YYYY-MM` powers the date-picker greyed-out days. `GET /api/portal/[token]/available-times` rewritten to consult `stylist_availability` + `resolveAvailableStylists()` (`src/lib/portal-assignment.ts`) — only slots with ≥1 candidate stylist are returned. `POST /api/portal/[token]/book` no longer requires `stylistId` — server picks the available stylist with the fewest bookings on that date. 409 when no candidates.
3. **Coverage date ranges + franchise-pool substitutes** — `coverage_requests.requested_date` replaced by `start_date` + `end_date` (CHECK `end_date >= start_date`). POST/PUT/GET updated; duplicate-overlap detection uses `new.start ≤ existing.end AND new.end ≥ existing.start`. `GET /api/coverage/substitutes?date=` returns two groups — `facilityStylists` (facility pool with DoW availability, not themselves on coverage) and `franchiseStylists` (franchise-pool stylists, `facilityId IS NULL AND franchiseId = caller's franchise`). Dashboard `CoverageQueueRow` renders two `<optgroup>` blocks in its picker. Emails (`buildCoverageRequestEmailHtml`, `buildCoverageFilledEmailHtml`) now take `startDate` + `endDate` and render `Jun 3 – Jun 7` when different, single date when equal.

### Phase 9.5 — Applicant Pipeline (SHIPPED 2026-04-16)
New table `applicants`: `id` uuid PK, `franchise_id` FK → franchises (SET NULL), `name` NOT NULL, `email`, `phone`, `location`, `applied_date` date, `job_title`, `job_location`, `relevant_experience`, `education`, `source`, `is_indeed_email boolean NOT NULL DEFAULT false`, `qualifications jsonb` (`[{question,answer,match}]`), `status text DEFAULT 'new' CHECK(new|reviewing|contacting|hired|rejected)`, `notes`, `active boolean NOT NULL DEFAULT true`, timestamps. RLS enabled + `service_role_all` policy. Indexes on `franchise_id`, `status`, `email`.

New types: `ApplicantStatus = 'new'|'reviewing'|'contacting'|'hired'|'rejected'`, `Applicant` interface in `src/types/index.ts` (all date fields are `string | null` for JSON serialization safety — not `Date`).

New API routes (all admin-only, franchise-scoped):
- `GET /api/applicants?status=` — list, ordered by `appliedDate DESC`
- `POST /api/applicants/import` — Indeed CSV import via PapaParse. `maxDuration=60`. 2000-row cap. Maps: name, email (`@indeedemail.com` → `isIndeedEmail=true`), phone, candidate location, date (`M/D/YYYY` and `YYYY-MM-DD` supported), job title, job location, relevant experience, education, source, status (STATUS_MAP), qualification 1–4 + answer + match → `qualifications[]`. Dedup by `email:${lower}` OR `namedate:${lower}:${date}` against ALL franchise applicants (including inactive). Batch insert 200/chunk with `onConflictDoNothing`. Returns `{imported, skipped, errors}`.
- `PUT /api/applicants/[id]` — Zod `{status?, notes?, email?, phone?}`; `DELETE /api/applicants/[id]` — soft delete
- `POST /api/applicants/[id]/promote` — `db.transaction()`: `generateStylistCode(tx)` + insert stylist (franchiseId, name, email, phones, status='active', commissionPercent=0, color='#8B2E4A', specialties=[]) + set applicant status='hired'+active=false. Returns `{stylistId}`.

Directory page (`/stylists/directory`): `page.tsx` fetches applicants in `Promise.all` alongside stylists + facilities. `directory-client.tsx` gains a tab switcher ("Stylists" / "Applicants •N"). Stylists tab unchanged. Applicants tab: search input, status filter pills with counts (All/New/Reviewing/Contacting/Hired/Rejected), "Import CSV" button, import result banner, applicant list rows (name + location + applied date + job title + status badge + inline status `<select>` + expand chevron). Expanded detail panel: email (with "via Indeed" pill), phone, experience, education, qualifications Q&A, notes textarea (auto-saves on blur), "Promote to Stylist →" button (hidden when status='rejected'). On promote success: row removed from list, "Promoted! View stylist profile →" link shown.

### Phase 9 — Territory / Region Management
New table `regions`: `id` uuid PK, `name`, `franchise_id` nullable FK → franchises, `active`. Add `region_id` nullable FK to `facilities` and `stylists`. Hierarchy: Master Admin → Franchise → Region → Facility.

### Phase 10 — Payroll Operations
New table `payroll_periods`: `start_date`, `end_date`, `status` (draft|approved|paid), `facility_id`. New table `payroll_entries`: `payroll_period_id` FK, `stylist_id` FK, `gross_revenue_cents`, `commission_cents`, `tips_cents`, `adjustments_cents`, `total_pay_cents`, `booking_ids text[]`, `approved` boolean.

### Phase 11 — Incident & Issue Tracking
New table `issues`: `facility_id`, `stylist_id` nullable, `booking_id` nullable, `reported_by` (user_id), `issue_type` text, `severity` (low|medium|high), `description`, `action_taken`, `assigned_to` nullable, `status` (open|in_progress|resolved), `resolved_at`.

### Phase 12 — Advanced KPI Dashboard
No schema changes. New computed metrics in existing report endpoints plus a new weekly digest email route.

### Phase 13 — Facility Contact Portal
New role `facility_contact` in `facility_users.role`. New table `service_change_requests`: `facility_id`, `submitted_by` (user_id), `request_type` text, `requested_date`, `notes`, `status` (pending|approved|denied).

### Phase 14 — QuickBooks Online Integration
New columns on `facilities`: `quickbooks_realm_id`, `quickbooks_access_token`, `quickbooks_refresh_token`, `quickbooks_token_expires_at`. New table `quickbooks_sync_log`: `facility_id`, `entity_type` (invoice|payroll), `entity_id`, `qb_id`, `status` (synced|failed), `error`, `synced_at`.

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
