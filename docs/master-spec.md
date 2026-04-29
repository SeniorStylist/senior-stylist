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

- **`UserRole`**: `'admin' | 'stylist' | 'viewer'` — used for **profile** typing.
- **`FacilityUserRole`** (Phase 11J.1): `'admin' | 'super_admin' | 'facility_staff' | 'bookkeeper' | 'stylist' | 'viewer'` — TypeScript union for facility-scoped roles. The **`facility_users.role`** column is plain `text` in Drizzle (no CHECK constraint), so no DB migration was needed when the union expanded.

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

Sidebar renders four nav groups (SCHEDULING / MANAGEMENT / FINANCIAL / ACCOUNT) plus a divider followed by Settings + Master Admin (always last). The page URL is `/master-admin` (Phase 11J.2 rename from `/super-admin`). A redirect page at `/super-admin` handles saved bookmarks.

| Area | admin | facility_staff | bookkeeper | stylist |
|------|-------|----------------|------------|---------|
| **Calendar** (`/dashboard`) | ✓ | ✓ | — | ✓ |
| **Residents** (`/residents`) | ✓ | ✓ | — | — |
| **Daily Log** (`/log`) | ✓ | ✓ (read-only) | ✓ (read-only) | ✓ (own entries) |
| **Stylists** (`/stylists`) | ✓ | — | — | — |
| **Directory** (`/stylists/directory`) | ✓ | — | — | — |
| **Services** (`/services`) | ✓ | — | — | — |
| **Billing** (`/billing`) | ✓ | — | ✓ | — |
| **Analytics** (`/analytics`) | ✓ | — | ✓ | — |
| **Payroll** (`/payroll`) | ✓ | — | ✓ | — |
| **My Account** (`/my-account`) | — | — | — | ✓ |
| **Settings** (`/settings`) | ✓ | ✓ | ✓ | — |
| **Master Admin** (`/master-admin`) | (master email only, hidden in debug mode) |

- `super_admin` is normalized to `admin` by `getUserFacility()` so it inherits all admin nav.
- `viewer` is a legacy role kept in the type union but no longer offered in the invite picker; it appears in no nav row.
- **`/reports`** server page still redirects non-admins to **`/dashboard`** (`src/app/(protected)/reports/page.tsx`).

### Route-level guards (server page components, OUTSIDE try/catch)

Phase 11J.1 fix added server-side guards to all protected pages. All `redirect()` calls are placed OUTSIDE try/catch blocks (Next.js redirect throws internally; a catch block swallows it).

| Route | Guard | Notes |
|-------|-------|-------|
| `/dashboard` | bookkeeper → redirect `/billing` | Bookkeeper's home is billing, not the calendar |
| `/billing` | `!canAccessBilling(role)` → redirect `/dashboard` | Allows admin + bookkeeper |
| `/analytics` | `!canAccessBilling(role)` → redirect `/dashboard` | Allows admin + bookkeeper |
| `/payroll` | `!canAccessPayroll(role)` → redirect `/dashboard` | Allows admin + bookkeeper |
| `/payroll/[id]` | `!canAccessPayroll(role)` → redirect `/dashboard` | Allows admin + bookkeeper |
| `/settings` | `role === 'stylist' \|\| role === 'viewer'` → redirect `/dashboard` | Allows admin + facility_staff + bookkeeper |
| `/my-account` | `role !== 'stylist'` → redirect `/dashboard` | Stylist-only page |
| `/residents` | `role === 'stylist'` → redirect `/dashboard` | Bookkeeper allowed (read-only UI gates) |
| `/residents/[id]` | `role === 'stylist'` → redirect `/dashboard` | Bookkeeper allowed (read-only UI gates) |
| `/residents/import` | `!isAdminOrAbove(role) && !isFacilityStaff(role)` → redirect `/dashboard` | Write action |
| `/services` | `role !== 'admin'` → redirect `/dashboard` | Admin-only |
| `/services/import` | `!isAdminOrAbove(role)` → redirect `/dashboard` | Admin-only |
| `/stylists` | `role !== 'admin'` → redirect `/dashboard` | Admin-only |
| `/stylists/directory` | `role !== 'admin'` → redirect `/dashboard` | Admin-only |
| `/stylists/[id]` | `!isAdminOrAbove(role)` → redirect `/dashboard` | Admin-only |
| `/billing/outstanding` etc. | master email only → redirect `/billing` | Cross-facility drill-downs |
| `/master-admin` | master email only → redirect `/dashboard` | `NEXT_PUBLIC_SUPER_ADMIN_EMAIL` gate |
| `/super-admin` | → redirect `/master-admin` | Bookmark compatibility only |

### Stylist role behavior

- **Dashboard mobile**: shows today-list filtered to own bookings via `profileStylistId` (looked up from `profiles.stylistId`).
- **Daily Log**: filtered to own stylist section only (via `stylistFilter` prop from page.tsx).
- **Inline editing**: can edit price and notes on own bookings. Edit button gated by `stylistFilter` match + not finalized + not cancelled.
- **API ownership guard**: `PUT /api/bookings/[id]` checks `profiles.stylistId` against `existing.stylistId` — stylists can only edit their own bookings (403 otherwise).
- **`PUT /api/bookings/[id]`** accepts `priceCents: number` directly in the update schema. A direct `priceCents` override takes precedence over service-change-derived price.

### Dashboard & settings flags

- **`isAdmin`** is `facilityUser.role === 'admin'` on the dashboard (`src/app/(protected)/dashboard/page.tsx`): non-admins do not get admin-only panel actions (e.g. add residents / services / stylists from the dashboard panels).
- Settings UI receives **`role`** (full role string, not `isAdmin` boolean) and uses it to derive `visibleCategories` per role (`src/app/(protected)/settings/settings-client.tsx`). It also receives `adminEmail` (`process.env.NEXT_PUBLIC_ADMIN_EMAIL`) for the Notifications section.

### API enforcement (explicit checks in code)

**Phase 11J.1 helper functions** (`src/lib/get-facility-id.ts`) — use these instead of bare `role !== 'admin'` when bookkeeper or facility_staff should be allowed:
- `isAdminOrAbove(role)` — `admin`, `super_admin`
- `canAccessBilling(role)` — `admin`, `super_admin`, `bookkeeper`
- `canAccessPayroll(role)` — `admin`, `super_admin`, `bookkeeper`
- `isFacilityStaff(role)` — `facility_staff`

**Routes that allow `bookkeeper` via `canAccessBilling` / `canAccessPayroll`** (Phase 11J.1):
- `/api/billing/*` (summary, scan-check, save-check-payment, send-statement/*, unresolved, unresolved-count)
- `/api/facilities/[facilityId]/rev-share`
- `/api/reports/invoice`, `/api/reports/mark-paid`
- `/api/export/bookkeeper`
- `/api/pay-periods/*` (all routes including items + deductions + export)
- `/api/quickbooks/*` (connect, disconnect, accounts, sync-vendors, sync-bill, sync-status)

**Routes that allow `facility_staff` via positive guard** (Phase 11J.1):
- `POST /api/bookings`, `PUT /api/bookings/[id]`, `DELETE /api/bookings/[id]`, `POST /api/bookings/recurring` — admin OR facility_staff OR stylist (existing stylist-self check on PUT preserved at line 94-98)
- `POST /api/residents`, `PUT /api/residents/[id]`, `DELETE /api/residents/[id]` — admin OR facility_staff
- `GET /api/residents`, `GET /api/residents/[id]` — unchanged (any facility user, including bookkeeper)

**Routes that stay strict admin-only**: services (`/api/services/*`), stylists (`/api/stylists/*`), invites (`/api/invites/*`), applicants (`/api/applicants/*`), compliance (`/api/compliance/*`), coverage (`/api/coverage/*`), availability (`/api/availability/*`), super-admin (`/api/super-admin/*`), access-requests (`/api/access-requests/*`), facility (`/api/facility/*`), `/api/log/ocr/*`, portal admin (`/api/portal/create-magic-link`, `/api/portal/send-invite`), `/api/stylists/[id]/invite`. Their existing `role !== 'admin'` guards already exclude `facility_staff`, `bookkeeper`, and `viewer` — no changes needed.

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
| `qb_invoices_last_synced_at` | `timestamptz`, nullable (Phase 11M) — wall-clock timestamp of the last successful invoice sync |
| `qb_invoices_sync_cursor` | `text`, nullable (Phase 11M) — ISO 8601 timestamp used as `Metadata.LastUpdatedTime > '<cursor>'` filter on the next incremental sync |
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

### `quickbooks_sync_log` (Phase 11N)

| Column | Notes |
|--------|--------|
| `id` | PK `uuid`, default random |
| `pay_period_id` | FK → `pay_periods.id` ON DELETE CASCADE, **nullable** — direct vendor syncs have no period context |
| `facility_id` | FK → `facilities.id` ON DELETE CASCADE, NOT NULL |
| `stylist_id` | FK → `stylists.id` ON DELETE SET NULL, nullable |
| `action` | `text` NOT NULL — `push_bill | sync_status | sync_vendors` |
| `status` | `text` NOT NULL — `success | error | partial` |
| `qb_bill_id` | `text`, nullable |
| `error_message` | `text`, nullable |
| `response_summary` | `text`, nullable |
| `created_at` | `timestamptz` NOT NULL default now |

Indexes: `qb_sync_log_period_idx(pay_period_id, created_at)`, `qb_sync_log_facility_idx(facility_id, created_at)`. RLS enabled with `service_role_all`. All inserts are fire-and-forget (`.catch(e => console.error('[qb-log]', e))`) — never awaited, never propagate failure.

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
| `reconciliation_status` | `text` default `'unreconciled'` — Phase 11K. CHECK in `unreconciled \| reconciled \| partial \| flagged` |
| `reconciled_at` | timestamptz, nullable — Phase 11K |
| `reconciliation_notes` | `text`, nullable — Phase 11K |
| `reconciliation_lines` | `jsonb`, nullable — Phase 11K. `ReconciliationLine[]`: `{ invoiceRef, invoiceDate, residentId, residentName, amountCents, confidence: 'high'\|'medium'\|'unmatched', logEntryId, logDate, logStylistName, flagReason }`. `logEntryId` actually stores a `bookings.id` (the booking that proves the service was on the calendar that date). |
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

**New columns on `facilities`**: `qb_outstanding_balance_cents integer DEFAULT 0`, `qb_rev_share_type text DEFAULT 'we_deduct'`, `rev_share_percentage integer` (nullable, Phase 11D.6).
**New columns on `residents`**: `qb_outstanding_balance_cents integer DEFAULT 0`, `resident_payment_type text`.

### `scan_corrections` (Phase 11D Round 4)

| Column | Notes |
|--------|--------|
| `id` | PK `uuid` `defaultRandom()` |
| `created_at` | `timestamptz` NOT NULL `defaultNow()` |
| `facility_id` | FK → `facilities.id` ON DELETE CASCADE, nullable |
| `document_type` | `text` NOT NULL (e.g. `RFMS_PETTY_CASH_BREAKDOWN`) |
| `field_name` | `text` NOT NULL (e.g. `checkNum`, `residentName`) |
| `gemini_extracted` | `text` nullable — what Gemini originally extracted |
| `corrected_value` | `text` NOT NULL — what the user changed it to |
| `context_note` | `text` nullable — reserved for future use |
| `created_by` | FK → `profiles.id` ON DELETE SET NULL, nullable |

RLS enabled. `service_role_all` policy. Indexes on `(document_type, field_name)` and `(facility_id, document_type)`. Used for few-shot learning injection into the Gemini scan prompt.

### `facility_merge_log` (Phase 11E)

| Column | Notes |
|--------|--------|
| `id` | PK `uuid` `defaultRandom()` |
| `created_at` | `timestamptz` NOT NULL `defaultNow()` |
| `performed_by` | FK → `profiles.id` ON DELETE SET NULL, nullable |
| `primary_facility_id` | FK → `facilities.id` ON DELETE SET NULL, nullable |
| `secondary_facility_id` | `uuid` — NOT a FK (secondary is deactivated but retained; capture id as historical value) |
| `secondary_facility_name` | `text` NOT NULL — snapshot of name at merge time |
| `residents_transferred` | `integer` NOT NULL DEFAULT 0 — residents re-pointed to primary (no conflict) |
| `residents_conflicted` | `integer` NOT NULL DEFAULT 0 — residents dedup'd (same name+room as a primary resident); bookings/invoices/payments re-pointed |
| `bookings_transferred` | `integer` NOT NULL DEFAULT 0 |
| `log_entries_transferred` / `_dropped` | `integer` each — dropped when primary already has an entry for same (stylist, date) |
| `stylist_assignments_transferred` / `_dropped` | `integer` each — dropped when primary already has assignment for same stylist |
| `qb_invoices_transferred` / `_dropped` | `integer` each — dropped when primary already has same invoice_num |
| `qb_payments_transferred` | `integer` NOT NULL DEFAULT 0 |
| `fields_inherited` | `text[]` NOT NULL DEFAULT `'{}'::text[]` — names of facility columns copied from secondary → primary (copy-if-null only) |
| `notes` | `text` nullable |

RLS enabled. `service_role_all` policy. Append-only audit log — no updates or deletes from application code. Written atomically as the final step of the merge transaction in `POST /api/super-admin/merge-facilities`.

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
| `/settings` | Apple-style two-pane settings (Phase 11J.3). Six categories: General, Team & Roles, Billing & Payments, Integrations, Notifications, Advanced. URL convention: `?section=<id>` (legacy `?tab=<id>` resolves via back-compat map). Role-gated: admin sees all; facility_staff sees only General (read-only); bookkeeper sees only Notifications (read-only); stylist/viewer redirected by `page.tsx` guard. Sections under `src/app/(protected)/settings/sections/`. Rev-share toggle was moved here from `/billing` (Phase 11J.3). |

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
- **Date-driven stylist auto-assign (admin booking modal, 2026-04-25)**: The admin booking modal no longer exposes a stylist `<select>`. When a date + service(s) are picked, the modal fetches `GET /api/stylists/available?facilityId=…&startTime=…&endTime=…` (with `AbortController` for stale-response cleanup) and shows the auto-assigned stylist read-only with a color swatch + "Auto-assigned (least-loaded)" sub-label. Server-side, `POST /api/bookings` and `POST /api/bookings/recurring` make `stylistId` optional and resolve via `resolveAvailableStylists()` + `pickStylistWithLeastLoad()` — the same helpers the resident portal uses. Recurring occurrences resolve per-occurrence and skip (rather than 409) when no stylist is on schedule for that day-of-week.
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

## Caching & revalidation

The app uses Next.js `unstable_cache` for expensive read aggregations and `revalidateTag(tag, {})` to invalidate caches on mutation. Tags currently in use:

| Tag | Cached queries | Mutation routes that revalidate |
|---|---|---|
| `bookings` | `super-admin/reports/{outstanding,monthly}` (`revalidate: 300`) | `POST/PUT/DELETE /api/bookings`, `POST /api/bookings/recurring`, `POST /api/portal/request-booking`, `POST /api/super-admin/reports/mark-paid`, `POST /api/webhooks/stripe` |
| `pay-periods` | (n/a — only used for revalidation) | `pay-periods/*`, `quickbooks/sync-bill`, `quickbooks/sync-status` |
| `billing` | (n/a — only used for revalidation) | `POST /api/webhooks/stripe` |
| `facilities` | `master-admin/page.tsx::getCachedFacilityInfos(yearMonthKey)` (`revalidate: 300`) | `POST /api/facilities`, `PUT /api/facility`, `PATCH /api/facilities/[facilityId]/rev-share`, `POST /api/super-admin/{merge-facilities,import-quickbooks,import-facilities-csv}` |
| `access-requests` | `master-admin/page.tsx::getCachedPendingAccessRequests()` (`revalidate: 60`) | `POST /api/access-requests`, `PUT /api/access-requests/[id]` |

Caching keys: `unstable_cache` takes a function-arg-based cache key plus a `keyParts: string[]` array. The master-admin facility cache passes `yearMonthKey` (e.g. `'2026-04'`) so the cache rotates when the calendar month flips (`bookingsThisMonth` filter depends on month boundary).

Always use the Next.js 16 second-arg signature: `revalidateTag('<tag>', {})`. Single-arg form is deprecated.

---

## API directory (`src/app/api/`)

| Route | Role / auth | Purpose |
|-------|-------------|---------|
| `GET/POST /api/bookings` | Authenticated | List/create bookings (query `start`/`end`); sends confirmation email on create. POST accepts optional `selectedQuantity`, `selectedOption`, `addonChecked` for flexible pricing — server resolves final price via `resolvePrice()`. Also accepts `serviceIds: string[]` for multi-service bookings (first = primary); `serviceId` is still accepted for single-service callers. Server populates `service_ids`, `service_names`, `total_duration_minutes` and sets `service_id = serviceIds[0]`. **`stylistId` is now optional** — when omitted, server auto-assigns via `resolveAvailableStylists()` + `pickStylistWithLeastLoad()` (same date-driven helpers the resident portal uses). Returns 409 if no stylist is on schedule for that date/time. |
| `POST /api/bookings/recurring` | Authenticated | Create parent + child recurring bookings; returns `{ parentId, count, skipped: [{date, reason}] }`. Accepts same pricing + multi-service fields as POST /api/bookings. `stylistId` is optional — each occurrence resolves its own stylist via `resolveAvailableStylists` + `pickStylistWithLeastLoad`; occurrences with no available stylist or booking conflicts are skipped (reported in `skipped[]`) rather than failing the whole batch |
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
| `GET /api/stylists/available` | Authenticated (admin own-facility, stylist own-facility) | Returns `{ available: [{id,name,color}], picked: {id,name,color} \| null }` for given `facilityId` + `startTime` + `endTime` (ISO). Runs the same `resolveAvailableStylists` + `pickStylistWithLeastLoad` pipeline used by the resident portal so the admin booking modal preview matches the server's actual pick. Used by booking modal to show the auto-assigned stylist before submit |
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
| ~~`POST /api/residents/[id]/send-portal-link`~~ | **DELETED** | Vestigial old-portal route removed in Phase 11I refactor. |
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
| `GET /api/super-admin/merge-candidates` | Super admin email only | Phase 11E. Returns `{ candidates, unpaired, fidFacilityCount }`. Fuzzy-matches every no-FID active facility against every FID active facility via `fuzzyScore` at threshold 0.6; buckets into `high` (score=1.0), `medium` (≥0.8), `low` (≥0.6). Each row carries per-facility resident/booking/stylist counts. |
| `POST /api/super-admin/merge-facilities` | Super admin email only | Phase 11E. Body: `{ primaryFacilityId, secondaryFacilityId, notes? }`. Wraps entire merge in `db.transaction()` — auto-rolls back on any throw. Migrates all 20 facility_id FK tables, handles 5 unique-constraint conflicts (log_entries, stylist_facility_assignments, stylist_availability, facility_users PK, qb_invoices) by deleting secondary row. Residents with same normalized name + room as a primary resident are soft-deleted and their bookings/invoices/payments/unresolved-payments re-pointed to the primary resident. Field inheritance: copy-if-null for 15 facility columns (address, phone, contactEmail, calendarId, qb*, workingHours, stripe*, revSharePercentage, serviceCategoryOrder). Secondary facility soft-deactivated (`active=false`). Writes one row to `facility_merge_log`. `maxDuration=60`. |
| `POST /api/debug/impersonate` | **Super admin email only** | Body `{ role: 'admin'\|'stylist', facilityId, facilityName }`. Sets `__debug_role` cookie (`httpOnly: false`, sameSite lax, 8h maxAge). Returns `{ data: { ok: true } }`. |
| `POST /api/debug/reset` | **Super admin email only** | Clears `__debug_role` cookie (`maxAge: 0`). Returns `{ data: { ok: true } }`. |
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
| `GET /api/quickbooks/callback` | Authenticated (Intuit redirect) | Validates `state` against `oauth_states` (userId match, facilityId present, 10-min TTL), exchanges `code` via `exchangeQBCode()`, stores `qb_realm_id` + tokens + `qb_token_expires_at` on the facility, deletes state row. Redirects `/settings?section=billing&qb=connected` or `?section=billing&qb=error&reason=…` (Phase 11J.3 — section param routes to Billing & Payments; the legacy `#integrations` hash was dropped). |
| `POST /api/quickbooks/disconnect` | **Admin** (Phase 10B) | Clears all QB columns (`qb_realm_id`, tokens, expiry, `qb_expense_account_id`). Fire-and-forget `revokeQBToken()` against Intuit's revoke endpoint. |
| `GET /api/quickbooks/accounts` | **Admin**, rate-limited `quickbooksSync` | Queries QB for active Expense accounts; returns sorted `{ id, name, accountType, accountSubType }[]` for the Settings picker. `maxDuration=60`. |
| `POST /api/quickbooks/sync-vendors` | **Admin**, rate-limited `quickbooksSync` | Creates or sparse-updates QB Vendors for every active assigned stylist in the facility. Never fails the whole batch — returns `{ created, updated, skipped, errors: [{ stylistId, message }] }`. Exports `syncVendorsForFacility(facilityId, filterStylistIds?)` for reuse. `maxDuration=60`. |
| `POST /api/quickbooks/sync-bill/[periodId]` | **Admin**, rate-limited `quickbooksSync` | Requires `period.status !== 'open'` (412) and `facility.qbExpenseAccountId` (412). Auto-calls `syncVendorsForFacility` for any stylist missing a vendor mapping. Pushes one Bill per stylist with `netPayCents > 0`; sparse-updates existing Bills via GET-for-SyncToken → POST `{Id, SyncToken, sparse: true}`. Writes `qb_bill_id` / `qb_bill_sync_token` per item + aggregate `qb_synced_at` on the period. `revalidateTag('pay-periods', {})`. `maxDuration=60`. |
| `POST /api/quickbooks/sync-status/[periodId]` | **Admin**, rate-limited `quickbooksSync` | GETs each `/bill/<qbBillId>` for items with a Bill. When every Balance === 0 and status ≠ paid, flips the period to `paid` + `revalidateTag('pay-periods', {})`. Returns `{ items, periodStatus, periodUpdated }`. |
| `POST /api/portal/send-invite` | **Admin** (Phase 11I) | Body `{ residentId }`. Verifies resident is in facility + has `poaEmail`. Calls `createMagicLink` and fires `buildPortalMagicLinkEmailHtml` via `sendEmail` (fire-and-forget). Updates `residents.last_portal_invite_sent_at = now()`. |
| `POST /api/portal/create-magic-link` | **Admin** (Phase 11I refactor) | Body `{ residentId }`. Same guards as send-invite. Returns `{ data: { link } }` — a 72h magic link URL. Does NOT send email, does NOT update `lastPortalInviteSentAt`. Used by the "Copy Link" button on resident detail. Rate-limited under `portalRequestLink` bucket. |
| `POST /api/portal/request-link` | **Public** (Phase 11I), rate-limited `portalRequestLink` | Body `{ email, facilityCode }`. Always returns `{ data: { sent: true } }` regardless of whether residents exist — never leaks email enumeration. When residents found, builds magic link and fires-and-forgets one email. |
| `POST /api/portal/login` | **Public** (Phase 11I), rate-limited `portalLogin` | Body `{ email, password, facilityCode }`. Generic `Invalid email or password` on any failure. Sets `__portal_session` cookie (`httpOnly`, `secure`, `sameSite=lax`, `maxAge=30d`). |
| `POST /api/portal/logout` | Authed (Phase 11I) | Reads cookie → `revokeSession` → clears cookie. |
| `POST /api/portal/set-password` | Authed (Phase 11I), rate-limited `portalSetPassword` | Body `{ password }` (`z.string().min(8).max(200)`). Hashes via PBKDF2-SHA256 210k iterations and writes to `portal_accounts.password_hash`. |
| `POST /api/portal/request-booking` | Authed (Phase 11I), rate-limited `portalRequestBooking` | Body `{ residentId, serviceIds: string[1..6], preferredDateFrom, preferredDateTo, notes }`. Verifies resident in session + every service in resident's facility + active. Resolves stylist via `resolveAvailableStylists` + `pickStylistWithLeastLoad` (fallback: first active facility stylist). Inserts `bookings` row with `status='requested'`, `requestedByPortal=true`, `portalNotes`, `serviceIds`, `serviceNames`, `totalDurationMinutes`, `priceCents`. Fires admin notification email via `buildPortalRequestEmailHtml`. `revalidateTag('bookings', {})`. |
| `GET /api/portal/statement/[residentId]` | Authed (Phase 11I), rate-limited `portalStatement` | Verifies resident in session. Reuses `buildResidentStatementHtml`. Returns HTML with `@media print` CSS + `<button onclick="window.print()">`. `Content-Type: text/html`. |
| `POST /api/portal/stripe/create-checkout` | Authed (Phase 11I), rate-limited `portalCheckout` | Body `{ residentId, amountCents }` (50–10_000_000). Stripe key = `facility.stripeSecretKey ?? STRIPE_SECRET_KEY`. Creates Checkout session with `metadata.type='portal_balance'`, `metadata.residentId`, `metadata.facilityId`, `metadata.facilityCode`. Returns `{ data: { checkoutUrl } }`. |
| `GET /api/cron/portal-cleanup` | **Vercel Cron** (Phase 11I, `Bearer CRON_SECRET`) | Daily 04:00 UTC. Deletes `portal_magic_links` rows older than 7 days past expiry; deletes expired `portal_sessions`. `maxDuration=30`. |

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
- `GET /callback` — Intuit redirect target. Validates state (userId match, facilityId present, 10-min TTL), exchanges code, stores tokens + `qb_realm_id`, deletes state row. Redirects `/settings?section=billing&qb=connected` or `?section=billing&qb=error&reason=…` (Phase 11J.3).
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
- `POST /api/billing/reconcile/[paymentId]` — Phase 11K. Auth `canAccessBilling` (admin/super_admin/bookkeeper) + facility ownership; master-admin bypass via env email. Body: none. Invokes `reconcilePayment(paymentId, facilityId)` from `src/lib/reconciliation.ts`, persists `reconciliation_status/reconciled_at/reconciliation_notes/reconciliation_lines` to the `qb_payments` row, calls `revalidateTag('billing', {})`. Returns `{ status, lines, matchedCount, unmatchedCount, notes }`. Match logic: same-day booking → `high`; ±1 day → `medium`; otherwise `unmatched`. Excludes bookings with `status IN ('cancelled', 'no_show', 'requested')`. Non-remittance payments are auto-marked `'reconciled'` with empty lines. Companion `GET` returns the cached result without re-running.
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

**Phase 11D.5 fixes shipped alongside**:
- `src/lib/fuzzy.ts`: added exported `STOP_WORDS` set (llc, inc, corp, dba, snf, rfms, petty, cash, account, operating, disbursement, at, of, the, and). `normalizeWords` now strips `#` chars and filters stop words before comparing.
- `scan-check` route: facility matching reordered — Step 1 is now invoiceRef code (`/\bF\d{2,4}\b/i`), then exact name, fuzzy name, word-fragment pass (≥2 shared normalized words → confidence 'medium'), payer address. Added `isOurAddress` guard to skip name/address matching when payer address = "2833 smith ave". Gemini prompt updated to extract `invoiceLines` array (REMITTANCE_SLIP only) and scan entire document for check number (not just top-right corner).
- `save-check-payment` route: accepts `documentType` + `invoiceLines` in Zod body. When `documentType === 'RFMS_REMITTANCE_SLIP'` and `invoiceLines.length > 0`, stores `{ type: 'remittance_lines', lines: [{ref, invoiceDate, amountCents}] }` as `resident_breakdown` instead of the resident-name breakdown. Auto-generates memo listing invoice dates + check number when none provided.
- `billing-shared.tsx`: exported `RemittanceLine` type; `BillingPayment.residentBreakdown` is now a discriminated union (`ResidentBreakdownLine[]` | `{ type: 'remittance_lines'; lines: RemittanceLine[] }` | null).
- `scan-check-modal.tsx`: `ScanResult` gains `invoiceLines: InvoiceLine[]`. Step 2 shows Invoice Lines table (ref/date/amount per line, green ✓ or red ≠ total). Totals invariant uses `invoiceLines` sum instead of `editLines` sum when `documentType === 'RFMS_REMITTANCE_SLIP'`. `documentType` + `invoiceLines` sent in save body.
- `rfms-view.tsx`: Check # cell is conditionally a clickable underline button when remittance_lines exist. Click toggles an expandable inline detail row showing ref/date/amount per invoice line + total row (emerald when matches check amount, amber otherwise).
- `summary` route: added explicit `columns:` whitelist to `qbPayments.findMany` including `residentBreakdown: true`.

**Phase 11D Round 3 fixes**:
- `scan-check` route: (1) Gemini prompt + `GeminiResult` interface gain `cashAlsoReceivedCents` — Gemini extracts handwritten "+440 Cash"-style annotations (anywhere on doc) and returns cents. (2) Resident-name facility inference pass: when all 5 prior facility passes fail AND ≥2 resident lines exist, fetches ALL active residents DB-wide (columns: id, name, facilityId, roomNumber) and fuzzy-matches each line at threshold 0.65. Facility with ≥2 hits AND ≥50% of lines AND no tie wins with `confidence: 'medium'`. (3) Efficiency: when inference pre-fetches `allResidentsForInference`, the subsequent resident matching step filters that array instead of re-querying. Final response adds `cashAlsoReceivedCents`, `inferredFromResidents`, and `residentMatchCount` fields.
- `GET /api/residents`: now accepts optional `?facilityId=X` query param. Master admin: any facility. Facility admin: own facility only (403 otherwise). Returns minimal columns (id/name/roomNumber) when param is present to keep the combobox payload small.
- `scan-check-modal.tsx`: (1) `ScanResult` adds `cashAlsoReceivedCents`; `FacilityMatch` adds `inferredFromResidents?`/`residentMatchCount?`; `EditableLine` adds `residentSearch: string`. (2) `applyResultToState` auto-enables cash checkbox + pre-fills amount if `cashAlsoReceivedCents.value != null`. (3) Inference note shown below FacilityCombobox when `inferredFromResidents`. (4) New `ResidentCombobox` component (same pattern as `FacilityCombobox` — owns open state, blur handling, `onMouseDown` to avoid blur race, disabled state shows "Select facility first"). (5) `ResidentRow` uses `ResidentCombobox` instead of `<select>`; receives `facilitySelected` + `loadingResidents` props for disabled state. (6) `localResidents` state + `useEffect` keyed on `selectedFacilityId`: on change, fetches `/api/residents?facilityId=X`, resets all line matches via `clearLineMatches()` helper, cleans up with `AbortController`. (7) `requiresResidentMatch` const gates `canRecord` — RFMS_REMITTANCE_SLIP documents don't require resident matching.

**Phase 11D Round 4 fixes**:
- **Cash invariant fix**: Cash is additive and saved as a separate `qb_payments` row with `paymentMethod='cash'`. The total-accuracy invariant is now `linesTotal === amountCents` (cash excluded). Modal `totalMatches` and `save-check-payment` server-side check both updated. Error message reads "Line items total $X but check amount is $Y. Adjust line amounts to match the check." Cash UI shows helper text "Recorded as a separate cash payment on top of the check amount."
- **Resident name normalization** (`scan-check` route): New `normalizeResidentName(raw: string): string[]` helper converts Gemini's "LAST, FIRST" comma format into both `["last, first", "first last"]` candidates. The inference loop now iterates candidates and calls `fuzzyBestMatch` at threshold 0.55 per candidate (lowered from 0.65 for inference pass). "LEMPGES, CLAUDE" → swapped candidate "claude lempges" → `fuzzyScore === 1.0` vs DB "Claude Lempges".
- **`scan_corrections` table** (new in `schema.ts`): id, createdAt, facilityId (cascade delete), documentType, fieldName, geminiExtracted (nullable), correctedValue, contextNote (nullable), createdBy → profiles.id (set null). RLS enabled, `service_role_all` policy, indexes on `(document_type, field_name)` and `(facility_id, document_type)`.
- **Correction recording** (`save-check-payment` route): Zod `BaseSchema` gains `corrections?: Array<{fieldName: string, geminiExtracted: string|null, correctedValue: string}>` (max 20 items, each field max 50/2000 chars). Step 9 in the transaction: if `body.corrections.length > 0`, batch-inserts rows into `scan_corrections`. `facilityId` = `body.matchedFacilityId ?? body.facilityId`.
- **Correction tracking** (`scan-check-modal.tsx`): New `CorrectionEntry` interface. In `handleSave`, when `mode === 'resolve'`, compares edited checkNum/checkDate/invoiceRef/invoiceDate fields against `result.extracted.*` values and resident combobox picks against `result.residentMatches[i].residentId`. Corrections sent in save body only when `corrections.length > 0`.
- **Few-shot prompt injection** (`scan-check` route): Before the Gemini call, fetches last 10 `scan_corrections` rows for the facility (ordered desc by createdAt, minimal columns). `buildFewShotBlock()` deduplicates by fieldName (first occurrence wins) and emits up to 5 "LEARNED FROM PREVIOUS CORRECTIONS" lines. `buildPrompt(fewShotBlock)` replaces the old `PROMPT` const; the block is appended just before "Return ONLY the JSON object."

**Super Admin facility sort toggle**:
- `facilitySortBy` state (`'fid' | 'name'`, default `'fid'`). `sortedFacilities` useMemo sorts `visibleFacilities` client-side: FID = numeric sort on digits stripped from `facilityCode` (no-code → 9999, sorts last); Name = `localeCompare`. Toolbar gains FID/Name toggle buttons (left side, before "Show inactive"). Active button: `bg-stone-200 text-stone-800 font-semibold`.

**Phase 11D.6 fixes**:
- **`facilities.rev_share_percentage`** — new nullable `integer` column added. Used by the CSV import route.
- **`POST /api/super-admin/import-facilities-csv`** — master admin only, rate-limited under `billingImport` bucket (5/hr), `maxDuration=60`. Accepts multipart `csv` field. **Fixed column positions**: col[0]=notes, col[1]=F-code (`/^F\d{2,4}$/`), col[2]=priority, col[3]=NAME, col[4]=billing type, col[5]=rev share %, col[6]=email, col[8]=phone, col[9]=address. Matches rows by `facilityCode` (col[1]) via `Map<facilityCode, facility>` (O(1) exact match; NOT fuzzy). Name fills if currently null/empty. Email fills via regex extract (`/[\w.+\-]+@[\w.\-]+\.[a-zA-Z]{2,}/`) only when currently null. Phone and address always overwrite if provided. `paymentType` always overwritten via `mapBillingType()`. `revSharePercentage` set from `parseFloat(col[5]) → Math.round`. Returns `{ updated, skipped, namesFilled, emailsFilled, revShareSet, warnings }`. Never creates new facilities.
- **`/super-admin/import-facilities-csv`** page — same 3-state pattern as import-billing-history (upload card → loading overlay → results card). Separate `page.tsx` (auth redirect) + `import-facilities-csv-client.tsx`.
- **Super Admin header links renamed**: "Import from QuickBooks" → "QB Customer Import", "Import Billing History" → "QB Billing Import", "Update Facilities" → "Facility Data Import". Same `text-xs px-3 py-1.5 rounded-lg border border-stone-200` style for all three.
- **Check image lightbox** — in `scan-check-modal.tsx` Step 2 left column, the check image is wrapped in a `<button type="button" className="w-full cursor-zoom-in">` that sets `lightboxOpen = true`. A `z-[60]` full-screen overlay (`fixed inset-0 bg-black/90`) renders as a sibling to `<Modal>` (requires a `<>...</>` fragment wrapper on the return). Click backdrop to close, X button top-right, click image stops propagation. `lightboxOpen` resets in `resetEditState()`.
- **Inference status message** — `FacilityMatch` response gains `inferenceAttempted: boolean` and `inferenceResidentCount: number` (total non-empty lines tried). Modal shows amber "Could not auto-match from N resident names — please select facility manually" when inference ran but failed; keeps existing stone "Matched via resident names" message for success.
- **Payment total row** — inserted between totals-invariant warning and buttons in scan-check-modal.tsx confirm step. Shows `Check: $X = Total Received: $X` always; when `cashEnabled && cashCents > 0`: `Check: $X + Cash: $Y = Total Received: $Z` with total in burgundy `#8B2E4A`.

**Key invariants**:
- `check-images` bucket is PRIVATE. Upload via service-role only; regenerate signed URLs (1-hour TTL) at read time. Never store or expose raw URLs.
- Total accuracy (`linesTotal === amountCents`) MUST pass before save. Cash is a separate additive payment — NOT included in the invariant.
- Invoice decrement is exact-match only. Partial/none leaves invoices untouched (documented limitation — reconciled on next CSV re-import).
- `qb_unresolved_payments` is the only persistence path for OCR-failed documents. Never silently drop a scan.
- `src/lib/fuzzy.ts` is the canonical fuzzy-match module. Never re-implement inline.
- `resident_breakdown` has two shapes: `ResidentBreakdownLine[]` OR `{ type: 'remittance_lines', lines: [...] }`. Discriminate with `!Array.isArray(bd) && bd.type === 'remittance_lines'`.

### Phase 11D.5 — Payment Reconciliation (PLANNED — Opus)
Match `resident_breakdown.type === 'remittance_lines'` invoice dates against daily log entries for the same facility+date. Confidence scoring: exact date match = high, ±1 day = medium, no log = unmatched. Unmatched lines flagged for review. Reconciliation status fields (`reconciled_at`, `reconciliation_notes`) to be added in a future migration. UI entry point: "Reconcile" button on expanded remittance rows (only when `invoiceDate` lines exist). Audit trail view per facility showing matched/unmatched/pending status.

### Phase 11E — Facility Merge Tool (SHIPPED 2026-04-21)

Consolidates no-FID duplicate facilities (manual early-day entries) into their QB-imported canonical records. New "Merge" tab between "Requests" and "Reports" on `/super-admin`. Two routes + one audit table:

- **`GET /api/super-admin/merge-candidates`** — splits all active facilities by `facilityCode` presence; fuzzy-matches each no-FID facility against all FID facilities via `fuzzyScore`; returns pairs at threshold ≥0.6, bucketed `high` (1.0) / `medium` (≥0.8) / `low` (≥0.6). Unmatched no-FID facilities returned separately.
- **`POST /api/super-admin/merge-facilities`** — single `db.transaction()` migrates all 20 facility_id FK tables. Unique-constraint tables (log_entries, stylist_facility_assignments, stylist_availability, facility_users PK, qb_invoices) drop the secondary row when a primary row exists for the same key. Resident soft-conflict resolution: same normalized name+room ⇒ bookings/invoices/payments/unresolved-payments re-pointed to primary resident, secondary resident `active=false`. Field inheritance: 15 facility columns copy-if-null from secondary → primary. Secondary facility soft-deactivated (never hard-deleted). Audit row written to `facility_merge_log` with every transfer count + inherited fields. Entire operation rolls back atomically on any error.
- **`facility_merge_log`** table — append-only audit trail (schema above).
- **UI** — `src/app/(protected)/super-admin/merge-tab.tsx`. Each candidate rendered as a two-column `PairCard` (stone-50 primary / amber-50 secondary) with a swap-sides button, confidence badge, and counts. "Merge →" opens a confirmation modal requiring the operator to type the secondary facility name exactly (case-insensitive) before the "Merge now" button enables.

### Phase 11F — Resident Portal Isolation (SUPERSEDED — see Phase 11I)
Original plan: invite links of the form `portal/[facilityCode]/[portalToken]` reusing per-resident `residents.portal_token`. Replaced by Phase 11I (`/family/[facilityCode]/*` with persistent magic-link sessions and one-account-many-residents). Legacy `/portal/[token]` route remains alive so old single-resident invite emails still work.

### Phase 11I — Family Portal (POA Magic-Link) (SHIPPED 2026-04-26)
Real family/POA portal at `/family/[facilityCode]/*` — coexists with legacy `/portal/[token]`.

**New tables (4)**
- `portal_accounts` — `id`, `email` (unique, lowercased), `password_hash` (nullable, PBKDF2-SHA256 210k), `created_at`, `last_login_at`. RLS service_role_all.
- `portal_account_residents` — join table, `portal_account_id` × `resident_id` × `facility_id`, unique on `(account, resident)`. CASCADE on all FKs.
- `portal_magic_links` — `email`, `token` (unique opaque hex), `resident_id`, `facility_code`, `expires_at` (72h), `used_at`. CASCADE on resident.
- `portal_sessions` — `portal_account_id`, `session_token` (unique opaque hex), `expires_at` (30d). CASCADE on account.

**New columns**
- `qb_invoices.stripe_payment_intent_id` (text, nullable) + `qb_invoices.stripe_paid_at` (timestamptz, nullable)
- `bookings.requested_by_portal` (boolean, default false) + `bookings.portal_notes` (text, nullable)
- `residents.last_portal_invite_sent_at` (timestamptz, nullable)

**New library modules**
- `src/lib/portal-password.ts` — `hashPassword`, `verifyPassword`. PBKDF2-SHA256, 210k iterations, 16-byte salt, 32-byte hash. Format: `pbkdf2$210000$<saltHex>$<hashHex>`. Constant-time compare via `crypto.timingSafeEqual`. No bcrypt dep.
- `src/lib/portal-auth.ts` — `generateToken`, `createMagicLink`, `verifyMagicLink` (auto-discovers all residents with matching `poaEmail`), `createPortalSession`, `getPortalSession`, `requirePortalAuth(facilityCode)` (redirects to `/family/[code]/login`), `revokeSession`, `setPortalSessionCookie`, `clearPortalSessionCookie`.

**New API routes**
- `POST /api/portal/send-invite` — admin-only. Creates magic link, fires-and-forgets `buildPortalMagicLinkEmailHtml` email via Resend, updates `residents.last_portal_invite_sent_at`.
- `POST /api/portal/request-link` — public, rate-limited `portalRequestLink`. Always returns `{ data: { sent: true } }` regardless of email existence.
- `POST /api/portal/login` — public, rate-limited `portalLogin`. Generic `'Invalid email or password'` for any failure. Sets `__portal_session` cookie.
- `POST /api/portal/logout` — clears cookie + revokes session row.
- `POST /api/portal/set-password` — authed, rate-limited. Hashes via PBKDF2.
- `POST /api/portal/request-booking` — authed, rate-limited. Resolves stylist via `resolveAvailableStylists` + `pickStylistWithLeastLoad`, falls back to first active facility stylist. Inserts `bookings` row with `status='requested'`, `requestedByPortal=true`, `portalNotes`. Fires admin notification email to `facility.contactEmail` AND `NEXT_PUBLIC_ADMIN_EMAIL`.
- `GET /api/portal/statement/[residentId]` — authed, rate-limited. Returns printable HTML (reuses `buildResidentStatementHtml`) with `@media print` CSS + `<button onclick="window.print()">`. No PDF dep.
- `POST /api/portal/stripe/create-checkout` — authed, rate-limited. Per-facility Stripe key with `process.env.STRIPE_SECRET_KEY` fallback. Sets `metadata.type = 'portal_balance'`, `metadata.residentId`, `metadata.facilityId`, `metadata.facilityCode`.
- `GET /api/cron/portal-cleanup` — `vercel.json` cron daily 04:00 UTC. Deletes magic-link rows older than 7d past expiry + expired sessions. Auth via `Bearer ${CRON_SECRET}`.

**Stripe webhook extension** — `/api/webhooks/stripe` discriminates on `session.metadata?.type === 'portal_balance'`. Single endpoint, single `STRIPE_WEBHOOK_SECRET`. On portal_balance:
1. Insert `qb_payments(paymentMethod='stripe', stripePaymentIntentId, memo)` for the resident
2. FIFO-decrement `qb_invoices.openBalanceCents` ordered by invoiceDate ASC, set `status='paid'` + `stripePaidAt` + `stripePaymentIntentId` when zero
3. Recompute `residents.qbOutstandingBalanceCents`
4. `revalidateTag('billing', {})` + `revalidateTag('bookings', {})`
All wrapped in `db.transaction`. Always returns 200 to Stripe.

**New rate-limit buckets** — `portalRequestLink` 5/hr per `${ip}:${emailHash}`, `portalLogin` 10/hr per IP, `portalSetPassword` 5/hr per accountId, `portalRequestBooking` 5/hr per accountId, `portalStatement` 20/hr per accountId, `portalCheckout` 10/hr per accountId.

**Pages** — `/family/[facilityCode]/`: `layout.tsx` (burgundy header, resident picker, bottom nav), `page.tsx` (greeting + balance + upcoming-3 + CTA), `login/` (link tab + password tab), `auth/verify/` (verify magic link + optional set-password), `appointments/` (upcoming + past 6mo), `request/` (multi-select services, preferred date, notes), `billing/` (balance + Stripe button + mail-payment + invoice list + statement download), `contact/` (Senior Stylist + facility info), `portal-nav.tsx` (5 tabs, fixed bottom).

**Email builders added to `src/lib/email.ts`** — `buildPortalMagicLinkEmailHtml({ residentNames, facilityName, link, expiresInHours })` and `buildPortalRequestEmailHtml({ residentName, facilityName, serviceNames, preferredDateFrom, preferredDateTo, notes, adminUrl })`.

**Middleware** — `src/middleware.ts` includes `pathname.startsWith('/family')` in public-route allowlist.

**No new env vars.** Reuses `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_ADMIN_EMAIL`, `CRON_SECRET`. `PORTAL_SESSION_SECRET` deliberately NOT added — opaque server-side tokens need no signing.

### Phase 11G — QB API Live Sync (PLANNED — Opus)
Manual sync per facility. Route: `POST /api/quickbooks/sync-invoices/[facilityId]`. First sync backfills `qb_invoice_id` on CSV-imported records. Requires Intuit production approval. Until approved → button hidden.

### Phase 11H — Revenue Share Integration (PLANNED — Opus)
New `facilities.rev_share_percentage` integer column. Per-invoice stylist/facility split calculation. New `qb_invoice_id` on `stylist_pay_items` links payroll to invoices. Billing view shows split breakdown. Payroll detail shows corresponding invoices.

### Phase 11L — Revenue Share Integration (SHIPPED 2026-04-27)

**Schema additions** (all nullable, no defaults except `qb_payments.reconciliation_status`):
- `qb_payments`: `rev_share_amount_cents integer`, `rev_share_type text`, `senior_stylist_amount_cents integer`
- `stylist_pay_items`: `qb_invoice_id text`, `invoice_amount_cents integer`, `rev_share_amount_cents integer`, `rev_share_type text`

**Helper**: `src/lib/rev-share.ts` exports:
```ts
calculateRevShare(totalCents, revSharePercentage, revShareType): RevShareResult
```
Result has `totalCents`, `seniorStylistCents`, `facilityShareCents`, `revShareType`, `revSharePercentage`. When percentage is null/0 or type is null, returns full amount as senior-stylist-only with zero facility share. Rounding: `facilityShareCents = Math.round(total * pct/100)`, `seniorStylistCents = totalCents - facilityShareCents` (never two independent rounds).

**API additions**:
- `POST /api/billing/save-check-payment` — re-fetches `facilities.findFirst` for `revSharePercentage` + `qbRevShareType` and writes the 3 split columns on every `qb_payments` insert (per-resident IP / RFMS facility-level / lump facility / cash — all 4 paths).
- `POST /api/pay-periods` — best-effort booking↔invoice match: left-join `bookings` × `qb_invoices` on `(facility_id, resident_id)` plus `qb_invoices.invoice_date BETWEEN bookings.start_time::date - 30d AND + 30d`. First match per stylist wins. Stores `qb_invoice_id`, `invoice_amount_cents`, `rev_share_amount_cents` (computed from gross), `rev_share_type` on each pay item insert.
- `GET /api/billing/cross-facility-summary` — adds two new SUM aggregates from `qb_payments` (over all rows, no date filter). Returns `totalRevShareCents` + `totalNetCents`. Master-admin only.
- `GET /api/billing/summary/[facilityId]` — column whitelist extends with `facilities.revSharePercentage` and `qb_payments.{revShareAmountCents, revShareType, seniorStylistAmountCents}`.

**UI surfaces**:
- `rfms-view.tsx` — checks-received Memo cell shows 2-line rev share sub-block when `revShareAmountCents > 0` (Senior Stylist / Facility share with stone-100 percentage badges).
- `billing-client.tsx` — Net to Senior Stylist sub-line under Total Received tile (when `facility.revSharePercentage > 0`); cross-facility 2-tile rollup row below the existing 5-tile bar (master only).
- `payroll-detail-client.tsx` — per-stylist sub-row below main grid with rev share breakdown + Net to Senior Stylist; bottom footer summary line "Total payroll | Rev share deducted | Net revenue".
- `analytics/reports-client.tsx` — Revenue Share card above the Total Revenue / Appointments tiles with 3-column gross/deducted/net grid + type badge.
- `settings/sections/billing-section.tsx` — calculation preview block under the rev share toggle ("On a $10,000 payment → $X to Senior Stylist, $Y to facility"), updates live as toggle changes.

**Caveats**:
- Pay-item ↔ invoice link is lossy (1:1 stored, 1:many in reality). Best-effort, first match wins.
- Cross-facility rev share rollup only counts payments inserted post-Phase-11L. Historical rows contribute 0. No backfill performed.
- `facility_deducts` and `we_deduct` produce identical numbers — only the operational flow / label differs.

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


### Phase 11N — Payroll Extensions (SHIPPED 2026-04-27)

Three additions to the existing payroll system. No new pages.

**Schema**: new `quickbooks_sync_log` table (see DB schema section above). `payPeriodId` is nullable — `syncVendorsForFacility` is called from its own POST handler (no period context) and from `sync-bill` (has context).

**QB Sync Log routes**:
- `sync-bill/[periodId]` — fire-and-forget log row per stylist on success (with `qbBillId`) and on error
- `sync-status/[periodId]` — one summary row per run after the QB poll loop; includes `failed` counter
- `sync-vendors/route.ts::syncVendorsForFacility` — optional third param `payPeriodId: string | null = null`; logs per-vendor create/update; `sync-bill` passes `periodId` as the third arg when auto-syncing missing vendors

**Sync History UI**:
- `payroll/[id]/page.tsx` — queries up to 50 log rows (`with: { stylist: { columns: { name: true } } }`, `desc(createdAt)`)
- `payroll-detail-client.tsx` — `syncLog: SyncLogEntry[]` prop; collapsible accordion below QB panel; action badges (push_bill=stone, sync_status=blue, sync_vendors=purple); shows ✓/✗/~ + summary or error; capped at 20 displayed with overflow note

**Payroll email notification**:
- `src/lib/email.ts::buildPayrollNotificationHtml()` — inline-style template (same pattern as other emails); gross → commission → deductions list → net pay (burgundy)
- `PUT /api/pay-periods/[id]` — detects `body.status === 'paid' && existing.status !== 'paid'` transition; fire-and-forget `void (async () => {...})()` block; fetches `facilities.name`, queries `stylistPayItems + stylists` (email + pay figures), queries `payDeductions`, sends one email per stylist with an email address; uses `stylists.email` directly (no profiles join)

**Stylist pay history on `/my-account`**:
- `my-account/page.tsx` — queries last 12 `stylistPayItems` joined to `payPeriods + facilities` (`desc(payPeriods.startDate)`); fetches deductions via `inArray(payDeductions.payItemId, payItemIds)`
- `my-account-client.tsx` — `payHistory` + `payHistoryDeductions` props; "Pay History" card (only when `payHistory.length > 0`); expandable rows with `expandedPeriodId` state; expanded view shows gross → commission → deductions → net breakdown; status badges: open=stone, processing=amber, paid=emerald


### Phase 11M — QuickBooks Invoice Live Sync (SHIPPED 2026-04-27 — gated)

Pull live invoice data from QuickBooks Online into the local `qb_invoices` table on demand, per facility. Replaces the manual CSV import flow for QB-connected facilities. **Gated behind `QB_INVOICE_SYNC_ENABLED` env flag** — locally `false`, unset in Vercel — until Intuit production approval is granted.

**Schema additions** (`facilities`):
- `qb_invoices_last_synced_at timestamptz` — wall-clock of last successful sync
- `qb_invoices_sync_cursor text` — ISO 8601 timestamp for `Metadata.LastUpdatedTime > '<cursor>'` filter

**Schema index** (`qb_invoices`):
- `qb_invoices_qb_id_idx` partial index on `qb_invoice_id WHERE qb_invoice_id IS NOT NULL` — enables future delta lookups by QB internal ID
- `qb_invoice_id` text column itself was added in Phase 10B — no column change

**Engine** — `src/lib/qb-invoice-sync.ts::syncQBInvoices(facilityId, { fullSync? })`:
1. Loads facility + active resident list (with `qbCustomerId`) + existing invoice index for skip-detection
2. Builds query: `SELECT * FROM Invoice [WHERE Metadata.LastUpdatedTime > '<cursor>'] STARTPOSITION <pos> MAXRESULTS 100` via `qbGet(facilityId, '/query?query=...&minorversion=65')`. Cursor ignored on `fullSync`.
3. Paginates until <100 returned or 5000-invoice safety cap hit (cap reports an error so operator can re-run)
4. For each QB invoice: derives `amountCents`/`openBalanceCents`/`status` (legacy CSV-import status logic — handles `open > amount` edge), resolves resident via exact `qbCustomerId` match → fuzzy 0.7 → null, upserts on `(invoice_num, facility_id)` unique index. Skip if `(openBalance, status, qbInvoiceId)` unchanged
5. Recomputes `facilities.qb_outstanding_balance_cents` and `residents.qb_outstanding_balance_cents` for every resident in scope
6. Updates `qb_invoices_last_synced_at = now()` and `qb_invoices_sync_cursor = now().toISOString()`

Returns `{ created, updated, skipped, errors[] }`.

**API route** — `POST /api/quickbooks/sync-invoices/[facilityId]`:
- `maxDuration = 60`, `dynamic = 'force-dynamic'`
- Returns 503 with "awaiting Intuit production approval" message when `process.env.QB_INVOICE_SYNC_ENABLED !== 'true'` (defense-in-depth alongside UI gating)
- Auth: master admin OR admin/bookkeeper for own facility (`canAccessBilling`)
- 412 when QB tokens or realm ID are missing
- Rate limit: `qbInvoiceSync` bucket (3/h/user)
- Body: `{ fullSync?: boolean }`. On success calls `revalidateTag('billing', {})` and `revalidateTag('facilities', {})`

**Summary route extension** — `GET /api/billing/summary/[facilityId]` column whitelist gains `qbAccessToken`, `qbRefreshToken`, `qbInvoicesLastSyncedAt`. Tokens read but stripped server-side; the response shape adds `hasQuickBooks: boolean` and `qbInvoicesLastSyncedAt: string | null` to `BillingFacility`. Cached value busts via the existing `revalidateTag('billing', {})` call inside the sync route.

**UI**:
- `billing-client.tsx` — When `summary?.facility.hasQuickBooks && qbInvoiceSyncEnabled`, renders a stone-secondary "Sync from QB" button next to "Send Statement" with refresh icon, animated spinner during sync, 3-second emerald `successFlash` "✓ Synced" on success. Status line below: `Last synced: <date>` or `<X invoices updated>` after a sync, plus a `Full re-sync →` link that opens an inline confirm modal (`bg-black/40 backdrop-blur-sm z-[100]`). Errors surface as red text inline. When QB connected but flag off: shows `<DisabledActionButton title="Awaiting Intuit production approval" />`. Send via QB tooltip updated to "Coming soon — available after Intuit approval".
- `settings/sections/billing-section.tsx` — Adds an "Invoice Sync" subsection inside the QB connected card. When flag off: amber `bg-amber-50 border-amber-200` "coming soon" banner. When on: last-synced label + Sync now / Full re-sync buttons (full re-sync uses the same confirm modal). Reuses the existing `qbToast` helper.

**Env**: `QB_INVOICE_SYNC_ENABLED=false` in `.env.local`. NOT set in Vercel. Flip to `'true'` in Vercel (production + preview) only after Intuit approves the production app.


### Codebase Audit Pass (2026-04-27) — Indexes + Cleanup

Quality/perf pass, no new features. Highlights:

**9 new indexes** — all declared in `src/db/schema.ts` extras blocks AND created in DB:

| Table | Index | Columns |
|-------|-------|---------|
| `bookings` | `bookings_facility_start_idx` | `(facility_id, start_time DESC)` |
| `bookings` | `bookings_stylist_start_idx` | `(stylist_id, start_time DESC)` |
| `bookings` | `bookings_resident_idx` | `(resident_id)` |
| `log_entries` | `log_entries_facility_date_idx` | `(facility_id, date DESC)` |
| `stylist_facility_assignments` | `stylist_facility_assignments_facility_idx` | `(facility_id)` |
| `compliance_documents` | `compliance_documents_stylist_facility_idx` | `(stylist_id, facility_id)` |
| `qb_invoices` | `qb_invoices_facility_date_idx` | `(facility_id, invoice_date DESC)` |
| `qb_payments` | `qb_payments_facility_date_idx` | `(facility_id, payment_date DESC)` |
| `residents` | `residents_facility_active_idx` | `(facility_id) WHERE active = true` |

The last three were claimed by Phase 11J.4 documentation but had never been created in the DB — fixed in this pass.

**New rate-limit bucket**: `coverage` (10/h/user) for `POST /api/coverage`.

**New Zod schema**: `createInviteSchema` on `POST /api/invites`.

**Loading skeletons**: 6 added (`stylists`, `services`, `my-account`, `payroll/[id]`, `residents/[id]`, `stylists/[id]`) — every protected route now has one.

**Bundle**: `recharts` uses static top-level imports in `analytics/reports-client.tsx`, `reports/reports-client.tsx`, and `master-admin/reports-tab.tsx`. **DO NOT convert recharts to `next/dynamic` per-named-export** — barrel exports fail at runtime (attempted Apr 27, reverted same day). `papaparse` + `xlsx` also use static top-level imports in `onboarding-client.tsx` (reverted from inline `await import()` for same reason).

**Brain-rule additions** (CLAUDE.md): indexes-in-schema-only, no `console.log` in `src/app/api` + `src/lib`, `revalidateTag` on cached-tag mutations, Zod safeParse on every `req.json()`, `Promise.all` on independent awaits, `window.location.href` (not `router.push`) after debug cookie mutations, React component names must start uppercase.

**Mobile layout additions (2026-04-28/29)**:
- `MobileFacilityHeader` (`src/components/layout/mobile-facility-header.tsx`): `md:hidden` 56px header inside `<main>`, above `<TopBar>`, shows logo + facility chip; BottomSheet for facility switching.
- `MobileDebugButton` (`src/components/layout/mobile-debug-button.tsx`): `md:hidden`, master-admin only (`isMaster` prop), positioned `left-4` at `bottom: calc(env(safe-area-inset-bottom)+88px)`. BottomSheet with role picker + facility select → `window.location.href='/dashboard'`. In debug mode shows amber pill with inline change/exit.
- `InstallBanner` bottom raised to `96px` (from `80px`); banner now fully tappable (no separate "Show me how →" button — it overlapped the `+` FAB).
