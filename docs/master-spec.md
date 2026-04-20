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
| `service_category_order` | `jsonb`, nullable `string[]` — per-facility category display order. Captured on PDF import (`/api/services/bulk`): categories are extracted in order of first appearance on the uploaded rows (excluding empty + "Other"), merged with the existing order (existing entries retain their position; new ones appended). `null` = fall back to Z→A alphabetical at display time. Consumed via `src/lib/service-sort.ts` helpers (`buildCategoryPriority`, `sortCategoryGroups`, `sortServicesWithinCategory`) in booking modal, portal, services page, log walk-in form. |
| `qb_realm_id` | `text`, nullable (Phase 10B) — QuickBooks Online company ID from OAuth callback |
| `qb_access_token` | `text`, nullable (Phase 10B) — QB OAuth access token; stored as **AES-256-GCM ciphertext** (via `src/lib/token-crypto.ts`); never returned to client |
| `qb_refresh_token` | `text`, nullable (Phase 10B) — QB OAuth refresh token; stored as **AES-256-GCM ciphertext**; never returned to client |
| `qb_token_expires_at` | `timestamptz`, nullable (Phase 10B) — expiry of `qb_access_token`; helper refreshes 5min before |
| `qb_expense_account_id` | `text`, nullable (Phase 10B) — admin-selected QB Expense Account ID used as `AccountRef` on every pushed Bill line |
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
- **`qb_vendor_id`** (text, nullable, Phase 10B) — QuickBooks Vendor ID mapping. Set on first Vendor sync or inline when pushing a Bill for a stylist with no mapping. Null = never synced to QB.
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
| `nonce` | `text` unique — random UUID passed as `state` to OAuth provider |
| `user_id` | FK → `profiles.id` — caller who initiated the connect flow |
| `stylist_id` | FK → `stylists.id`, **NULLABLE** (Phase 10B) — populated on Google Calendar flow; null on QuickBooks flow |
| `facility_id` | FK → `facilities.id`, nullable (Phase 10B) — populated on QuickBooks flow; null on Google Calendar flow |
| `created_at` | Timestamp; rows older than 10 minutes are treated as expired |

Used by both `/api/auth/google-calendar/*` (populates `stylist_id`) and `/api/quickbooks/*` (populates `facility_id`) to bind OAuth callbacks to the authenticated user and prevent CSRF. Exactly one of `stylist_id` / `facility_id` is populated per row. Row is deleted atomically on successful callback. The google-calendar callback guards `if (!stateRow.stylistId) throw` since the column is now nullable.

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

### `pay_periods` (Phase 10A)

| Column | Notes |
|--------|--------|
| `id` | PK `uuid`, default random |
| `facility_id` | FK → `facilities.id` NOT NULL |
| `franchise_id` | FK → `franchises.id`, nullable |
| `period_type` | `text` NOT NULL, default `monthly`, CHECK `IN (weekly, biweekly, monthly)` |
| `start_date` / `end_date` | `date` NOT NULL |
| `status` | `text` NOT NULL, default `open`, CHECK `IN (open, processing, paid)` — paid locks all edits |
| `notes` | `text`, nullable |
| `created_by` | FK → `profiles.id`, nullable |
| `qb_synced_at` | `timestamptz`, nullable (Phase 10B) — aggregate "last Bill push" timestamp for the period; set after any `sync-bill` run with ≥1 success |
| `qb_sync_error` | `text`, nullable (Phase 10B) — aggregate error summary when the most recent sync-bill run had at least one failure |
| `created_at` / `updated_at` | `timestamp`, default now |

### `stylist_pay_items` (Phase 10A)

| Column | Notes |
|--------|--------|
| `id` | PK `uuid`, default random |
| `pay_period_id` | FK → `pay_periods.id` ON DELETE CASCADE, NOT NULL |
| `stylist_id` | FK → `stylists.id` NOT NULL |
| `facility_id` | FK → `facilities.id` NOT NULL |
| `pay_type` | `text` NOT NULL, default `commission`, CHECK `IN (commission, hourly, flat)` |
| `gross_revenue_cents` | `integer` NOT NULL, default 0 |
| `commission_rate` | `integer` NOT NULL, default 0 — % |
| `commission_amount_cents` | `integer` NOT NULL, default 0 |
| `hours_worked` | `numeric(6,2)`, nullable — returned as **string** by Drizzle |
| `hourly_rate_cents` | `integer`, nullable |
| `flat_amount_cents` | `integer`, nullable |
| `net_pay_cents` | `integer` NOT NULL, default 0 — recomputed on every mutation |
| `notes` | `text`, nullable |
| `qb_bill_id` | `text`, nullable (Phase 10B) — QuickBooks Bill ID when pushed (one Bill per stylist per period) |
| `qb_bill_sync_token` | `text`, nullable (Phase 10B) — captured from QB on create; needed for sparse updates |
| `qb_sync_error` | `text`, nullable (Phase 10B) — last error message if the most recent push failed for this item; cleared on next success |
| `created_at` / `updated_at` | `timestamp`, default now |

Constraint: `UNIQUE(pay_period_id, stylist_id)` (named `stylist_pay_items_period_stylist_unique`).

### `pay_deductions` (Phase 10A)

| Column | Notes |
|--------|--------|
| `id` | PK `uuid`, default random |
| `pay_item_id` | FK → `stylist_pay_items.id` ON DELETE CASCADE, NOT NULL |
| `stylist_id` | FK → `stylists.id` NOT NULL |
| `pay_period_id` | FK → `pay_periods.id` NOT NULL |
| `deduction_type` | `text` NOT NULL, CHECK `IN (cash_kept, supplies, advance, other)` |
| `amount_cents` | `integer` NOT NULL |
| `note` | `text`, nullable |
| `created_by` | FK → `profiles.id`, nullable |
| `created_at` | `timestamp`, default now |

Net pay is always `max(0, base − Σ deductions)` where base = commissionAmountCents | `round(hoursWorked × hourlyRateCents)` | flatAmountCents. Helper: `computeNetPay()` in `src/lib/payroll.ts`. Recompute inside a single `db.transaction()` on every item PUT, deduction POST, deduction DELETE.

### `qb_invoices` (Phase 11A)

| Column | Notes |
|--------|--------|
| `id` | PK `uuid` |
| `facility_id` | FK → `facilities.id` ON DELETE CASCADE, NOT NULL |
| `resident_id` | FK → `residents.id` ON DELETE SET NULL, nullable |
| `qb_customer_id` | `text`, nullable — QB Name column value |
| `invoice_num` | `text` NOT NULL |
| `invoice_date` | `date` NOT NULL |
| `due_date` | `date`, nullable |
| `amount_cents` | `integer` NOT NULL default 0 |
| `open_balance_cents` | `integer` NOT NULL default 0 |
| `status` | `text` NOT NULL default `'open'` — `open|partial|paid|credit` |
| `payment_type` | `text`, nullable |
| `qb_invoice_id` | `text`, nullable |
| `last_sent_at` / `sent_via` / `synced_at` | timestamps, nullable |
| `created_at` / `updated_at` | timestamps |

Dedup unique index: `qb_invoices_dedup_idx ON (invoice_num, facility_id)`.

### `qb_payments` (Phase 11A)

| Column | Notes |
|--------|--------|
| `id` | PK `uuid` |
| `facility_id` | FK → `facilities.id` ON DELETE CASCADE, NOT NULL |
| `resident_id` | FK → `residents.id` ON DELETE SET NULL, nullable |
| `qb_customer_id` | `text`, nullable |
| `check_num` | `text`, nullable |
| `check_date` | `date`, nullable |
| `payment_date` | `date` NOT NULL |
| `amount_cents` | `integer` NOT NULL default 0 |
| `memo` / `invoice_ref` / `payment_type` | `text`, nullable |
| `recorded_via` | `text` NOT NULL default `'manual'` — `manual|qb_import` |
| `check_image_url` / `qb_payment_id` | `text`, nullable |
| `resolved_at` / `synced_at` | timestamps with timezone, nullable |
| `created_at` | timestamp |

Natural key unique index: `qb_payments_natural_key_idx ON (payment_date, facility_id, amount_cents, COALESCE(invoice_ref, ''))`.

### `qb_unresolved_payments` (Phase 11A)

| Column | Notes |
|--------|--------|
| `id` | PK `uuid` |
| `facility_id` | FK → `facilities.id` ON DELETE CASCADE, NOT NULL |
| `check_num` / `check_date` | `text`/`date`, nullable |
| `total_amount_cents` | `integer` NOT NULL default 0 |
| `raw_resident_name` / `raw_amount_cents` / `raw_service_type` | nullable — raw data from check |
| `check_image_url` / `notes` | `text`, nullable |
| `resolved_to_resident_id` | FK → `residents.id` ON DELETE SET NULL, nullable |
| `created_at` | timestamp |

**New columns on `facilities`**: `qb_outstanding_balance_cents integer DEFAULT 0`, `qb_rev_share_type text DEFAULT 'we_deduct'`.
**New columns on `residents`**: `qb_outstanding_balance_cents integer DEFAULT 0`, `resident_payment_type text`.

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
| `/payroll` | **Admin-only** — pay period list + New Pay Period modal |
| `/payroll/[id]` | **Admin-only** — pay period detail with expandable rows, inline deductions, status transitions, CSV export |
| `/settings` | Facility settings, users, invites (admin-only sections gated in client) |

### `(resident)` — `src/app/(resident)/`

| Path | Purpose |
|------|---------|
| `/portal/[token]` | Resident portal UI (`portal-client.tsx`): services, stylists, booking slots, Stripe checkout when `payment_type` is `ip` or `hybrid` |

Layout: branded header with `<Image>` logo (filter:invert for white on burgundy) + floral SVG accent (`layout.tsx`). Logo links to `https://seniorstylist.com`.

Portal service picker (`portal-client.tsx`): card-based multi-service picker, grouped by category. `selectedServiceIds: string[]` — pre-selects `mostUsedServiceId` (non-addon, passed from `page.tsx` via booking history query) when history exists; otherwise starts empty. After first pick: compact summary row with "Change" link; then in order: (1) tiered stepper / multi-option picker, (2) `+ Add another service` dashed button (`min-h-[56px]`, capped at `Math.min(4, nonAddonServices.length)`), (3) addon checklist (44px targets), (4) live price breakdown, (5) Continue button. `handleBook` sends `serviceIds[]` + `addonServiceIds[]`. `POST /api/portal/[token]/book` accepts `serviceIds[]` + `addonServiceIds[]` + `selectedQuantity` + `selectedOption`. Server resolves total price and duration, stores `serviceIds`, `addonServiceIds`, `addonTotalCents`. `pickerOpen: Record<number, boolean>` controls collapsed/expanded per slot.

`portal/[token]/page.tsx` queries `bookings` for the resident (grouped by `serviceId`, `status != 'cancelled'`) to compute `mostUsedServiceId: string | null` and passes it as a prop to `PortalClient`. No new DB column — computed inline on each page load.

### `(public)` — `src/app/(public)/`

Auth-free static pages. No sidebar, no mobile nav, no auth check.

| Path | Purpose |
|------|---------|
| `/privacy` | Privacy Policy (public) |
| `/terms` | Terms of Service & EULA (public) |

Layout (`layout.tsx`): burgundy `#8B2E4A` header with white-inverted logo linking to `seniorstylist.com`, `max-w-3xl mx-auto px-6 py-12` main, footer with Privacy/Terms cross-links and copyright. Both pages are static server components with `export const metadata` for SEO titles.

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
- **Service picker grouping**: booking-modal primary service `<select>` uses `<optgroup>` keyed on `service.category` (fallback `'Other'`). The addon checklist uses text sub-headers by category. Single-category services render flat (no wrapper). **Category sort order is Z→A** (descending, matching the services page default), "Other" always last. Within each category group: `pricingTypePriority` sort (fixed/multi_option first = 0, tiered = 1, addon = 2), then alphabetical by name. Addon checklist services sorted alphabetically by name. Services list page interleaves category section headers between rows (sorted desc, "Other" last).
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
| `GET /api/quickbooks/connect` | **Admin** (Phase 10B) | Inserts `oauth_states` row with `userId` + `facilityId` (no `stylistId`) and redirects to Intuit authorize URL with base64-encoded nonce as `state`. |
| `GET /api/quickbooks/callback` | Authenticated (Intuit redirect) | Validates `state` against `oauth_states` (userId match, facilityId present, 10-min TTL), exchanges `code` via `exchangeQBCode()`, stores `qb_realm_id` + tokens + `qb_token_expires_at` on the facility, deletes state row. Redirects `/settings?qb=connected#integrations` or `?qb=error&reason=…`. |
| `POST /api/quickbooks/disconnect` | **Admin** (Phase 10B) | Clears all QB columns (`qb_realm_id`, tokens, expiry, `qb_expense_account_id`). Fire-and-forget `revokeQBToken()` against Intuit's revoke endpoint. |
| `GET /api/quickbooks/accounts` | **Admin**, rate-limited `quickbooksSync` | Queries QB for active Expense accounts; returns sorted `{ id, name, accountType, accountSubType }[]` for the Settings picker. `maxDuration=60`. |
| `POST /api/quickbooks/sync-vendors` | **Admin**, rate-limited `quickbooksSync` | Creates or sparse-updates QB Vendors for every active assigned stylist in the facility. Never fails the whole batch — returns `{ created, updated, skipped, errors: [{ stylistId, message }] }`. Exports `syncVendorsForFacility(facilityId, filterStylistIds?)` for reuse. `maxDuration=60`. |
| `POST /api/quickbooks/sync-bill/[periodId]` | **Admin**, rate-limited `quickbooksSync` | Requires `period.status !== 'open'` (412) and `facility.qbExpenseAccountId` (412). Auto-calls `syncVendorsForFacility` for any stylist missing a vendor mapping. Pushes one Bill per stylist with `netPayCents > 0`; sparse-updates existing Bills via GET-for-SyncToken → POST `{Id, SyncToken, sparse: true}`. Writes `qb_bill_id` / `qb_bill_sync_token` per item + aggregate `qb_synced_at` on the period. `revalidateTag('pay-periods', {})`. `maxDuration=60`. |
| `POST /api/quickbooks/sync-status/[periodId]` | **Admin**, rate-limited `quickbooksSync` | GETs each `/bill/<qbBillId>` for items with a Bill. When every Balance === 0 and status ≠ paid, flips the period to `paid` + `revalidateTag('pay-periods', {})`. Returns `{ items, periodStatus, periodUpdated }`. |

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

### Directory UX Improvements (SHIPPED 2026-04-16)
- **Last-name sort**: `directory/page.tsx` no longer sends `orderBy` to the DB — client handles last-name sort via `name.split(' ').pop()`. Sort header label changed from "Name" to "Last Name".
- **Stylist mass edit**: Floating bulk action bar expanded with Set Status dropdown, Set Facility dropdown, Set Commission % input, and Apply button. Changing one field auto-clears the other two. New `POST /api/stylists/bulk-update` route (body: `{ ids, status? | facilityId? | commissionPercent? }`; same franchise-scope verification as bulk-delete; `facilityId` path runs `db.transaction()` for upsert + update). Optimistic local state — no `router.refresh()`.
- **Applicant ZIP radius search**: `src/lib/zip-coords.ts` static lookup table (~1200 ZIP entries covering DC, MD 20xxx-21xxx, VA 22xxx-23xxx, MN Twin Cities 55xxx). `getZipsWithinMiles(zip, miles)` uses Haversine formula. `extractZip(location)` pulls first 5-digit match from location string. Applicant search toolbar shows a radius `<select>` (5/10/15/25/50 mi, default 15) when query is exactly 5 digits. `filteredApplicants` useMemo computes `nearbyZips` once per query+radius change and passes into `appMatchesSearch`.

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

### Phase 10A — Payroll Engine (SHIPPED 2026-04-19)
Three tables: `pay_periods`, `stylist_pay_items`, `pay_deductions` (see DB schema above). Admin-only UI at `/payroll` (list) + `/payroll/[id]` (detail). APIs under `src/app/api/pay-periods/`:
- `GET /api/pay-periods` — list periods with stylist count + total payout
- `POST /api/pay-periods` — rate-limited `payPeriodCreate` (10/hr). `maxDuration=60`. In `db.transaction()`: insert period, fetch active assignments+stylists, sum completed bookings `[start, endExclusive)`, resolve commission via `resolveCommission()`, batch-insert items with `netPayCents = commissionAmountCents`
- `GET /api/pay-periods/[id]` — period + items (sanitized stylists + deductions)
- `PUT /api/pay-periods/[id]` — forward-only status + notes/periodType; rejects edits when paid
- `PUT /api/pay-periods/[id]/items/[itemId]` — updates pay-type/hours/rate/flat/notes; re-fetches deductions and persists `netPayCents` via `computeNetPay()`; rejects when paid
- `POST /api/pay-periods/[id]/items/[itemId]/deductions` — inserts deduction + recomputes net pay; rejects when paid
- `DELETE /api/pay-periods/[id]/items/[itemId]/deductions/[deductionId]` — deletes + recomputes; rejects when paid
- `GET /api/pay-periods/[id]/export` — rate-limited `payrollExport` (20/hr). CSV with dollar-formatted columns + total row. `maxDuration=60`
Helper: `src/lib/payroll.ts` (`computeNetPay`, `NetPayInputs`). Net pay = `max(0, base − Σ deductions)`. `paid` locks all item/deduction mutations. Every mutation calls `revalidateTag('pay-periods', {})`.

### Phase 10B — QuickBooks Online Integration (SHIPPED 2026-04-20)
Per-facility OAuth2 connection, stylists mapped to QB Vendors, pay periods pushed as one QB Bill per stylist, payment status pulled back to auto-flip periods to `paid` when every Bill's `Balance === 0`.

**Schema** — see the new columns on `facilities` (5 QB cols incl. `qb_expense_account_id`), `stylists` (`qb_vendor_id`), `pay_periods` (`qb_synced_at`, `qb_sync_error`), `stylist_pay_items` (`qb_bill_id`, `qb_bill_sync_token`, `qb_sync_error`), and `oauth_states` (relaxed `stylist_id` + new `facility_id`) documented above. No new tables.

**Helper** — `src/lib/quickbooks.ts` centralizes OAuth + API calls:
- `getQBAuthUrl(state, redirectUri)`, `exchangeQBCode(code, redirectUri)`, `refreshQBToken(facilityId)`, `qbGet<T>(facilityId, path)`, `qbPost<T>(facilityId, path, body)`, `revokeQBToken(refreshToken)`.
- Refresh runs 5 min before expiry; concurrent refreshes deduped via an in-memory `Map<facilityId, Promise<string>>`.
- `qbFetch` retries once on 401 by clearing cached expiry.
- Never read `facilities.qb_access_token` directly — always go through the helper.

**API routes under `src/app/api/quickbooks/`**:
- `GET /connect` — admin-only. Inserts `oauth_states` row with `userId` + `facilityId`, redirects to Intuit authorize URL with nonce state.
- `GET /callback` — Intuit redirect target. Validates state (userId match, facilityId present, 10-min TTL), exchanges code, stores tokens + `qb_realm_id`, deletes state row. Redirects `/settings?qb=connected#integrations` or `?qb=error&reason=…`.
- `POST /disconnect` — admin-only. Clears all QB columns on the facility. Fire-and-forget revoke against `developer.api.intuit.com/v2/oauth2/tokens/revoke`.
- `GET /accounts` — admin-only, rate-limited. Lists active Expense accounts for the Settings picker.
- `POST /sync-vendors` — admin-only, rate-limited, `maxDuration=60`. Creates or sparse-updates QB Vendors for every active assigned stylist; never fails the batch on a per-stylist error. Exports `syncVendorsForFacility(facilityId, filterStylistIds?)` for inline reuse by sync-bill.
- `POST /sync-bill/[periodId]` — admin-only, rate-limited, `maxDuration=60`. Requires `period.status !== 'open'` (412) and `facility.qbExpenseAccountId` (412). Auto-calls `syncVendorsForFacility` for any stylist missing a vendor. Pushes one Bill per stylist with `netPayCents > 0`; sparse-updates existing Bills via GET-for-SyncToken → POST `{Id, SyncToken, sparse: true}`. Writes `qb_bill_id` / `qb_bill_sync_token` per item and aggregate `qb_synced_at` on the period. `revalidateTag('pay-periods', {})`.
- `POST /sync-status/[periodId]` — admin-only, rate-limited. GETs each `/bill/<qbBillId>`; when all balances are zero and status ≠ paid, flips period to `paid` + `revalidateTag('pay-periods', {})`.

**Rate limit** — `quickbooksSync` bucket 15/hr/user (`src/lib/rate-limit.ts`).

**CSP** — `next.config.ts` `connect-src` extended with `https://quickbooks.api.intuit.com https://oauth.platform.intuit.com https://appcenter.intuit.com https://developer.api.intuit.com`.

**Sanitize** — `SENSITIVE_KEYS` adds `qbAccessToken` + `qbRefreshToken`. `sanitizeFacility()` drops both and surfaces `hasQuickBooks: boolean` on `PublicFacility`.

**UI** — Settings → Integrations tab shows a Connect / Connected card (expense account picker, Sync Vendors, two-click Disconnect, `?qb=connected` / `?qb=error&reason=…` toast handling). Payroll detail (`/payroll/[id]`) shows a QB panel gated on `hasQuickBooks && period.status !== 'open'` with Push / Re-push / Sync Payment Status / Retry Sync buttons and per-stylist error listing.

**Env** — `QUICKBOOKS_CLIENT_ID` + `QUICKBOOKS_CLIENT_SECRET` + `QB_TOKEN_SECRET` (all server-only; no `NEXT_PUBLIC_*`). `QB_TOKEN_SECRET` is a 32-byte hex key used for AES-256-GCM token encryption; generate with `openssl rand -hex 32`.

### Phase 10B+ — Payroll extensions (pending)
Recurring pay period auto-creation, payroll emails to stylists, QuickBooks error log table + automated retry with backoff (rescoped from legacy Phase 14), and stylist self-service payroll viewing.

### Phase 11A — Billing AR Foundation (SHIPPED 2026-04-20)
Three new tables (`qb_invoices`, `qb_payments`, `qb_unresolved_payments`), four new columns on `facilities` and `residents` — see schema reference above. One-off migration: `scripts/migrate-billing-schema.mjs` (deleted after run).

**Import route** — `POST /api/super-admin/import-billing-history` (master admin only, `maxDuration=120`, `billingImport` rate limit 5/hr). Accepts two optional form-data files:
- `invoices` — QB Invoice List CSV (PapaParse `header:true`). Only `Transaction type === 'Invoice'` rows. Derives facilityId from Name column prefix before `:`. Upsert on `(invoice_num, facility_id)` with status recomputed from `openBalance/amount` ratio.
- `transactions` — QB Transaction List CSV (PapaParse `header:false`). Scans first 20 rows for header with "Date" + "Transaction type" columns. Tracks `currentFacilityId` from col0 F-code rows. Inserts `Payment` detail rows via `onConflictDoNothing` on the natural key index.

After both imports: two raw `db.execute(sql\`UPDATE...\`)` correlated subqueries recompute `qb_outstanding_balance_cents` on `facilities` and `residents`.

**UI** — `/super-admin/import-billing-history` page + client component (same 3-state pattern as QB import). Two file pickers, at least one required. "Import Billing History" link in super-admin header. Rate limit: `billingImport` 5/hr (added to `src/lib/rate-limit.ts`).

### Phase 11B — AR Dashboard (SHIPPED 2026-04-20)
Route `/billing`. Role-gated: master_admin all facilities (via `NEXT_PUBLIC_SUPER_ADMIN_EMAIL`), facility_admin their facility only (no switcher), stylist/viewer redirect to `/dashboard`. Three views branching on `facilities.payment_type`: **IP** (per-resident table — resident/room/last service/billed/paid/outstanding/last sent+channel), **RFMS** (rev-share note + checks-received table + per-resident breakdown), **hybrid** (split panel reusing IP+RFMS filtered by `residents.resident_payment_type`). Legacy `payment_type='facility'` maps to RFMS view. All views show Send Statement (disabled, Phase 11C) + Send via QB (disabled, Phase 11F) buttons.

**Files shipped:** `src/app/api/billing/summary/[facilityId]/route.ts` (admin-guarded GET returning facility+residents+invoices+payments with column whitelists — no token leakage); `src/app/(protected)/billing/page.tsx` (server component auth+role guard, master-admin facility list branch); `src/app/(protected)/billing/billing-client.tsx` (top-level with facility selector for master, totals card, view branching, useEffect fetch, loading skeleton + empty state); `src/app/(protected)/billing/views/billing-shared.tsx` (interfaces + `formatDollars`, `formatInvoiceDate`, `formatShortDate`, `formatSentVia`, `revShareLabel`, `computeResidentTotals`, `DisabledActionButton`, `StatCard`); `src/app/(protected)/billing/views/ip-view.tsx`; `src/app/(protected)/billing/views/rfms-view.tsx`; `src/app/(protected)/billing/views/hybrid-view.tsx`. Sidebar `/billing` nav entry inserted between Reports and Payroll (admin-only, inline receipt+$ SVG). No mobile-nav entry (5-icon bar already full). No schema changes, no mutations, no rate-limit changes. Uses burgundy `#8B2E4A` palette (NOT `#0D7377` teal per CLAUDE.md rule).

### Phase 11C — Statement & Reminder Emails (SHIPPED 2026-04-20)
Three send routes under `/api/billing/send-statement/`: `facility/[facilityId]`, `resident/[residentId]`, `facility/[facilityId]/all-residents`. `billingSend` 20/hr bucket in rate-limit.ts. 7-day dedup via `max(lastSentAt)` on `qbInvoices` → `{ warning, lastSentAt }` when within 7d; client re-POSTs `{ force: true }` via `SendDedupModal`. `await sendEmail()` (not fire-and-forget) — `lastSentAt`+`sentVia='resend'` only persisted on confirmed send. Templates (`buildFacilityStatementHtml`/`buildResidentStatementHtml`) in `src/lib/email.ts`, inline styles only, footer `pmt@seniorstylist.com · 443-450-3344`. BillingFacility gains `contactEmail`/`address`; BillingResident gains `poaEmail`. QB path ("Send via QB") stays disabled pending 11F.

### Phase 11C.5 — Billing Hub Redesign + Animation System (SHIPPED 2026-04-20)
**New shared modules**: `src/lib/animations.ts` (motion constants: `btnBase`, `btnHubInteractive`, `cardHover`, `transitionBase`, `expandTransition`, `modalEnter`, `successFlash`, `shimmer`), `src/hooks/use-count-up.ts` (`useCountUp(target, duration=600)` — rAF + easeOutCubic, seeds initial value to target for SSR, honors `prefers-reduced-motion`), `src/app/(protected)/billing/views/expandable-section.tsx` (accordion pattern with 5000px max-height cap, chevron rotation via `transitionBase`). `src/components/ui/button.tsx` tightened from `active:scale-95` → `active:scale-[0.97] ease-out`; no site-wide hover-scale.

**New API routes**:
- `GET /api/billing/cross-facility-summary` — master admin only (`NEXT_PUBLIC_SUPER_ADMIN_EMAIL`), returns `{ totalOutstandingCents, collectedThisMonthCents, invoicedThisMonthCents, facilitiesOverdueCount }` via four `db.execute(sql\`...\`)` aggregates. `maxDuration=30`, `dynamic='force-dynamic'`. **Access pattern**: project postgres driver returns rows iterable from `db.execute` (NOT under `.rows`) — use `(rows[0] as { total?: unknown })?.total`.
- `PATCH /api/facilities/[facilityId]/rev-share` — admin or master only; facility admins scoped to own facility. Zod body `{ revShareType: 'we_deduct' | 'facility_deducts' }`. Updates `facilities.qb_rev_share_type`. No rate limit. `dynamic='force-dynamic'`.

**Rebuilt billing UI** (`billing-client.tsx`): cross-facility summary bar (master admin only, 4 animated count-up cards), hub card with serif facility name + mono facility-code badge + payment-type pill + inline-spinner Send Statement button + 3 animated stat tiles + rev-share pill toggle (RFMS/facility/hybrid only) with `successFlash`-wrapped Save button. `IPView`/`RFMSView`/`HybridView` now accept `title`/`defaultOpen` overrides; all three wrap contents in `<ExpandableSection>`. Rose-50 rev-share notice removed from RFMSView (hub card replaces it). Skeleton loaders use `.skeleton-shimmer` class (not `animate-pulse bg-stone-100`).

### Phase 11C.6 — Billing Polish: Formatting, Drill-downs, Date Range, Sortable Residents (SHIPPED 2026-04-20)
**Six compounding polish fixes** on the billing hub — no schema changes, no new data.

1. **Comma formatting**: `formatDollars` rewritten as `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })` singleton in `billing-shared.tsx`. All money values render with thousands separators (`$316,796.94`). Automatic negative-sign placement (`-$1,234.56`).
2. **RFMS year subheaders**: checks list (a 12-col `<div>` grid, NOT `<table>`) groups rows by year from `paymentDate`. Year appears as a sibling `<div>` above the first check of each year — `text-xs font-bold text-stone-400 uppercase tracking-widest`. Uses `Fragment` + IIFE + `let lastYear` since data already arrives sorted `payment_date DESC`.
3. **Date range toggle**: new pill row on hub card with 4 periods: **Month** (default), **Year**, **Custom** (opens From/To date inputs + Apply), **All**. State: `activePeriod: 'month'|'year'|'custom'|'all'` + `dateRange: {from, to}`. `toISODate()` uses local-timezone components to avoid UTC drift. Server fetch URL is now `/api/billing/summary/{id}?from=YYYY-MM-DD&to=YYYY-MM-DD`.
4. **Summary route accepts `?from=&to=`** — Zod-validated regex `/^\d{4}-\d{2}-\d{2}$/`, filters `qb_invoices.invoice_date` and `qb_payments.payment_date` when both params present. Absence = full history (back-compat preserved).
5. **Sortable IP resident columns** — `ip-view.tsx` now sortable on 5 columns (Resident/Room/Last Service/Billed/Outstanding). Default: Outstanding desc. Null lastService dates sort last regardless of direction. Room sort uses `localeCompare({ numeric: true })`. `SortHeader` subcomponent with `↕/↑/↓` arrow.
6. **Cross-facility drill-downs** — master-admin-only. Four cards on the cross-facility bar become `<button>`s opening a slide-over panel (`src/app/(protected)/billing/components/cross-facility-panel.tsx`) — `fixed inset-y-0 right-0 w-full max-w-2xl animate-in slide-in-from-right duration-300` with backdrop + Escape key support. Rows are clickable — select a facility and the hub switches to it. Footer has "View Full Report →" link to per-type report page.

**New API route**: `GET /api/billing/cross-facility-detail?type=outstanding|collected|invoiced|overdue` — master admin only. One of four `db.execute(sql\`...\`)` SQL variants. Returns `{ data: Array<{ facilityId, facilityCode, name, valueCents, daysOverdue? }> }`. `maxDuration=30`, `dynamic='force-dynamic'`. Rows accessed as iterable (`rows[0]`, NOT `.rows`). `Number(row.value_cents)` normalizes postgres bigint-as-string.

**Four new report pages**: `/billing/{outstanding,collected,invoiced,overdue}` — server-component master-admin redirect gate, renders shared `CrossFacilityReportClient` (`src/app/(protected)/billing/components/cross-facility-report-client.tsx`). Full sortable table (columns: Facility / Code / Value / Days Overdue?), Download CSV (client-side `Blob` + `URL.createObjectURL`), Back to Billing link. Row click → `router.push('/billing?facility=<ID>')` deep-link to the hub. Default sort per type: `value` desc (except `overdue` → `daysOverdue` desc).

**`billing-client.tsx` now reads `?facility=` query param** via `useSearchParams()`; overrides initial state when param is present + in `facilityOptions`. `page.tsx` wraps `<BillingClient>` in `<Suspense fallback={null}>` per Next.js 16 requirement.

**Outstanding tile sourcing nuance**: when `activePeriod === 'all'`, `totals.outstanding = facility.qbOutstandingBalanceCents` (authoritative 11C.5 value). Otherwise, `totals.outstanding = sum(invoice.openBalanceCents)` over the filtered invoice set. Billed/Received always derived from the filtered arrays.

### Phase 11D — Check Scanning (SHIPPED 2026-04-20)
End-to-end paper-check intake with Gemini 2.5 Flash OCR + confirmation + unresolved queue. Entry point: "Scan Check" button next to "Send Statement" on the billing hub.

**Schema additions** (additive; migration script `scripts/migrate-11d.mjs` run once and deleted per CLAUDE.md pattern):
- `qb_payments.payment_method text NOT NULL default 'check'` (CHECK `IN ('check','cash','ach','other')`) + `resident_breakdown jsonb` (jsonb array of `{name, residentId, amountCents, matchConfidence}` for RFMS/hybrid single-row facility checks).
- `qb_unresolved_payments` (Phase 11A scaffolding retained, unused 11A columns kept) gains: `resolved_at timestamptz`, `resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL`, `raw_ocr_json jsonb`, `extracted_check_num/date/amount_cents/payer_name/invoice_ref/invoice_date`, `extracted_resident_lines jsonb`, `confidence_overall text` (CHECK `IN ('high','medium','low')`), `unresolved_reason text`. Partial index `WHERE resolved_at IS NULL` on `facility_id` for the banner count query.
- New Supabase storage bucket `check-images` (private, 10MB limit, MIME allowlist: jpeg/png/webp/heic/heif). All reads go through service-role signed URLs (1-hour TTL).

**New routes**:
- `POST /api/billing/scan-check` — multipart (`image` + `facilityId`). Auth: admin or master, facility ownership enforced. Rate limit `checkScan` 30/hr/user. Validates MIME + ≤10MB, uploads to `check-images/{facilityId}/{timestamp}-{uuid}.{ext}` via service-role, base64-encodes the in-memory buffer and fires Gemini 2.5 Flash via direct fetch (v1beta, `inlineData`+`text`, same pattern as daily-log OCR). Strips markdown fences from the response and parses JSON. Fuzzy-matches facility (exact name → fuzzy score → facility-code from invoiceRef → payer address substring; skip when payer address is `2833 Smith Ave`, our mailing address), residents (scoped to matched facility, `fuzzyBestMatch` + room-number fallback), invoices (exact open-balance match → `high`; partial → `partial`; else `none`). Returns a confidence-annotated `ScanResult`. Unresolvable path returns 200 with `unresolvable: true` + a reason so the UI can offer "Save as Unresolved". `maxDuration=60`, `dynamic='force-dynamic'`.
- `POST /api/billing/save-check-payment` — admin/master, facility-scoped, Zod-validated with `.max()` caps. Two modes via `mode: 'resolve' | 'save_unresolved'`. Resolve mode runs inside a single `db.transaction()`: (1) per-resident `qb_payments` rows for IP slice; (2) one facility-level row with `resident_breakdown` jsonb for RFMS/hybrid slice; (3) optional cash-also-received row with `payment_method: 'cash'`; (4) exact-match invoice decrement (only when `invoiceMatchConfidence === 'high'` — sets `open_balance_cents=0, status='paid'`); (5) facility + per-resident balance recompute via two correlated `UPDATE…SELECT SUM(open_balance_cents)` subqueries; (6) optional `qbUnresolvedPayments.resolvedAt/resolvedBy` update when `unresolvedId` provided. Save-as-unresolved mode skips all payment writes and inserts a single `qbUnresolvedPayments` row. `maxDuration=60`, `dynamic='force-dynamic'`, no rate limit (admin-gated low-frequency).
- `GET /api/billing/unresolved-count[?facilityId=]` — admin scoped to own facility; master can omit `facilityId` for total or pass one to scope. Returns `{ data: { count } }`.
- `GET /api/billing/unresolved[?facilityId=]` — same auth/scoping, returns up to 200 rows with per-row signed URLs for `check_image_url`, ordered `createdAt DESC`. Left-joins `facilities` for name/code.

**New rate-limit bucket**: `checkScan` 30/hr/user in `src/lib/rate-limit.ts`.

**New/modified files**:
- `src/lib/fuzzy.ts` (NEW) — canonical fuzzy-match module. Exports `WORD_EXPANSIONS`, `normalizeWords`, `fuzzyScore`, `fuzzyMatches`, `fuzzyBestMatch`. Extracted from `ocr-import-modal.tsx` (which now imports from this module — no behavior change). Do NOT re-implement fuzzy matching inline anywhere else.
- `src/db/schema.ts` — additive columns on `qbPayments` and `qbUnresolvedPayments`. The unused Phase 11A columns on `qbUnresolvedPayments` are kept and marked `// @deprecated 11A scaffolding, unused`.
- `src/app/(protected)/billing/components/scan-check-modal.tsx` (NEW, ~620 lines) — 3-step modal (Upload → Confirm → Success). Upload step uses `<input type="file">` with `accept` for allowed MIMEs and `capture="environment"` on the mobile-only "Take Photo" variant. Confirm step is a two-column layout (image left `max-h-[540px] overflow-y-auto`, form right). Low/medium-confidence fields are wrapped in `bg-amber-50 border-amber-200`. Resident lines editor with per-row raw name / resident `<select>` / amount input / × remove. Invoice match banners: emerald (high exact), amber (partial with remaining), stone (none). Cash also received checkbox. Payment method pills (check/cash/ach/other). **Total accuracy invariant**: `linesTotal + cashCents === amountCents && lines.length > 0` gates the "Record Payment" button. Resolve-from-unresolved mode auto-starts at the confirm step with pre-populated state.
- `src/app/(protected)/billing/components/cross-facility-panel.tsx` — `PanelType` union extended with `'unresolved'`. New exported `UnresolvedRow` interface. New `facilityId?: string | null` prop (scopes the unresolved fetch; unset on master's 5th-card path). New `onResolveUnresolved?: (row, scanResult) => void` callback. Fetches from `/api/billing/unresolved` when `type === 'unresolved'` (else `/api/billing/cross-facility-detail`). Unresolved grid columns: Scanned · Facility(+code) · Amount · Reason · Resolve → button. `handleResolveClick(row)` reshapes the saved record (all extracted fields wrapped as `FieldValue<T>` with `confidence: 'medium'`) into a `ScanResult` the modal can consume. Footer "View Full Report →" link is suppressed for `unresolved` (no dedicated drill-down page).
- `src/app/(protected)/billing/components/cross-facility-report-client.tsx` — adds a local `ReportPanelType = Exclude<PanelType, 'unresolved'>` type so the four drill-down report pages remain typed strictly to the four report variants.
- `src/app/(protected)/billing/billing-client.tsx` — wires everything together. Imports `ScanCheckModal` + `ScanResult`. New state `showScanModal`, `scanResolveData`, `unresolvedCount` (per-facility for banner), `totalUnresolvedCount` (master all-facility for 5th card). Two new `useEffect` fetches for unresolved counts (re-run on `refreshKey`/`facilityId`). New "Scan Check" button with camera SVG next to Send Statement (stone-100 pill). New amber unresolved banner (`bg-amber-50 border border-amber-200`, `⚠ N unresolved scan(s)` + Review → button that opens the unresolved panel). 5th master-admin card "Unresolved Scans" added to the cross-facility grid (changed from `md:grid-cols-4` to `md:grid-cols-5`; red-tinted `bg-red-50 border-red-100` when count > 0). Modal mount alongside `SendDedupModal` + `CrossFacilityPanel`. `onResolveUnresolved` callback passed to the panel: sets `scanResolveData`, opens the modal, closes the panel.
- `src/app/(protected)/log/ocr-import-modal.tsx` — local fuzzy definitions removed, now imports from `@/lib/fuzzy`. Zero behavior change.

**Key invariants**:
- `check-images` bucket is PRIVATE. Upload via service-role only; regenerate signed URLs (1-hour TTL) at read time. Never store or expose raw URLs.
- Total accuracy (`linesTotal + cashCents === amountCents`) MUST pass before save.
- Invoice decrement is exact-match only. Partial/none leaves invoices untouched (documented limitation — reconciled on next CSV re-import).
- `qb_unresolved_payments` is the only persistence path for OCR-failed documents. Never silently drop a scan.
- `src/lib/fuzzy.ts` is the canonical fuzzy-match module. Never re-implement inline.

### Phase 11E — Resident Portal Isolation (PLANNED — Opus)
Invite links: `portal/[facilityCode]/[portalToken]` using existing `residents.portal_token`. Facility locked at account creation, no switcher ever. Billing page added to existing services portal as additional tab — same auth context. "Copy invite link" + "Send invite email" buttons on resident records. Cross-facility access → 403.

### Phase 11F — QB API Live Sync (PLANNED — Opus)
Manual sync per facility. Route: `POST /api/quickbooks/sync-invoices/[facilityId]`. First sync backfills `qb_invoice_id` on CSV-imported records. Requires Intuit production approval. Until approved → button hidden.

### Phase 11G — Revenue Share Integration (PLANNED — Opus)
New `facilities.rev_share_percentage` integer column. Per-invoice stylist/facility split calculation. New `qb_invoice_id` on `stylist_pay_items` links payroll to invoices. Billing view shows split breakdown. Payroll detail shows corresponding invoices.

### Phase 12 — Franchise Layer + Bookkeeper Role (PLANNED — Opus)
New `franchises` table, `franchise_facilities` join, `franchise_users` with `franchise_head` role. Each franchise head sees only their franchise's facilities. Bookkeeper role (between admin and stylist in hierarchy): read billing/payroll/AR, record payments, mark invoices paid, link unresolved checks, export reports. Cannot manage residents/bookings/services/stylists. Scoped to franchise/facility like all other roles.

### Phase 13 — Per-Stylist Google Calendar Integration (PLANNED — Sonnet)
Per-stylist OAuth2 connect to Google Calendar. Bookings sync as calendar events. Already in roadmap from prior planning.

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
