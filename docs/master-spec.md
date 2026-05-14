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
| `/dashboard` | bookkeeper → redirect `/log` | Bookkeeper's home is the daily log (can scan + edit billing fields) |
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
- `canScanLogs(role)` — `admin`, `super_admin`, `bookkeeper` (added Phase 11J.1 expansion: bookkeeper can upload + OCR log sheets)

**Routes that allow `bookkeeper` via `canAccessBilling` / `canAccessPayroll`** (Phase 11J.1):
- `/api/billing/*` (summary, scan-check, save-check-payment, send-statement/*, unresolved, unresolved-count)
- `/api/facilities/[facilityId]/rev-share`
- `/api/reports/invoice`, `/api/reports/mark-paid`
- `/api/export/bookkeeper`
- `/api/pay-periods/*` (all routes including items + deductions + export)
- `/api/quickbooks/*` (connect, disconnect, accounts, sync-vendors, sync-bill, sync-status)

**Routes that allow `bookkeeper` via `canScanLogs`** (Phase 11J.1 expansion):
- `POST /api/log/ocr` — upload + OCR log sheet images
- `POST /api/log/ocr/import` — commit OCR-reviewed entries to bookings

**`PUT /api/bookings/[id]` — bookkeeper field restriction**: bookkeeper is now allowed but server-side strips disallowed fields. `BOOKKEEPER_ALLOWED` set: `residentId, serviceId, serviceIds, addonServiceIds, addonChecked, priceCents, paymentStatus, notes, tipCents, selectedQuantity, selectedOption`. Fields `stylistId`, `startTime`, `status`, `cancellationReason` are silently dropped — bookkeeper cannot reschedule or cancel bookings.

**Routes that allow `facility_staff` via positive guard** (Phase 11J.1):
- `POST /api/bookings`, `PUT /api/bookings/[id]`, `DELETE /api/bookings/[id]`, `POST /api/bookings/recurring` — admin OR facility_staff OR stylist (existing stylist-self check on PUT preserved at line 94-98)
- `POST /api/residents`, `PUT /api/residents/[id]`, `DELETE /api/residents/[id]` — admin OR facility_staff
- `GET /api/residents`, `GET /api/residents/[id]` — unchanged (any facility user, including bookkeeper)

**Routes that stay strict admin-only**: services (`/api/services/*`), stylists (`/api/stylists/*`), invites (`/api/invites/*`), applicants (`/api/applicants/*`), compliance (`/api/compliance/*`), coverage (`/api/coverage/*`), availability (`/api/availability/*`), super-admin (`/api/super-admin/*`), access-requests (`/api/access-requests/*`), facility (`/api/facility/*`), portal admin (`/api/portal/create-magic-link`, `/api/portal/send-invite`), `/api/stylists/[id]/invite`. Their existing `role !== 'admin'` guards already exclude `facility_staff`, `bookkeeper`, and `viewer` — no changes needed. (Note: `/api/log/ocr/*` was removed from this list — it now uses `canScanLogs` which includes bookkeeper.)

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
- **`default_tip_type`** (Phase 12E): nullable text, one of `'percentage' | 'fixed'`. When set, drives the booking modal's auto-fill on resident pick.
- **`default_tip_value`** (Phase 12E): nullable integer. Percent (e.g. `15` = 15%) when type is `'percentage'`; cents (e.g. `200` = $2.00) when type is `'fixed'`. Both fields null means no preference.
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
- **`tip_cents`** (Phase 12E): nullable integer. Stylist-only tip — must NEVER aggregate into facility revenue, rev-share splits, or QB invoice totals. `null` = no tip; never store `0`.
- Timestamps
- **`price_cents` is ALWAYS the final fully-resolved total** including add-ons, tier calculation, or option price — never a partial amount. **`tip_cents` is SEPARATE** from `price_cents` and never enters revenue sums.

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
| `tip_cents_total` | `integer NOT NULL DEFAULT 0` (Phase 12E) — per-period tip aggregate from `bookings.tip_cents`. Additive to net pay; deductions apply on top. Never enters `gross_revenue_cents` or rev-share math. |
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

### Response headers + redirects (`next.config.ts`)

HTTP→HTTPS redirect via `redirects()`: source `/:path*`, condition `x-forwarded-proto: http`, destination `https://portal.seniorstylist.com/:path*`, permanent (301). No-op on Vercel (CDN enforces HTTPS at edge before requests reach Next.js).

Applied to all routes via `headers()`:

- `X-Frame-Options: DENY` — clickjacking defense.
- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `Permissions-Policy: camera=(), microphone=(), geolocation=()` — all off; mobile OCR upload uses `<input capture="environment">` which is a file-picker and does not require camera permission.
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` — 2-year HSTS with preload flag (qualifies for browser preload lists).
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


### Phase 12C — Reconciliation Queue + Batch Rollback (SHIPPED 2026-05-03)

Fills in the "Needs Review" placeholder on `/master-admin/imports` with a real reconciliation queue, adds whole-batch and per-booking rollback, and surfaces an amber count badge on the sidebar Master Admin link.

**Schema**: added `bookings.active boolean default true not null` — a soft-delete flag distinct from `status='cancelled'`. Default `true` keeps every existing row visible. Filter `eq(bookings.active, true)` added to `/api/bookings` GET (calendar), `/log/page.tsx` (daily log), and `/api/reports/monthly` GET. Other surfaces (resident detail, stylist detail, exports, billing summary) deliberately not filtered — practical impact is small at current scale and exhaustive coverage adds risk for low payoff. CLAUDE.md documents the rule for new booking queries.

**New routes** (all master-admin gated via `getSuperAdmin()` helper):
- `GET /api/super-admin/import-review` — returns all bookings where `needs_review = true AND active = true`, ordered by import batch creation desc then start time. For each booking: top-3 service suggestions per facility (computed server-side via `fuzzyScore(service.name, rawServiceName)`, filtered out `pricingType='addon'`, threshold > 0). Response also includes `facilityServices: Record<facilityId, ServiceOption[]>` (the full per-facility service list, sorted by name) so the linker UI doesn't need a separate master-admin services endpoint.
- `POST /api/super-admin/import-review/resolve` — Zod discriminated union body `{action: 'link', bookingId, serviceId} | {action: 'create', bookingId, serviceName, priceCents} | {action: 'keep', bookingId}`. `link` verifies serviceId belongs to booking's facility (cross-facility leak guard), updates `bookings.serviceId/serviceIds + needsReview=false`. `create` inserts into `services` (`pricingType='fixed', durationMinutes=30, active=true`) inside a transaction, then links. `keep` only flips `needsReview=false` (booking stays as a permanent historical record with `serviceId=null`). All paths call `revalidateTag('bookings', {})`.
- `DELETE /api/super-admin/import-batches/[batchId]` — transaction: `UPDATE bookings SET active=false WHERE import_batch_id=batchId AND active=true` (returns count) + `UPDATE import_batches SET deleted_at=now()`. Returns `{ok, bookingsDeactivated}`.
- `DELETE /api/super-admin/import-bookings/[bookingId]` — single-booking soft-delete via `active=false`. Used by the trash button on each review card.

**No `/count` endpoint** — server layout queries needs_review count directly via Drizzle.

**Sidebar amber badge**: `(protected)/layout.tsx` runs a `count(bookings WHERE needs_review = true AND active = true)` query when `user.email === SUPER_ADMIN_EMAIL`, passes `needsReviewCount` to `<Sidebar>`. `Sidebar` renders an `ml-auto bg-amber-400 text-amber-950 rounded-full` count pill inside the Master Admin `<Link>` when count > 0. Uses the partial index `bookings_needs_review_idx` so the count is fast at any scale.

**Imports hub restructure** (`/master-admin/imports`):
- Server `page.tsx` now fetches a third dataset: full `import_batches` rows (where `deleted_at IS NULL`) with facility + stylist names. Passes as `batches` prop.
- Client `imports-client.tsx` adds a tab system (underline pnav pattern: `text-[#8B2E4A]` + `after:bg-[#8B2E4A]` 2px bar) below the card grid. Two tabs: `Needs Review (N)` and `Batch History (M)`. Initial tab defaults to `review` if `initialReviewCount > 0`, else `history`. `reviewCount` mirrors local state and updates via `onCountChange` from `<ReviewQueue>`.

**`<ReviewQueue />` component**:
- Fetches via `useEffect` GET `/api/super-admin/import-review` on mount.
- Loading skeleton → empty state (green check, "All imports resolved") → list view.
- Amber banner at top: "{N} imported services couldn't be matched automatically…"
- Each `<ReviewCard>` (`bg-white rounded-2xl shadow-[var(--shadow-sm)] p-5`):
  - Header: resident name + room + facility + date + truncated file pill + trash button (right-aligned).
  - Raw service block: `bg-stone-50 rounded-xl` row with `font-mono` raw text + price.
  - Suggestions row (idle state, when `suggestions.length > 0`): "Suggested:" label + up to 3 rose-pill buttons showing name + price + rounded score badge ("87%"). Click → enters `link` sub-state pre-filled with that serviceId.
  - Action row (idle state): three flex-1 buttons — "Link to service" (burgundy), "Create new service" (stone), "Keep as historical" (ghost border).
  - **Link sub-form**: native `<select>` of all facility services + Save/Cancel. Submits resolve `{action:'link'}`.
  - **Create sub-form**: name input (pre-filled from rawServiceName) + price input (pre-filled from priceCents) + Save/Cancel. Submits resolve `{action:'create'}`.
  - **Keep**: single click → resolve `{action:'keep'}`, no form.
  - **Trash**: enters `remove` sub-state with inline confirm "Remove this booking from Senior Stylist?" + Cancel/Remove. DELETEs `/api/super-admin/import-bookings/[id]`.
  - Optimistic removal on success (card disappears, list re-renders empty state if last).

**`<BatchHistory />` component**:
- Receives `initialBatches` server-rendered. Renders a 9-column house-style table (date, file, source pill, facility, stylist, rows, matched, unresolved, rollback action). Empty state when no batches.
- Rollback button per row → opens `<Modal>` with confirmation copy: "This will soft-delete all {N} bookings…". Confirm → DELETE → optimistic table-row removal + success toast "Rolled back N bookings."

**Master spec / project-context note**: `bookings.active` is the soft-delete flag for import rollback. Not used for normal user-cancelled bookings (those continue to use `status='cancelled'`). The two are intentionally distinct.


### Phase 12A+B — Import Hub + Service Log Import (SHIPPED 2026-05-03)

Backfill historical bookkeeper XLSX service-log files into bookings/residents/services and cross-link them to existing `qb_invoices` for AR reconciliation. Adds a dedicated `/master-admin/imports` hub that consolidates the four import flows. Historical bookings render with an unobtrusive `H` badge across calendar + daily log so live data stays visually distinct.

**Schema additions**:
- New table `import_batches` (uuid PK, `facility_id` NOT NULL → facilities, `stylist_id` nullable → stylists, `uploaded_by` NOT NULL → profiles, `file_name`, `source_type` text — `'service_log' | 'qb_billing' | 'qb_customer' | 'facility_csv'`, `row_count` / `matched_count` / `unresolved_count` integers default 0, `created_at` timestamptz, `deleted_at` timestamptz nullable for rollback). Indexes: `import_batches_source_created_idx (source_type, created_at DESC)`, `import_batches_facility_idx (facility_id)`. RLS enabled with `service_role_all`.
- `bookings`: **`service_id` is now NULLABLE** (was NOT NULL). Added: `source` text (`'scheduled' | 'historical_import' | 'walk_in'`, null = legacy), `raw_service_name` text, `import_batch_id` uuid → import_batches, `qb_invoice_match_id` uuid → qb_invoices, `needs_review` boolean default false. New indexes: `bookings_needs_review_idx (needs_review) WHERE needs_review = true`, `bookings_import_batch_idx (import_batch_id) WHERE import_batch_id IS NOT NULL`.
- `qb_invoices`: added `matched_booking_id` uuid → bookings (back-reference). New index: `qb_invoices_unmatched_amount_idx (facility_id, amount_cents) WHERE matched_booking_id IS NULL`.

**Routes**:
- `/master-admin/imports/page.tsx` — server component, master-admin guard (canonical pattern). Reads `import_batches` (groupBy `source_type`) + `count(bookings WHERE needs_review)`. Renders 4 cards (Service Log / QB Customer / QB Billing / Facility CSV) with last-imported timestamp, total count, and amber "{N} need review" badge for service_log when applicable. Empty "Needs Review" scaffold section below cards (12C placeholder).
- `/master-admin/imports/service-log/page.tsx` — master-admin guard, renders client.
- `service-log-client.tsx` — 5-state machine: `upload` → `preview` → `loading` → `stylist-resolution` → `results`. Step 1 parses XLSX client-side via `await import('xlsx')` (heavy lib rule); extracts facility name, stylist name, row count for the preview card. Step 2 confirms. Step 3 runs the import. Step 4 (conditional) prompts to create the missing stylist via `POST /api/stylists`, then re-uploads the file. Step 5 shows 6 stat tiles: bookings created, residents upserted, services matched, need review, QB invoices linked, duplicates skipped.
- `POST /api/super-admin/import-service-log` (maxDuration 120, force-dynamic, master-admin guard, `billingImport` rate limit 5/h/user). Pipeline: parse XLSX server-side → fuzzy match facility (≥0.70) → fuzzy match stylist (facility ∪ franchise pool, ≥0.70) → resident upsert (fuzzy 0.85, insert if no hit) → service match cascade (name fuzzy 0.72 → exact price → combo size 2-3) → dedup by `(residentId, serviceDate, rawServiceName)` → bulk insert bookings (chunk 100, status=`completed`, paymentStatus=`unpaid`, source=`historical_import`, importBatchId, needsReview, priceCents from XLSX, startTime via two-priority assignment: (1) reuse the startTime of an existing `source='scheduled'` booking for the same `residentId` on that date; (2) otherwise assign sequential 9am slots — 9:00, 9:30, 10:00 … per resident per date via `facilityDateAt9amPlusSlot`) → QB invoice cross-reference (amount=hard match, resident name fuzzy ≥0.70, closest date wins, claim-once per transaction) → finalize batch row → `revalidateTag('billing'/'bookings')`. Stylist-not-found returns 200 `{stylistResolutionNeeded: true}` (NOT an error). Facility-not-found returns 400 `{error: 'facility_not_found', facilityName}`.

**Engine module `src/lib/service-log-import.ts`** (pure, no DB):
- `parseServiceLogXlsx(buffer, fileName?)` → `{ rows, meta: { facility, stylist, stylistCode } }`. Skips `Client Name` empty/`"Doesn't Fill"`. Parses `Service Date` (Excel serial OR ISO), `Amount` → cents. **Column name resolution**: uses a case-insensitive, trim-safe `resolveKey(...names)` helper that builds a `Map<normalizedKey, actualKey>` from the first row's keys, then falls back through aliases — handles `'Facility Name'` (actual) and `'Facility'` (legacy alias), `'Stylist Name'`/`'Stylist'`, `'Room#'`/`'Room'`. Facility cell values carry an F-code prefix (`"F177 - Sunrise of Bethesda"`) which is stripped before mode collection. **Facility and stylist** extracted via mode detection (`mostFrequent()`) across ALL rows. When `facility` is still empty, falls back to parsing the filename (`"F177 - Sunrise of Bethesda.xlsx"` → `"Sunrise of Bethesda"`).
- `splitStylistCell(raw)` → `{ stylistCode, stylistName }` from `"ST624 - Senait Edwards"` format.
- `enumerateCombos<T>(items, maxSize)` — generic combination generator (size 2..maxSize).
- `matchService(raw, amountCents, services)` — cascade `name → price → combo → unmatched`. Filters out `pricingType === 'addon'` from candidates. Combo cap: size 3 when `services.length ≤ 30`, size 2 otherwise (factorial guard).
- `serviceDateAtNoonInTz(date, tz)` — DST-aware via `Intl.DateTimeFormat`. Returns a `Date`; callers must NOT pass this directly into `sql\`\`` template literals — use `.toISOString()` there. Drizzle `insert().values({ startTime: date })` is fine (schema type is `Date`).
- `facilityDateAt9amPlusSlot(date, tz, slotIndex)` — same DST-safe pattern; targets 9:00am + slotIndex×30min in the facility's local timezone. `slotIndex=0` → 9:00, `slotIndex=1` → 9:30, etc. Used by the import route for sequential slot assignment.

**Calendar + daily log H badge**:
- `BookingForCalendar` and `LogBooking` interfaces gained `source?: string | null` and `importBatch?: { fileName: string } | null`.
- `/api/bookings` GET adds `importBatch: { columns: { fileName: true } }` to its `with` clause; `/log/page.tsx` does the same.
- Calendar (`calendar-view.tsx`): `<HistoricalBadge fileName={...} />` (white-on-burgundy 14×14 pill with "H") inserted after the recurring `↻` indicator in all 3 view branches (dayGridMonth / timeGridWeek / timeGridDay). Tooltip via `title` attribute.
- Daily log (`log-client.tsx`): stone-pill `H` chip in the name flex container, after status icon + room number. Same tooltip.

**Master Admin nav**: 3 import links in `master-admin-client.tsx` (`Import: QB Customers / QB Billing / Facilities`) replaced with single `Imports →` link to `/master-admin/imports`.

**Known limitations** (deferred to Phase 12C or beyond):
- Memo matching dropped — `qb_invoices` has no memo column. Match uses amount (hard) + resident name fuzzy (≥0.70); closest date as tiebreaker.
- Combo matching uses all active non-addon services; combo size capped at 3.
- Historical bookings start `paymentStatus='unpaid'` (existing convention) rather than the spec's `'pending'`. The reconciliation queue (12C) will surface unpaid + matched-invoice combinations.
- "Needs Review" tab on `/master-admin/imports` is a scaffold (EmptyState placeholder); queue UI lands in 12C.

**Cross-cutting type changes**: dropping `bookings.serviceId` NOT NULL forced ~30 call sites (reports, exports, detail pages, Google Calendar sync) to use defensive `b.service?.X ?? <fallback>`. The `Service` type in `BookingForCalendar` / `LogBooking` / `BookingWithRelations` is now `Service | null`. Google Calendar sync sites short-circuit when `service` is null (historical imports never push to GCal).

### Phase 12D — Interactive Import Result Stat Tiles (SHIPPED 2026-05-03)

No schema changes. Polish on the post-import results screen: every stat tile is either navigable (one-click jump to the matching surface), informational (click-toggle tooltip popover), or static. Designed for the "I just imported 200 rows — now what?" moment.

**`ResultTile` component** (`src/app/(protected)/master-admin/imports/service-log/service-log-client.tsx`):
- Three modes derived from props:
  1. `href` set → wraps in `<button>`, calls `router.push(href)` on click
  2. `tooltip` set (no `href`) → `<button>` toggles `showTooltip` state; absolute popover `bg-stone-800 text-white rounded-xl px-3 py-2.5 text-xs w-52 shadow-[var(--shadow-lg)]` below the tile; `mousedown` outside (via `useRef` + `document.addEventListener`) dismisses
  3. Neither → plain `<div>`
- Hover style (interactive only): `hover:bg-[#F9EFF2] hover:shadow-[0_0_0_1.5px_rgba(139,46,74,0.15)] transition-[background-color,box-shadow] duration-[120ms]`. Base: `bg-stone-50 rounded-xl px-4 py-3`.

**Tile wiring on the results screen**:
| Tile | Mode | Target / Tooltip |
|------|------|------------------|
| Bookings created | href (always) | `/dashboard` |
| Need review | href (count > 0), static (count = 0 with tooltip) | `/master-admin/imports?tab=review` |
| QB invoices linked | href (count > 0) | `/billing` |
| Services matched | tooltip | "Auto-resolved via name fuzzy / exact price / combo" |
| Residents upserted | tooltip | "New residents created vs matched against existing" |
| Duplicates skipped | tooltip | "Same resident + date + service already imported" |

**Deep-link pattern** (`imports-client.tsx`): reads `?tab=review` on mount via `new URLSearchParams(window.location.search)` in a `useEffect(() => {...}, [])`. Avoids `useSearchParams()` Suspense boundary requirement. Apply this whenever a page needs URL-driven initial tab state.

### Phase 12E — Tips & Receipts (SHIPPED 2026-05-04)

End-to-end tip support and post-payment receipts. Tips go to the stylist only — they MUST never aggregate into facility revenue, rev-share splits, or QB invoice totals.

**Schema additions**:
- `bookings.tip_cents` integer nullable
- `residents.default_tip_type` text nullable (`'percentage' | 'fixed' | null`)
- `residents.default_tip_value` integer nullable (percent when type is percentage, cents when fixed)
- `stylist_pay_items.tip_cents_total` integer NOT NULL default 0

**Helper**: `src/lib/tips.ts::computeTipCents(priceCents, type, value)`. Single source of truth for tip math.

**Import pipeline**: `POST /api/super-admin/import-service-log` now passes `row.tipsCents` into the booking insert. Parser (`parseServiceLogXlsx`) already populated `ParsedServiceLogRow.tipsCents` from the XLSX `Tips` column — only the insert was discarding it.

**Resident default tip UI**:
- `src/components/residents/default-tip-picker.tsx` — shared `<DefaultTipPicker />` component (None / % / $ toggle, 4 quick-select pills for percentage mode, dollar input for fixed)
- Admin: `resident-detail-client.tsx` edit form gains the picker between Preferred Service and POA fields. `PUT /api/residents/[id]` Zod schema accepts `defaultTipType` + `defaultTipValue`
- Family portal: NEW `/family/[facilityCode]/profile` page (server + client) renders one card per linked resident with embedded picker. New `<UserIcon />` adds a 6th tab in `<PortalNav>` (grid-cols-6).
- NEW `POST /api/portal/residents/[residentId]/tip-default` — portal-session-gated, cross-resident leak guard, coherence validation (type=null implies value=null). Rate limit: `portalProfileUpdate` 20/h/account.

**Booking modal**:
- `tipType` / `tipValue` / `tipCleared` state in `src/components/calendar/booking-modal.tsx`
- Auto-fill effect on resident pick: when not manually cleared, populates from `resident.defaultTipType` + `defaultTipValue`
- Tip row in price breakdown: %/$ pill toggle + number input + clear (×) + live computed-cents readout. Total includes tip.
- POST + PUT + recurring + portal-`book` routes accept `tipCents` (Zod `z.number().int().min(0).max(10_000_000).nullable().optional()`). Service-request route (`/api/portal/request-booking`) intentionally skips — admin confirms requests by creating a real booking where tip can be added.

**Payroll integration**:
- `computeNetPay` extended: `net = base + tipCentsTotal - deductions`
- `POST /api/pay-periods` aggregates `bookings.tip_cents` per stylist into a separate `tipsByStylist` Map (NEVER mixed into `grossByStylist`); writes `tipCentsTotal` + `netPayCents = commission + tips` on the inserted pay items
- Per-stylist sub-block on `/payroll/[id]` shows `Tips: $X.XX (added to net)` when `tipCentsTotal > 0`
- Footer summary line gains `| Tips: $X.XX |` segment when total tips > 0
- CSV export: new `Tips` column between `Commission Amount` and `Hours Worked`; total row shifted

**QuickBooks Bill split**: `/api/quickbooks/sync-bill/[periodId]` now constructs two Bill `Line` entries per stylist when tips > 0: `<Stylist> — <period> commission` (= netPayCents − tipCentsTotal) and `<Stylist> — <period> tips` (= tipCentsTotal). Lines sum to netPayCents — total unchanged, decomposed for QB reporting.

**Email + SMS receipts**:
- `src/lib/email.ts::buildBookingReceiptHtml` — house-style template (burgundy header, table layout, conditional tip row, total in burgundy bold, optional payment label + facility footer)
- `src/lib/sms.ts::sendSms` (Twilio) — gated by `TWILIO_ENABLED='true'` literal (not just truthy); fire-and-forget, never throws. `buildReceiptSms` produces a short summary string.
- NEW `POST /api/bookings/[id]/receipt` — admin/facility_staff guard, master-admin bypass, `receiptSend` rate-limit (10/h/user). Returns `{ emailSent: boolean, smsSent: boolean }`. Sends email if `resident.poaEmail`, SMS if `resident.poaPhone` AND `TWILIO_ENABLED='true'`. No-contact case: silent.
- Stripe webhook auto-fires `sendBookingReceipt(bookingId)` after the bookingId paid-flip (fire-and-forget; never blocks the 200).
- Manual "Send Receipt" button in BookingModal edit mode (admin only) — toasts `"Receipt sent via email + SMS"` / `"Receipt sent via email"` / `"Receipt sent via SMS"` / `"No contact info on file"`.

**SMS Infrastructure**:
- New env vars: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (e.g. `+12025551234`), `TWILIO_ENABLED` (set to `'true'` to activate). Default `false` until ready.
- `twilio` ^6.0.0 added to `package.json`.

**Display + revenue guards**:
- Daily log row: `· Tip $X.XX` inline next to price when `tipCents > 0`. `LogBooking` interface extended.
- Inline `// price_cents only — never add tip_cents (tips go to stylist, not facility revenue)` comments at all 9 known revenue SUM sites: `src/app/api/portal/request-booking/route.ts:52`, `portal/[token]/book/route.ts:79+98`, `bookings/route.ts:149`, `bookings/[id]/route.ts:217`, `bookings/recurring/route.ts:92`, `export/billing/route.ts:134`, `stats/route.ts:68`, `reports/monthly/route.ts:54`. New SUM sites MUST add the same.

### Phase 12F — Facility Timezone Display Contract (SHIPPED 2026-05-04)

All booking timestamps are stored as UTC; display code was using browser-local time, so a viewer in UTC+3 saw a 9 a.m. EST booking as 4 p.m. and the calendar block landed on the wrong row.

**Contract**: every display surface must format against `facility.timezone` (NOT NULL, default `'America/New_York'`).

**New `src/lib/time.ts`** module:
- `getLocalParts(date, tz)` → `{ year, month, day, hours, minutes, weekday }` — replaces `.getHours()` / `.getMinutes()` / `.getDate()` for display logic
- `formatTimeInTz(date, tz)` — `"9:00 AM"` in facility tz
- `formatDateInTz(date, tz, opts?)` — `"Friday, March 27"` in facility tz
- `toDateTimeLocalInTz(date, tz)` — `"YYYY-MM-DDTHH:MM"` for `<input type="datetime-local">`
- `fromDateTimeLocalInTz(local, tz)` → `Date` (UTC) — DST-safe two-pass drift correction (mirrors `serviceDateAtNoonInTz`)

**`src/lib/utils.ts::formatTime` and `formatDate`** gained an optional `timezone` arg (backwards compatible).

**Calendar grid**: `<FullCalendar timeZone={facility.timezone} />` is the contract. One prop fixes axis labels + block positioning across dayGridMonth / timeGridWeek / timeGridDay.

**Booking modal**: `formatDateTimeLocal` rewritten via `toDateTimeLocalInTz`; submit conversion uses `fromDateTimeLocalInTz` so a viewer in any browser tz round-trips to the same UTC instant.

**Surfaces fixed**: dashboard-client (greeting hour, today label, mobile time, TodayCard, calendar/modal invocations), log-client (row times, finalized timestamp, walk-in time picker + submit, today/yesterday/tomorrow labels), analytics/reports-client (hardcoded `'UTC'` → `facility.timezone`), rfms-view ReconciliationPanel reconciledAt, dashboard server `today.getDay()` working-today/tomorrow query, `/api/bookings` POST confirmation email.

**Schema-side**: `BillingFacility` gained `timezone: string`; `/api/billing/summary` route now returns it.

### Phase 12G — Help Center (SHIPPED 2026-05-08)

End-to-end in-app help system: role-aware tutorial cards, Driver.js-powered guided tours that highlight real UI elements, contextual `?` icons (HelpTip) inline throughout the app, and a one-time first-login welcome modal.

**Schema (additive)**: `profiles.has_seen_onboarding_tour boolean default false NOT NULL` — drives the welcome modal; flag flips via `POST /api/profile/onboarding-seen`.

**New routes**:
- `/help` — server component reads `getUserFacility()` + master-admin email, passes role + isMaster to `HelpClient`
- `/help/loading.tsx` — skeleton matching 3-card grid
- `POST /api/profile/onboarding-seen` — auth-only, no body; flips flag to true. Returns `{ data: { ok: true } }`. No `revalidateTag` (profile fetched per-request).

**Tour engine** (`src/lib/help/tours.ts`):
- `TUTORIAL_CATALOG: Tutorial[]` — ~30 cards rendered on `/help`, role-tagged with optional `masterOnly` flag
- `TOUR_DEFINITIONS: Record<string, TourDefinition>` — 5 fully implemented tours: `stylist-calendar`, `stylist-daily-log`, `stylist-residents`, `admin-facility-setup`, `bookkeeper-scan-logs`. Each ships separate `desktop: DriveStep[]` and `mobile: DriveStep[]` arrays.
- `startTour(tourName)` — dynamic-imports `driver.js` (~16 KB gzipped), picks desktop or mobile steps via `window.matchMedia('(max-width: 767px)')`, calls `driver.drive()`
- Driver.js base config: `popoverClass: 'senior-stylist-tour'`, `nextBtnText: 'Next →'`, `prevBtnText: '← Back'`, `doneBtnText: '✓ Done'`, `showProgress: true`, `progressText: 'Step {{current}} of {{total}}'`, `stagePadding: 8`, `stageRadius: 12`, `overlayClickBehavior: 'nextStep'`

**Anchor convention**:
- `data-tour="X"` for desktop-only or shared elements
- `data-tour-mobile="X"` for mobile-only elements (bottom-tab MobileNav, mobile-only buttons in `log-client.tsx`)
- Same selector value on both is forbidden — `querySelector` first-match is unpredictable

**Anchors injected**:
- Sidebar (`sidebar.tsx`): `nav-calendar`, `nav-daily-log`, `nav-residents`, `nav-billing`, `nav-help`, `nav-settings`
- MobileNav (`mobile-nav.tsx`): `data-tour-mobile` variants of the same six
- Calendar: `data-tour="calendar-time-grid"` on FullCalendar wrapper. Slot cells targeted via `.fc-timegrid-slot` CSS selector (FullCalendar has no slot render hook)
- Daily log (`log-client.tsx`): `daily-log-entry-row` (rows wrapper), `daily-log-add-walkin` / `daily-log-scan-sheet` / `daily-log-finalize-button` (each on both desktop and mobile button instances with the appropriate data-tour or data-tour-mobile attribute)
- Residents (`residents-page-client.tsx`): `residents-search`, `residents-new-button`, `residents-table`
- Settings (`general-section.tsx`): `settings-facility-form`, `settings-working-hours`
- Settings (`billing-section.tsx`): `settings-quickbooks`
- Billing (`billing-client.tsx`): `billing-outstanding` (wrapper around StatCard)

**Components**:
- `src/components/help/tutorial-card.tsx` — reusable card: 48px lucide icon (burgundy), DM Serif title, blurb, "~N min" badge, "Watch Demo" (always shows "Coming soon" for now) + "Guided Tour" buttons
- `src/components/help/onboarding-modal.tsx` — first-login welcome with burgundy gradient header, "Start the Tour" + "Skip for now" buttons, both POST to `/api/profile/onboarding-seen`. Tour selection per-role via `ROLE_TOUR_ID` map (admin→facility-setup, stylist→calendar, etc.)
- `src/components/ui/help-tip.tsx` — `<HelpTip tourId label description />`. CircleHelp icon (16px). Desktop: click-outside popover (no Radix dep). Mobile: existing `<BottomSheet>`. Both link to `/help?tour=X`

**Help home reads `?tour=X` query param** via `useSearchParams()` and auto-fires `startTour(X)`, then strips the param via `router.replace('/help')`.

**Sidebar Help nav** (`sidebar.tsx`): visible to ALL roles — moved the original Settings/Master Admin divider block to always render, with Help as the first item, then conditionally Settings (admin/facility_staff/bookkeeper) and Master Admin (env email).

**MobileNav Help nav** (`mobile-nav.tsx`): added between `/payroll` and `/settings`, visible to all six roles. Admin worst-case shows 7 tabs at flex-1.

**Style overrides** in `globals.css`: `.senior-stylist-tour.driver-popover` block applies DM Sans, stone palette, burgundy `#8B2E4A` next button with hover lift, stone outline prev button, 15px font min, 16px radius, 20px padding. `.driver-overlay` re-tinted to `rgba(28,10,18,0.55)` (dark burgundy).

**Brand color rule**: NEVER use teal `#0D7377` for Help Center. Burgundy throughout. The original prompt's "teal" was stale.

**Dependencies added**: `driver.js`, `lucide-react`. Both safe additions; no Radix Popover dep added (rolled simple click-outside in HelpTip).

### Phase 12H — Interactive Guided Tours (SHIPPED 2026-05-08)

Full rewrite of the Phase 12G tour engine to make every guided tour navigation-aware, interactive, and accurate. All 19 catalog tours fully implemented with real step content and selectors that match real DOM elements.

**Engine** (`src/lib/help/tours.ts`):
- `TourStep` type: `{ element, route, title, description, isAction, actionHint? }`. Steps iterate one at a time; `runStep(def, index)` is recursive.
- Cross-route navigation: when `step.route !== window.location.pathname`, save `{tourId, stepIndex, expiresAt}` to `sessionStorage['helpTour']` (5-min TTL) and `window.location.href = step.route` (hard nav). `<TourResumer />` mounted in protected layout picks up after reload via `resumePendingTour()`.
- `waitForElement(selector, 5000ms)` — `requestAnimationFrame` polling, returns null on timeout. On miss, `toastWarning()` dispatches a CustomEvent that TourResumer pipes through `useToast().error()` and the engine skips to the next step.
- Action steps (`isAction: true`): Driver.js step config sets `showButtons: ['previous','close']` (no Next), and an `onClick` listener (capture phase) is attached to the highlighted element via Driver.js's onHighlighted callback proxy. On click, the engine cleans up the listener, destroys the Driver instance, and recurses into the next step with a 50ms delay so React handles the click first.
- Informational steps: regular Next button via `onNextClick` callback wired to `runStep(def, index + 1)`.
- `desktopOnly: true` flag — when true, `startTour` emits "This tour is best viewed on a larger screen" toast and returns early on mobile breakpoints. **No tours currently use this flag** — `master-add-facility` had it removed in Phase 12N (step 1 is now a `/master-admin` info step); `admin-compliance` had it removed in Phase 12L.
- `resolveQuery(selector)` — converts `[data-tour="X"]` into `[data-tour-mobile="X"], [data-tour="X"]` on mobile breakpoint so step authors write a single selector and the engine picks the right element.
- Empty-element steps (`element: ''`) render a popover anchored to `body` for terminal "you're done" copy.

**Resume mechanism** (`src/components/help/tour-resumer.tsx`):
- Mounted inside `ToastProvider` in `(protected)/layout.tsx` (requires Toast access).
- 100ms `setTimeout` after mount to let initial paint settle, then calls `resumePendingTour()`.
- Also bridges the engine's `help-tour-toast` CustomEvent into `useToast()` (engine runs outside React).

**Modal pass-through** (`src/components/ui/modal.tsx`):
- `ModalProps` extended with `[dataAttr: \`data-${string}\`]: string | boolean | undefined` index signature.
- All `data-*` keys spread onto the inner card div via `Object.fromEntries(Object.entries(rest).filter(...))`.
- Used by booking-modal: `<Modal ... data-tour="calendar-booking-modal">` works directly.

**19 tours at Phase 12H ship time**: stylist-getting-started, stylist-calendar, stylist-daily-log, stylist-residents, stylist-finalize-day, facility-staff-scheduling, facility-staff-residents, admin-facility-setup, admin-inviting-staff, admin-residents, admin-reports, admin-family-portal, admin-compliance (desktop-only), bookkeeper-billing-dashboard, bookkeeper-scan-logs, bookkeeper-duplicates, bookkeeper-payroll, master-add-facility (desktop-only), master-quickbooks-setup. Phase 12I added `stylist-my-account` (20). Phase 12K added `staff-getting-started` + `staff-daily-log` and rewrote `facility-staff-scheduling` + `facility-staff-residents` (23 total). Phase 12L (sign-up sheet) added `facility-staff-signup-sheet` + `stylist-signup-sheet` (25). Phase 12L (admin audit) added `admin-getting-started` and rewrote 6 admin tours; removed `desktopOnly` from `admin-compliance` (25 actual — sign-up sheet tours previously counted). Phase 12M added `bookkeeper-getting-started` + `bookkeeper-manual-entry` and rewrote 4 bookkeeper tours (27 total). Phase 12N added `master-getting-started`, `master-stylist-directory`, `master-applicant-pipeline`, `master-analytics` and rewrote `master-add-facility` + `master-quickbooks-setup`; removed `desktopOnly` from `master-add-facility` (31 total). Cards with `tourId: null` show "Coming soon" tooltip.

**~30 new `data-tour` attributes added** (zero behavior changes):
- Sidebar: `nav-analytics`, `nav-payroll`, `nav-stylists`, `nav-master-admin` added to existing tourSlug map
- Mobile-nav: `nav-analytics`, `nav-payroll` (mobile variants)
- Dashboard: `calendar-today-btn`
- Booking modal Modal: `calendar-booking-modal` (via Modal data-* pass-through)
- Log: `daily-log-walkin-form` (conditional on `showWalkIn`)
- OCR modal: `ocr-upload-area`, `ocr-results-table`, `ocr-import-button`, `ocr-duplicate-warning`
- Residents page: `residents-add-form`, `residents-import-button`, `residents-duplicates-button`
- Resident detail: `resident-portal-section`, `resident-portal-send-btn`
- Merge duplicates modal: `duplicates-pair-card`, `duplicates-merge-btn`
- Settings General: `settings-payment-type`, `settings-save-button`
- Settings Billing: `settings-qb-connect-btn`
- Settings Team: `settings-team-section`, `settings-invite-form`, `settings-invite-role-select`, `settings-invite-submit`, `settings-pending-invites`
- Billing: `billing-facility-select`, `billing-filters`, `billing-invoice-list`, `billing-send-statement`
- Payroll list: `payroll-period-list`
- Payroll detail: `payroll-stylist-row`, `payroll-mark-paid-btn`, `payroll-export-btn`
- Analytics: `analytics-revenue-summary`, `analytics-date-range`, `analytics-by-stylist`
- Stylists page: `stylists-table`
- Stylist detail: `stylist-compliance-section` (NOT a tab — just an inline section, since stylist detail is single-page)
- Master Admin: `master-facility-list`, `master-add-facility-btn`, `master-facility-form`

**Substitutions for fictional UI** (referenced in original plan, replaced):
- `stylist-compliance-tab` → `stylist-compliance-section` (page is single-flow, no tabs)
- `analytics-export` removed entirely from `admin-reports` tour (no export button on /analytics; tour now ends with "By stylist" step)

### Phase 12H Selector Audit (2026-05-07)

Post-ship audit fixed all "Couldn't find that element" errors across 19 tours. Two categories of bugs:

**1. `isOnRoute` query-param blindness fixed** (`src/lib/help/tours.ts`):
- `isOnRoute(stepRoute)` previously stripped query params before comparing pathnames. Tours with step routes like `/settings?section=team` or `/settings?section=billing` would not hard-nav to the correct section; they'd match any `/settings` URL and then fail to find the team/billing section elements.
- Fixed: when `stepRoute` contains `?`, the full search string must also match (`window.location.search.replace(/^\?/,'') === stepSearch`). This ensures a hard-nav to `/settings?section=team` when the user is on `/settings` (different section active), and the TourResumer resumes correctly when the page loads at the right URL.

**2. Dynamic-route and conditional elements replaced with `element: ''` info steps**:
Tours can only target elements that are reliably in the DOM at the time a step fires. Elements that live on dynamic-route pages (`/residents/[id]`, `/stylists/[id]`, `/payroll/[id]`) or that require async data (OCR scan results) or user-action preconditions (duplicates modal with data, billing facility-select for master-only) must use `element: ''` (body-anchored popover) so the tour never errors. Affected tours and steps:
- `admin-family-portal` steps 3–4: `resident-portal-section` + `resident-portal-send-btn` (on `/residents/[id]`) → `element: ''`
- `admin-compliance` steps 4–5: `stylist-compliance-section` (on `/stylists/[id]`) → `element: ''`
- `bookkeeper-payroll` steps 4–6: `payroll-stylist-row`, `payroll-mark-paid-btn`, `payroll-export-btn` (on `/payroll/[id]`) → `element: ''`
- `bookkeeper-scan-logs` steps 5–7: `ocr-results-table`, `ocr-import-button` (only exist after async Gemini scan completes) → `element: ''`
- `bookkeeper-duplicates` steps 3–5: `duplicates-pair-card`, `duplicates-merge-btn` (inside modal AND requires duplicate data to exist) → `element: ''`
- `bookkeeper-billing-dashboard` step 3: `billing-invoice-list` (only in IP-view, not RFMS) → `element: ''`; step 6: `billing-facility-select` (only for master admin) → `element: ''`

**Rule added to CLAUDE.md** — Help Center sync is mandatory: any UI add/rename/move/remove must update `tours.ts` selectors, `TUTORIAL_CATALOG`, and HelpTip placements in the same commit. Dynamic-route and conditional elements must always use `element: ''`.

### Phase 12I — Stylist Tour Audit & My Account Tour (SHIPPED 2026-05-08)

Complete rewrite of 4 existing stylist tours; new `stylist-my-account` tour (5 stylist cards total, none "Coming soon").

**Tours rewritten:**
- `stylist-getting-started` (7 steps): info popover → Calendar nav action → calendar-time-grid info → Daily Log nav action → log overview info → My Account nav action → done info
- `stylist-calendar` (5 steps, was 6): removed fragile `.fc-timegrid-slot` action step and `calendar-booking-modal` step; replaced with `calendar-time-grid` info steps. No action step — stylists advance with Next button throughout.
- `stylist-daily-log` (7 steps, was 6): now starts at `/dashboard` with NAV_DAILY_LOG action; `daily-log-entry-row` → `element:''`; `daily-log-walkin-form` → `element:''`; `daily-log-finalize-button` action step kept.
- `stylist-finalize-day` (5 steps, was 4): now starts at `/dashboard` with NAV_DAILY_LOG action; `daily-log-entry-row` → `element:''`.

**New tour — `stylist-my-account`** (7 steps): NAV_MY_ACCOUNT action from `/dashboard` → `my-account-schedule` info → edit-hours info (`element:''`) → `my-account-compliance` info → `my-account-compliance-upload` info (not action — avoids opening upload modal mid-tour) → `my-account-timeoff` info → keep-current info.

**TUTORIAL_CATALOG:** `stylist-account` entry updated: `id` → `stylist-my-account`, `tourId` → `'stylist-my-account'` (was null), `title` → `'My Account'`, blurb → `'Manage your schedule, upload compliance documents, and request time off.'`, `estMinutes: 3`. Blurbs updated on all 5 stylist cards.

**New `data-tour` attributes** (zero behavior change, `my-account-client.tsx`):
- `my-account-schedule` on Your Schedule card outer div
- `my-account-compliance` on Compliance Documents card outer div
- `my-account-compliance-upload` on Upload button
- `my-account-schedule-edit` on Edit hours button inside day row map (data-conditional — tours use `element:''`)
- `my-account-timeoff` on Time Off card outer div

**New anchors in nav:**
- `sidebar-avatar` on `<div className="flex items-center gap-3 px-3 py-2 rounded-xl">` in `sidebar.tsx` (display-only user info)
- `NAV_MY_ACCOUNT = '[data-tour="nav-my-account"]'` constant in `tours.ts`
- `nav-my-account` tourSlug added to `sidebar.tsx` and `mobile-nav.tsx` tourSlug maps

**FullCalendar:** `slotLabelFormat={{ hour:'numeric', minute:'2-digit', omitZeroMinute:false, meridiem:'short' }}` in `calendar-view.tsx` — time axis now shows `7:00am`, `8:00am` format instead of `7`, `8`.

### Phase 12J — Mobile Tour System (SHIPPED 2026-05-08)

A separate mobile renderer for guided tours that runs alongside Driver.js. Shares the same `TourStep[]` data and the same sessionStorage resume mechanism, but renders as a four-panel dark overlay with a rounded spotlight cutout + a bottom sheet card. Driver.js stays unchanged on desktop.

**Branching** at `startTour(tourId, opts)` in `src/lib/help/tours.ts`: when `isMobile()` is true (`window.matchMedia('(max-width: 767px)')`) the function dynamic-imports `./mobile-tour` and calls `startMobileTour()`; otherwise the existing Driver.js path runs unchanged.

**Engine** (`src/lib/help/mobile-tour.ts`):
- `startMobileTour(tourId, opts)` and `runMobileStep(def, index)` mirror the desktop `startTour`/`runStep` shape
- Cross-route hop: saves `SessionState` with `mobile: true` and hard-navigates; `<TourResumer />` resumes via `resumePendingTour()` which routes mobile-flagged state directly to `startMobileTour()`
- Element resolution: `waitForElement(resolveQuery(step.element), 5000)` — same helpers as desktop, exported from `tours.ts`
- After resolving, calls `element.scrollIntoView({ behavior: 'smooth', block: 'center' })` and waits 150ms for scroll to settle before dispatching `help-mobile-tour-show`
- Action steps attach a one-time capture-phase click listener to the target with a 50ms timeout (same logic as desktop)
- Info steps wait for `help-mobile-tour-advance` `{ direction }` from the overlay

**Overlay** (`src/components/help/mobile-tour-overlay.tsx`):
- React component mounted at `(protected)/layout.tsx` inside `ToastProvider`, alongside `<TourResumer />`
- Listens for `help-mobile-tour-show` / `help-mobile-tour-hide` CustomEvents; renders `null` when no active step
- Portal target is `document.body` via `react-dom/createPortal`
- Layout: 4 absolutely-positioned `bg-black/60` panels surrounding the spotlight rect (target rect + 8px padding); separate `ring-4 ring-white/30 rounded-2xl pointer-events-none` div for the visual ring; bottom sheet card pinned to bottom
- Pointer-events: panels = auto (block underlying clicks), spotlight area = no panel (clicks pass through to highlighted element), ring = none, sheet = auto
- Bottom sheet contents: handle bar → close button (top-right) → progress dots (filled `#8B2E4A` / empty stone-200, 8px circles, 4px gap) → DM Serif Display title (`text-xl font-bold`) → 15px description → action hint OR stacked Next/Back buttons (52px min-height, `rounded-2xl`, burgundy on top with shadow)
- Action step branch: hides Next button, shows italic `step.actionHint ?? 'Tap the highlighted area to continue'`
- Last step: Next button text becomes `✓ Done` and dispatches `help-mobile-tour-close`
- Swipe gestures (touchstart/touchend on the sheet): horizontal `|dx| > 50 && |dx| > |dy|` advances (left → next, right → prev). Vertical scroll preserved.
- Entrance: `translateY(100%) → 0` over 300ms `cubic-bezier(0.32, 0.72, 0, 1)` — animated only on the FIRST show event of a tour run (subsequent steps don't re-animate). Tracked via `isFirstShowRef`.
- Window scroll/resize listeners re-measure rect via `targetElRef.current.getBoundingClientRect()` so the spotlight follows the element under viewport changes.
- Body scroll is locked while overlay is active (`document.body.style.overflow = 'hidden'`).

**`SessionState.mobile?: boolean`** — added in Phase 12J. When the mobile engine saves state for a cross-route hop it sets `mobile: true`. `resumePendingTour()` reads the flag and routes directly to `startMobileTour()` without re-running breakpoint detection. This makes the renderer sticky to the device that started the tour, so a hard reload doesn't flip from spotlight to Driver.js (or vice versa) if `matchMedia` happens to wobble.

**`mobileTitle?` / `mobileDescription?`** optional fields on `TourStep`. When the mobile overlay renders, it uses `step.mobileTitle ?? step.title` and `step.mobileDescription ?? step.description`. Authors only need to add mobile copy when the desktop description exceeds 120 chars or uses "Click". Currently set on 9 steps across the 5 stylist tours.

**globals.css** gained one keyframe (`mobile-tour-pulse`) and one class (`.mobile-tour-spotlight-pulse`, 1.5s ease-in-out infinite). Applied to the spotlight ring on action steps. Respects `prefers-reduced-motion` via the existing global motion-reduction block (no extra rule needed).

**CustomEvents** (engine ↔ overlay pub/sub, mirroring the existing `help-tour-toast` pattern):
- `help-mobile-tour-show` `{ tourId, stepIndex, step, totalSteps }` — engine → overlay
- `help-mobile-tour-hide` `{}` — engine → overlay
- `help-mobile-tour-advance` `{ direction: 'next' | 'prev' }` — overlay → engine
- `help-mobile-tour-close` `{}` — overlay → engine

**Helpers exported from `tours.ts`** (previously module-private, now `export`'d so `mobile-tour.ts` can reuse them without duplication): `SESSION_KEY`, `SESSION_TTL_MS`, `ELEMENT_WAIT_MS`, `SessionState` type, `isMobile`, `resolveQuery`, `waitForElement`, `saveSessionState`, `loadSessionState`, `clearSessionState`, `toastWarning`, `toastInfo`, `isOnRoute`. Behavior unchanged.

### Phase 12K — Facility Staff Tour Audit (SHIPPED 2026-05-10)

Two new tours and two rewrites, all in `src/lib/help/tours.ts`. No other files changed. Tour count: 19 → 23 (21 after 12I, 23 after 12K).

**`staff-getting-started`** (NEW, 7 steps): Starts at `/help` with a `element:''` welcome info step, then a `NAV_CALENDAR` action step → `/dashboard` with `calendar-time-grid` info step → `NAV_RESIDENTS` action step → `/residents` with `residents-table` info step → `NAV_DAILY_LOG` action step → `/log` with `element:''` "You're all set" info step. TUTORIAL_CATALOG flipped from `tourId: null` to `tourId: 'staff-getting-started'`; blurb updated.

**`facility-staff-scheduling`** (REWRITE, 6 steps, all INFO, all on `/dashboard`): Removed the data-conditional `calendar-booking-modal` step (was not preceded by an action step opening it — violates CLAUDE.md selector safety rule) and the cross-route residents hop from the original design. All 6 steps stay on `/dashboard`. Steps: `calendar-time-grid` overview → `calendar-today-btn` navigation → `calendar-time-grid` finding open slots → `calendar-time-grid` create booking (mobile copy: search resident + tap Book) → `element:''` editing a booking → `element:''` "when a resident calls" narrative. Blurb updated in TUTORIAL_CATALOG.

**`facility-staff-residents`** (REWRITE, 7 steps): Added `NAV_RESIDENTS` action step as the opener (was previously jumping straight to `/residents` without a nav step). Added two `element:''` info steps for "View a resident profile" and "Update resident info" (resident detail page is a dynamic route `/residents/[id]` — cannot be targeted by tour; must use `element:''`). Kept `residents-add-form` spotlight on step 7 because the immediately preceding step IS the `residents-new-button` isAction:true step (safe per CLAUDE.md rule). Blurb updated in TUTORIAL_CATALOG.

**`staff-daily-log`** (NEW, 4 steps): Starts at `/help` with `NAV_DAILY_LOG` action step → `/log` with 3 `element:''` info steps (what is the daily log / reading the log / that's it). Daily log entry rows are data-conditional (not in DOM without bookings) — cannot be targeted by tour, so all post-nav steps use `element:''`. New TUTORIAL_CATALOG entry added (5th facility_staff card); `staff-daily-log-readonly` (tourId: null) kept as-is for legacy compatibility.

**`All 23 tours`**: stylist-getting-started, stylist-calendar, stylist-daily-log, stylist-residents, stylist-finalize-day, stylist-my-account, staff-getting-started, facility-staff-scheduling, facility-staff-residents, staff-daily-log, admin-facility-setup, admin-inviting-staff, admin-residents, admin-reports, admin-family-portal, admin-compliance, bookkeeper-billing-dashboard, bookkeeper-scan-logs, bookkeeper-duplicates, bookkeeper-payroll, master-add-facility, master-quickbooks-setup. (+ 1 from 12I: stylist-my-account)

### Phase 12L — Facility Admin Tour Audit (SHIPPED 2026-05-11)

1 new tour + 6 rewrites in `src/lib/help/tours.ts` only. No schema, API, or UI changes.

**New tour: `admin-getting-started`** (7 steps): /dashboard info → /settings info → /residents `residents-new-button` info → /dashboard `nav-calendar` info → /log `nav-daily-log` info → /dashboard invite-team info → /dashboard you're-ready info. Catalog entry: estMinutes 4, roles `['admin', 'super_admin']`.

**Rewrites** (all steps use `element: ''` or safe non-conditional selectors; no action steps):
- `admin-facility-setup` (5 steps): settings overview → `settings-nav-general` → `settings-nav-billing` → `settings-nav-team` → done
- `admin-inviting-staff` (4 steps): who-you-can-invite info → `settings-nav-team` info → send-an-invite info → managing-access info. Copy explicitly says stylists are managed by Franchise Admin, not from here.
- `admin-residents` (5 steps): residents overview → `residents-new-button` info → resident-detail info → family-portal-access info → bulk-import info
- `admin-reports` (4 steps): `nav-analytics` info on /analytics → revenue-bookings info → stylist-breakdown info → exporting info
- `admin-family-portal` (5 steps): what-the-portal-does → add-POA-email → send-invite → booking-requests → online-payments. All on /residents, all `element: ''`.
- `admin-compliance` (4 steps): `desktopOnly` **removed**. Step 1: info at /dashboard. Steps 2–4: `element: ''` at /stylists (engine hard-navs to /stylists via `route` field without needing sidebar interaction). Replaces the old `NAV_STYLISTS` action step that required the sidebar link.

**TUTORIAL_CATALOG** updates: `admin-getting-started` added (new card). All 7 admin cards updated: blurbs rewritten, estMinutes adjusted (facility-setup 4→3, inviting-staff 3→2, reports 3→2, family-portal 4→3, compliance 3→2), all include `super_admin` in roles (franchise admins now see admin tutorials). `admin-compliance` title shortened to "Compliance Docs".

**Tour count: 24 → 25** (corrected from earlier docs which said 25 → 26; sign-up sheet tours brought the count to 25 before 12L ran).

### Phase 12M — Bookkeeper Tour Audit (SHIPPED 2026-05-11)

2 new tours + 4 rewrites in `src/lib/help/tours.ts` and `src/components/help/tutorial-card.tsx`. No schema, API, or UI changes.

**New tours**:
- `bookkeeper-getting-started` (7 steps): /log info → `nav-daily-log` action → two-ways-to-enter info → `nav-billing` action → `billing-outstanding` info → `nav-payroll` action → /payroll you're-all-set info.
- `bookkeeper-manual-entry` (8 steps): `nav-daily-log` action → manual-entry info → `daily-log-add-walkin` action → filling-in info → work-through info → check-the-date info → `daily-log-finalize-button` info → manual-vs-scan info.

**Rewrites**:
- `bookkeeper-billing-dashboard` (6 steps): `nav-billing` action → `billing-outstanding` info → invoice-list info → `billing-filters` info → `billing-send-statement` info → monthly-routine info. First step now starts at /billing (not /dashboard).
- `bookkeeper-scan-logs` (10 steps, expanded from 7): `nav-daily-log` action → what-scanning info → `daily-log-scan-sheet` action → `ocr-upload-area` info → reviewing-results info → what-to-check info → editing-misread info → resident-not-found info → import-when-ready info → after-importing info.
- `bookkeeper-duplicates` (7 steps, expanded from 6): why-duplicates-happen info → `nav-residents` action (new opener) → `residents-duplicates-button` action → reviewing-pairs info → before-you-merge info → merging info → after-merging info.
- `bookkeeper-payroll` (6 steps): `nav-payroll` action → `payroll-period-list` info → reviewing-period info → marking-as-paid info → exporting info → quickbooks-sync info (new step).

**TUTORIAL_CATALOG** changes: entire bookkeeper block replaced. `bookkeeper-getting-started` added first (KeyRound, 3 min). `bookkeeper-manual-entry` added after `scan-logs` (PenLine, 4 min). All 6 live entries updated with new blurbs/estMinutes. `bookkeeper-quickbooks` + `bookkeeper-financial-reports` remain `tourId: null`. Ordering: getting-started → scan-logs → manual-entry → duplicates → billing-dashboard → payroll → quickbooks → financial-reports.

**`PenLine` icon**: added to `TutorialIcon` union in `tours.ts`; added to lucide-react import + `ICON_MAP` in `tutorial-card.tsx`.

**Tour count: 25 → 27**.

### Phase 12N — Master Admin Tour Audit (SHIPPED 2026-05-11)

4 new tours + 2 rewrites in `src/lib/help/tours.ts`. No schema, API, UI, or other file changes.

**New tours**:
- `master-getting-started` (7 steps): /master-admin info → `NAV_MASTER_ADMIN` action → `master-facility-list` info → what-you-oversee info → `NAV_STYLISTS` action (route: /stylists/directory) → `stylists-table` info → you're-ready info.
- `master-stylist-directory` (6 steps): all on /stylists/directory — intro info → `stylists-table` info → status-types info → changing-status info → assigning-to-facilities info → franchise-pool info.
- `master-applicant-pipeline` (6 steps): all on /stylists/directory — intro info → import-from-indeed info → applicants-tab info → reviewing info → promoting info → after-promoting info.
- `master-analytics` (5 steps): `NAV_ANALYTICS` action → `analytics-revenue-summary` info → `analytics-date-range` info → `analytics-by-stylist` info → comparing-facilities info.

**Rewrites**:
- `master-add-facility` (6 steps, was 5): `desktopOnly: true` **removed**. Step 1 is now `/master-admin` info (engine hard-navs via route field — no sidebar action needed). Added new step 6 "Assigning stylists" info. Updated all blurbs.
- `master-quickbooks-setup` (6 steps, was 4): Step 1 added as `/settings` info intro. Step 2 is `NAV_SETTINGS` action on `/settings`. Step 4 `settings-qb-connect-btn` changed to `isAction: true`. Two new closing steps (after-connecting info, per-facility-setup info).

**TUTORIAL_CATALOG** changes: entire master block replaced with 10 entries (6 live, 4 Coming Soon). New entries: `master-getting-started` (first, KeyRound, 3 min), `master-stylist-directory` (Users, 4 min), `master-applicant-pipeline` (UserPlus, 4 min), `master-analytics` (BarChart3, 3 min). Updated blurbs/estMinutes on `master-add-facility` and `master-quickbooks-setup`. Ordering: getting-started → add-facility → stylist-directory → applicant-pipeline → quickbooks-setup → analytics → franchise (null) → cross-facility-analytics (null) → merge-duplicates (null) → team-roster (null).

**`desktopOnly` note**: no tours now carry `desktopOnly: true` — both `master-add-facility` (Phase 12N) and `admin-compliance` (Phase 12L) had it removed.

**Tour count: 27 → 31**.

### Sign-Up Sheet (SHIPPED 2026-05-11)

Lightweight intake queue for facility staff to log resident appointment requests without picking a time slot. Stylists later convert pending entries into real bookings via the booking modal.

**Schema** — new `signup_sheet_entries` table in `src/db/schema.ts`:
- Columns: `id`, `facility_id`, `resident_id` (nullable — denormalized `resident_name`/`room_number` for display), `service_id` (nullable, denormalized `service_name`), `requested_time` (text 'HH:MM' tz-agnostic, nullable), `requested_date` (date), `notes` (max 500 in API), `created_by`, `assigned_to_stylist_id` (nullable), `status` ('pending'|'scheduled'|'cancelled'), `booking_id` (set when entry is converted), timestamps.
- Indexes: `(facility_id, requested_date)` for the panel queue + partial `(assigned_to_stylist_id, requested_date) WHERE status='pending'` for the stylist lookup.
- RLS: `service_role_all` only — all access via API routes (no middleware-scoped policy needed).

**API routes** (`src/app/api/signup-sheet/`):
- `POST /` — admin/facility_staff (master bypass); Zod-validated; verifies resident/service/stylist scope; auto-fills room from resident if not provided; returns full entry with relations.
- `GET /?date=YYYY-MM-DD` — any role at facility; defaults `date` to today in facility tz; stylists see only entries assigned to them OR unassigned; returns relations (resident/service/assignedStylist).
- `PATCH /[id]` — admin/facility_staff edit any field; stylists can only PATCH `notes` on entries assigned to them; rejects edits when `status='scheduled'`; allows status flip to 'cancelled'.
- `POST /[id]/convert` — admin/facility_staff/stylist; accepts the same body shape as `POST /api/bookings` (residentId, serviceIds, startTime, stylistId, tipCents, addonChecked, etc.). Inside `db.transaction`: pricing resolution via `resolvePrice`, conflict check, insert booking, update entry to `status='scheduled'`+`booking_id=newId`. Fires GCal sync after commit (fire-and-forget). Reuses booking-creation logic inline (~80 lines) — extracting a shared helper deferred.

**UI**:
- `src/components/signup-sheet/signup-sheet-panel.tsx` (`<SignupSheetPanel>`) — facility-side panel. Right-anchored modal on desktop (`md:items-stretch md:justify-end md:pr-6 md:max-w-lg`), bottom sheet on mobile. Top: form (resident typeahead with inline new-resident create, room override, service typeahead — NO inline service create, time `<input type="time">`, stylist `<select>`, notes); bottom: today's queue grouped by stylist with cancel-X.
- `src/components/signup-sheet/stylist-pending-entries.tsx` (`<StylistPendingEntries>`) — collapsible amber panel above stylist calendar (and above the bookings list in mobile-stylist mode). Hidden when `entries.length === 0`. Each entry has a Schedule button.

**BookingModal integration** — three new optional props:
- `prefillResidentId?: string | null` — pre-selects resident in create mode
- `prefillServiceId?: string | null` — pre-selects single service in create mode
- `signupSheetEntryId?: string | null` — when set, the create POST goes to `/api/signup-sheet/[id]/convert` instead of `/api/bookings`. The basePayload always includes `stylistId: pickedStylist.id` when available (convert endpoint requires it; booking POST treats it as optional).

**Dashboard wiring** (`src/app/(protected)/dashboard/dashboard-client.tsx`):
- Sign-Up Sheet button in calendar header (admin + facility_staff) with `data-tour="signup-sheet-button"` and a HelpTip
- `<SignupSheetPanel>` mounted alongside the BookingModal, only for admin + facility_staff
- `<StylistPendingEntries>` mounted above the calendar card (stylist desktop) AND inside the mobile-stylist early-return path
- BookingModal also mounted in the mobile-stylist early-return path (was missing — needed for both QuickBookFAB and signup-sheet schedule)
- New state: `signupSheetOpen`, `pendingSignups`, `schedulingEntryId`, `prefillResidentId`, `prefillServiceId`. `handleScheduleSignupEntry` builds defaultStart from `entry.requestedTime` (or rounds to next half-hour), pre-fills modal, and on success removes entry from `pendingSignups`.

**Help tours** (in `src/lib/help/tours.ts`): two new tours and TUTORIAL_CATALOG entries. `facility-staff-signup-sheet` (6 steps; includes one action step on `[data-tour="signup-sheet-button"]`); `stylist-signup-sheet` (4 steps, all info — panel content is conditional UI per the selector-safety rule). `ClipboardList` added to `TutorialIcon` union and `ICON_MAP` in `tutorial-card.tsx`. **Tour count: 23 → 25**.

**Cache tag**: `'signup-sheet'` busted by all 3 mutation routes; `'bookings'` also busted by convert.

### Phase 12O — Tour Mode Write Interception (SHIPPED 2026-05-11)

Guided tours now run in "demo mode": while a tour is active, every write (`POST`/`PUT`/`PATCH`/`DELETE`) to a same-origin `/api/*` route is intercepted client-side and returns a fake success response. `GET`/`HEAD` and external URLs (Supabase auth, Resend, Intuit OAuth) always pass through. A burgundy banner pinned to `top: 0` makes the demo state visible.

**Why**: tour copy says "tap Save", "tap Finalize Day", "tap Add Walk-in" — and before this phase those clicks actually wrote to the database. Users hesitated to follow action steps, and admins running tours for staff accidentally created demo bookings, residents, and finalized logs in production.

**Architecture** — three small modules, no DB or API changes:
- `src/lib/help/tour-mode.ts` — module-level `_tourModeActive` flag. `setTourModeActive(active)` dispatches `tour-mode-change` CustomEvent (`detail: { active }`) on change. `isTourModeActive()` returns the flag. Lives outside React so both engines + the fetch interceptor read it without prop drilling.
- `src/lib/help/tour-fetch-interceptor.ts::installTourFetchInterceptor()` — patches `window.fetch` exactly once (`_installed` module guard). When tour mode is off, the patch is a pass-through. When on, only same-origin `/api/*` writes are intercepted; reads + external URLs are untouched. `buildFakeResponse(url, method)` returns minimal realistic shapes for the highest-traffic write paths and falls back to `{ data: {}, ok: true }`.
- `src/components/help/tour-mode-banner.tsx` — `<TourModeBanner />` listens to `tour-mode-change` CustomEvent, mounts at the top of `(protected)/layout.tsx` outside `<main>` (otherwise the inner scroll container's `overflow: auto` would clip it). Always rendered; toggles `translateY(0)` ↔ `translateY(-100%)` with 200ms ease-out transition.

**Smart fake response shapes** (URL substring match in `tour-fetch-interceptor.ts`, order matters — more specific URLs first):

| URL match | Method | Fake `Response` body |
|---|---|---|
| `/api/bookings` + `/receipt` | POST | `{ data: { emailSent: true, smsSent: false } }` |
| `/api/log/ocr/import` | POST | `{ data: { created: { bookings: 0 } } }` |
| `/api/log/ocr` | POST | `{ data: { sheets: [] } }` |
| `/api/log[/...]` | POST/PUT | `{ data: { id: 'demo-<ts>', finalized: true, finalizedAt, notes: '' } }` |
| `/api/bookings` | POST | `{ data: { id: 'demo-<ts>', status: 'scheduled' } }` |
| `/api/bookings/[id]` | PUT/PATCH | `{ data: { id: 'demo-<ts>', status: 'completed', paymentStatus: 'paid', priceCents: 0 } }` |
| `/api/residents` | any write | `{ data: { id: 'demo-<ts>', name: 'Demo Resident' } }` |
| else | any write | `{ data: {}, ok: true }` |

**Known limitation**: the codebase has zero optimistic-update sites — every client write reads the response and destructures specific fields. Any route not covered by `buildFakeResponse()` returns the generic `{ data: {}, ok: true }`; client code that tries to read `data.X.Y` will throw. Accepted tradeoff — the tour copy guides the user through the click and the tour engine advances regardless of the resulting DOM state. If a tour step regularly leaves the user stuck, add a route-specific shape.

**Engine wire-up — flag flip placement**:
- `setTourModeActive(true)` is called at the **top** of `startTour()` (after the mobile branch) and the **top** of `startMobileTour()` (after the re-entry guard). The interceptor install happens here too, before the flip.
- `setTourModeActive(false)` is called at exactly **two paths per engine** — the truly terminal exits, NOT inside the destroy helpers:
  - Desktop: terminal-step branch in `runStep` (`if (index >= def.steps.length)`) and `onCloseClick`
  - Mobile: terminal-step branch in `runMobileStep` and `activeCloseHandler`
- Internal step-transition cleanups (info next/prev, action auto-advance) still call `destroyActiveTour()` / `destroyActiveMobileTour()` but do NOT flip tour mode off. Putting the flip in the destroy helpers would briefly drop demo mode between every step.
- Cross-route hard-nav does NOT need an explicit flip: `window.location.href = …` wipes all JS module state on reload, so the flag returns to `false` naturally. `TourResumer` re-installs and `startTour`/`startMobileTour` re-flip to `true`.

**Resume safety**: `tour-resumer.tsx` calls `installTourFetchInterceptor()` BEFORE `resumePendingTour()` inside its mount effect. This re-applies the patch after a hard-nav reload during the window between layout mount and the actual `startTour` / `startMobileTour` call. `setTourModeActive(true)` is NOT duplicated in the resumer — the engines handle it.

**Tour copy reassurance**: 6 write-action steps had their `actionHint` updated to make it explicit that the action is safe to try in tour mode:
- `stylist-daily-log` "Add a walk-in" → "Go ahead and tap — nothing will be saved for real."
- `stylist-daily-log` "Finalize the day" → "Tap Finalize Day — this is just a demo, your real log won't be affected."
- `stylist-finalize-day` "Finalize Day" → same
- `bookkeeper-scan-logs` "Open the scan tool" → "Tap Scan log sheet to see how it works — no real data will change."
- `bookkeeper-duplicates` "Find duplicates" → "Tap Duplicates to see the result — this is just a demo."
- `master-quickbooks-setup` "Connect QuickBooks" → "Tap Connect QuickBooks to see the flow — no real connection will be made."

**Special case — `master-quickbooks-setup`**: the "Connect QuickBooks" action does a top-level navigation to `accounts.intuit.com`, an external URL. The interceptor's `/api/*` prefix check means external navigation is not blocked. The new copy honestly says "see the flow" — users can dismiss the Intuit page and the tour resumes via sessionStorage. Short-circuiting the OAuth handler with a `tour-mode` check would be an API change and was left out of Phase 12O scope.

**Files**:
- New: `src/lib/help/tour-mode.ts`, `src/lib/help/tour-fetch-interceptor.ts`, `src/components/help/tour-mode-banner.tsx`
- Modified: `src/lib/help/tours.ts` (3 sites + 6 actionHint updates), `src/lib/help/mobile-tour.ts` (3 sites), `src/components/help/tour-resumer.tsx` (interceptor install), `src/app/(protected)/layout.tsx` (banner mount)

### Phase 12P — Client-Side Tour Navigation (SHIPPED 2026-05-11)

Tour engines now use Next.js `router.push()` for cross-route step transitions, replacing the previous `window.location.href` hard-reload. The layout, sidebar, and all tour engine module state (`_tourModeActive`, the patched `window.fetch`, the Driver.js singleton, mobile engine `activeMobileTourId`) survive the SPA transition. Combined with a `MutationObserver`-based `waitForElement`, cross-route steps now advance in tens of milliseconds instead of 500–800ms with a white flash.

**Why**: Phase 12H's hard-nav + sessionStorage resume worked but wasted 500–800ms per cross-route step on reload + `<TourResumer />`'s 100ms paint-settle delay + new module state reinitialization. For multi-route tours (e.g. `admin-getting-started` spans `/help` → `/master-admin` → `/settings`) that's several seconds of latency the user sees as "the tour is laggy".

**Module-level router ref pattern** — tour engines run outside the React tree and can't call `useRouter()` directly:
- `src/lib/help/tour-router.ts` — `let _router: AppRouter | null = null` + `setTourRouter(router)` / `getTourRouter()`. `AppRouter` is typed as `ReturnType<typeof useRouter>` from `next/navigation` to avoid the brittle `next/dist/shared/lib/app-router-context.shared-runtime` deep import.
- `src/components/help/tour-router-provider.tsx` — `'use client'`, calls `setTourRouter(useRouter())` inside `useEffect` and renders null. Mounted in `(protected)/layout.tsx` inside `<ToastProvider>` directly above `<TourResumer />`.

**Engine wire-up** — both `tours.ts::runStep` (around line 770) and `mobile-tour.ts::runMobileStep` (around line 102) replace the cross-route block:

```ts
if (!isOnRoute(step.route)) {
  destroyActiveTour() // or destroyActiveMobileTour() + dispatchHide() on mobile
  const router = getTourRouter()
  if (router) {
    router.push(step.route)
    // Fall through — waitForElement (MutationObserver) resolves on render.
  } else {
    // Fallback only: router ref not yet populated (SSR race)
    saveSessionState({ ... }) // unchanged shape, includes expiresAt
    window.location.href = step.route
    return
  }
}
```

Critical invariants for the `router.push()` branch — do not break:
- **No `saveSessionState()`**: the engine stays alive in memory, no resume needed.
- **No `return`**: control falls through to the existing `waitForElement` call, which now resolves via MutationObserver when the new route renders.
- **Destroy first**: the previous step's highlight is destroyed BEFORE `router.push` so the old overlay clears before the new route's DOM appears.

**`waitForElement` rewrite** (`tours.ts`, lines ~93–125) — `MutationObserver`-based:

```ts
export function waitForElement(selector, timeoutMs) {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector)
    if (existing && existing.offsetParent !== null) {
      resolve(existing); return  // instant resolve — no rAF tick
    }
    let settled = false
    const observer = new MutationObserver(() => {
      if (settled) return
      const el = document.querySelector(selector)
      if (el && el.offsetParent !== null) {
        settled = true; clearTimeout(timer); observer.disconnect(); resolve(el)
      }
    })
    const timer = setTimeout(() => {
      if (settled) return
      settled = true; observer.disconnect(); resolve(null)
    }, timeoutMs)
    observer.observe(document.body, { childList: true, subtree: true })
  })
}
```

Properties:
- **Instant resolve** when the element is already in the DOM — no requestAnimationFrame minimum delay.
- **Always disconnects** the observer (on resolve OR timeout) — no observer leaks.
- **Same signature** — `mobile-tour.ts` calls `waitForElement(resolveQuery(step.element), MOBILE_ELEMENT_WAIT_MS)` unchanged.
- **Visibility guard preserved**: both the initial sync check and the observer callback verify `offsetParent !== null` (hidden elements don't satisfy the wait, matches old polling behavior).
- `DESKTOP_ELEMENT_WAIT_MS = 2000` and `MOBILE_ELEMENT_WAIT_MS = 2000` remain the timeout budgets.

**Fallback hierarchy** (in priority order):
1. `getTourRouter()` returns a router → SPA `router.push`, no sessionStorage, fall through to MutationObserver wait.
2. `getTourRouter()` returns null → save sessionStorage with `expiresAt` and `mobile?` flag, `window.location.href` hard-nav, `<TourResumer />` reads sessionStorage on next mount and re-launches via `startTour` / `startMobileTour`.
3. Manual browser refresh during a tour → same sessionStorage path as (2) — but only resumes if sessionStorage was actually written (i.e., a previous fallback fired). The SPA path doesn't write sessionStorage, so a refresh during a router.push tour loses progress. Acceptable tradeoff — re-launch from `/help`.

**`<TourResumer />` unchanged** — still exists, still calls `resumePendingTour()` 100ms after layout mount, still re-installs the fetch interceptor. It just has nothing to resume in the normal SPA flow because sessionStorage was never written. It remains load-bearing for: manual refreshes, the no-router-ref fallback, and external `window.location.href` writes (debug routes).

**`isOnRoute()` unchanged** — reads `window.location.pathname` + `window.location.search`. After `router.push`, both update synchronously before render. The decoupling that makes this safe is `waitForElement`: the engine doesn't trust the URL alone, it waits for the DOM.

**Phase 12J / 12O integration**:
- `setTourModeActive(true)` placement unchanged (top of `startTour` / `startMobileTour`).
- `setTourModeActive(false)` placement unchanged (two terminal exits per engine).
- Fetch interceptor `installTourFetchInterceptor()` still called at engine start AND on `<TourResumer />` mount — the second call is now mostly redundant in the SPA path (module state never wiped), but stays as a safety net for the hard-nav fallback.
- Mobile bottom-sheet entrance animation: only runs on first show; the new SPA flow doesn't dispatch `help-mobile-tour-hide` between cross-route steps any more, so consecutive steps don't re-animate.

**Files**:
- New: `src/lib/help/tour-router.ts`, `src/components/help/tour-router-provider.tsx`
- Modified: `src/app/(protected)/layout.tsx` (TourRouterProvider mount), `src/lib/help/tours.ts` (`waitForElement` rewrite + `runStep` cross-route block), `src/lib/help/mobile-tour.ts` (`runMobileStep` cross-route block)

### Phase 12S — Signup Sheet v2 (SHIPPED 2026-05-11)

Completes the signup-sheet workflow: server-side auto-assignment, preferred-date field, drag-to-calendar, pending-count badge on Calendar nav, and admin cross-stylist view.

**Schema** — added `preferred_date date` (nullable) to `signup_sheet_entries`. The existing `assigned_to_stylist_id` and `notes` columns (already present from initial signup-sheet ship) are reused. No duplicate columns. No new indexes.

**Auto-assignment** — `src/lib/signup-sheet-assignment.ts::resolveAssignedStylist(facilityId, preferredDate, db)`:
1. **Date-aware path**: queries `stylists ⨯ stylist_facility_assignments ⨯ stylist_availability` for stylists with active availability for the day-of-week of `preferred_date`. If multiple candidates → least-loaded (fewest non-cancelled bookings on that date). If exactly one → return them.
2. **Fallback**: most-recently-updated active stylist assigned to the facility.
3. Returns null when no candidates exist.

**API changes**:
- `POST /api/signup-sheet` — accepts `preferredDate: 'YYYY-MM-DD' | null`. When caller omits `assignedToStylistId`, auto-resolves via `resolveAssignedStylist`. The Zod-validated `notes` cap is 500 server-side; client UI caps at 300.
- `GET /api/signup-sheet`:
  - **Canonical filter**: `status='pending'` (was `!= 'cancelled'`). Scheduled entries are real bookings on the calendar and would inflate the badge / pollute admin views.
  - `?scope=all` — admin/facility_staff only (stylists get 403); skips the per-stylist filter and the date filter. Returns all facility-wide pending entries for the admin "Pending requests" view.
  - `?countOnly=true` — returns `{data:{count:n}}` instead of the entry list. Skips the date filter so the badge counts future requests too. Same per-stylist scoping as the list path.
- No new DELETE — cancellation continues via existing `PATCH /[id] {status:'cancelled'}`.

**UI — `<SignupSheetPanel>`**:
- New preferred-date `<input type="date" min={todayDate}>` row.
- Notes upgraded from `<input>` to `<textarea rows={2} maxLength={300}>` with placeholder "e.g. prefers morning, needs extra time".
- New `<AdminPendingSection>` (inline-defined at the bottom of the same file) at the TOP of the scroll body, visible to admin/super_admin/facility_staff. Fetches `?scope=all` on mount. Shows resident, service, preferred-date chip, assigned stylist name, notes (italic, truncated). Per-row × button calls `PATCH .../[id] {status:'cancelled'}`. Collapses behind "Show all (N)" toggle when N>5.
- Data-tour anchors added: `signup-sheet-panel`, `signup-sheet-form`, `signup-sheet-preferred-date`, `signup-sheet-notes`, `signup-sheet-submit`.

**UI — `<StylistPendingEntries>`**:
- Now `forwardRef<HTMLDivElement>` — `dashboard-client.tsx` passes the ref to FullCalendar's `Draggable` registration.
- New props: `facilityTimezone` (drives preferred-date chip formatting via `formatDateInTz`) and `viewAsAdmin?: boolean`.
- Each entry card: `draggable={true}` with `data-signup-entry-id`, a `<GripVertical>` drag handle (`hidden md:flex` — desktop only), preferred-date chip with lucide `<Calendar size={12}>`, notes (italic gray, 80-char truncate), assigned-stylist name when `viewAsAdmin`, and a "Pick time →" button (renamed from "Schedule").
- Outer panel anchor renamed `stylist-signup-sheet-panel` → `stylist-pending-panel`. Entry-level anchors added: `stylist-pending-entry`, `stylist-pending-convert`.

**Drag-to-calendar** — `calendar-view.tsx::CalendarView` gains an optional `onSignupDrop?: (entryId: string, date: Date) => void` prop. `<FullCalendar>` is set `droppable={!!onSignupDrop}` with a `drop` callback reading `arg.draggedEl.dataset.signupEntryId` and the dropped date. `dashboard-client.tsx` instantiates FC `Draggable` once via `useEffect` keyed on `pendingSignups.length`, lazy-importing `@fullcalendar/interaction` to keep FC out of non-stylist bundles. The drop handler opens BookingModal with `prefillResidentId`/`prefillServiceId`/`signupSheetEntryId` + the dropped date as `modalStart`. Mobile is "Pick time →" only (drag handle hidden).

**Pending count badge** — `src/components/signup-sheet/pending-signup-badge.tsx`. Stylist-only (returns null otherwise). Fetches `?countOnly=true` on mount. Renders burgundy `bg-[#8B2E4A] text-white rounded-full` pill. Mounted inline in `sidebar.tsx` after the Calendar nav label (uses `flex-1` on the label span so the badge sits on the right), and absolute-positioned at the top-right of the Calendar icon in `mobile-nav.tsx`. Mirrors `<NeedsReviewBadge />`.

**Tours**: both signup-sheet tours rewritten with the new anchors and copy reflecting auto-assignment + drag-to-calendar. `facility-staff-signup-sheet`: 7 steps. `stylist-signup-sheet`: 6 steps. `TUTORIAL_CATALOG` blurbs refreshed. `ONBOARDING_CHECKLIST.facility_staff` gains `facility-staff-signup-sheet` as item #2 (between Getting Started and Scheduling).

**Files**:
- Schema: `src/db/schema.ts` (`preferred_date` column)
- New: `src/lib/signup-sheet-assignment.ts`, `src/components/signup-sheet/pending-signup-badge.tsx`
- Modified: `src/app/api/signup-sheet/route.ts` (POST auto-assign + new GET params), `src/components/signup-sheet/signup-sheet-panel.tsx`, `src/components/signup-sheet/stylist-pending-entries.tsx`, `src/components/calendar/calendar-view.tsx`, `src/app/(protected)/dashboard/dashboard-client.tsx`, `src/components/layout/sidebar.tsx`, `src/components/layout/mobile-nav.tsx`, `src/lib/help/tours.ts`, `src/types/index.ts`

### Phase 12R — Onboarding Checklist Widget (SHIPPED 2026-05-11)

A fixed bottom-right `<OnboardingChecklist />` widget on `/dashboard` surfaces 3-4 role-specific first-run tours to guide new users without requiring them to navigate to `/help`.

**Config** — `ONBOARDING_CHECKLIST: Record<string, { tourId: string; label: string }[]>` exported from `src/lib/help/tours.ts` (after `TUTORIAL_CATALOG`). Roles: `stylist` (4 items), `facility_staff` (3), `admin` (4), `bookkeeper` (3). `super_admin` normalizes to `admin`; master admin and unlisted roles get no checklist (component returns null).

**Component** (`src/components/help/onboarding-checklist.tsx`) — client component. Props: `role: string`, `completedTours: string[]`, `isMaster: boolean`, `userId: string`. `z-[100]` (below tour overlays at `z-[200+]`). Width: `w-72`. Only mounted in `DashboardClient` (both mobile-stylist and desktop render paths), NOT in global layout.

**State & persistence**:
- `localCompleted: string[]` — initialized from `completedTours` prop; updated by `tour-completed` CustomEvent listener (same event Phase 12Q fires).
- `dismissed: boolean` — lazy `useState` init reads `localStorage.getItem('onboardingChecklistDismissed:{userId}')`. User-specific key ensures one user's dismissal doesn't affect another on a shared device.
- `collapsed: boolean` — lazy `useState` init reads `localStorage.getItem('onboardingChecklistCollapsed')`. Shared across users (collapse preference is aesthetic, not personal).
- `visible: boolean` — false on mount, set true via `setTimeout(..., 1000)` for a 1-second entrance delay.
- `allDoneMsg: boolean` — briefly true (1.5s) when `completedCount === totalCount`.

**Entrance animation**: `transform: translateY(120%) → translateY(0)` driven by `visible` state + `transition-transform duration-300`. `120%` ensures the shadow/border is also off-screen. Bottom position: `style={{ bottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}` per CLAUDE.md fixed-bottom rule — no Tailwind `bottom-N` on the same element.

**Auto-dismiss**: when `completedCount === totalCount` (driven by `completedCount` recomputed from `localCompleted`), `allDoneMsg` → true, then after 1500ms sets `localStorage.setItem('onboardingChecklistDismissed:{userId}', 'true')` and flips `dismissed` → true. The widget slides off via `translateY(120%)` (it's already rendered; the `dismissed` guard returns null on the next render). × button does the same immediately.

**Mount wiring**:
- `dashboard/page.tsx` extends profile query to `columns: { stylistId, hasSeenOnboardingTour, completedTours }`, adds `const isMaster = !!...SUPER_ADMIN_EMAIL && user.email === ...`, passes `completedTours`, `isMaster`, `userId` to `<DashboardClient />`.
- `DashboardClientProps` gains `completedTours?: string[]`, `isMaster?: boolean`, `userId?: string`.

**Files**:
- Modified: `src/lib/help/tours.ts` (`ONBOARDING_CHECKLIST` export)
- New: `src/components/help/onboarding-checklist.tsx`
- Modified: `src/app/(protected)/dashboard/page.tsx` (profile query + 3 new props)
- Modified: `src/app/(protected)/dashboard/dashboard-client.tsx` (3 new props + widget render)

### Phase 12Q — Tour Completion Tracking (SHIPPED 2026-05-11)

Completed tours are persisted on `profiles.completed_tours text[] NOT NULL DEFAULT '{}'`. The Help page shows a `✓ Done` badge on cards whose tour the user has finished.

**Schema**: `profiles.completed_tours text[] NOT NULL DEFAULT '{}'` — Drizzle column: `text('completed_tours').array().notNull().default(sql\`'{}'\`)`.

**API route** `POST /api/profile/complete-tour`:
- Auth-gated (Supabase `getUser()`), rate-limited under `completeTour` bucket (20/hr/user).
- Validates `tourId` against the exported `TOUR_DEFINITIONS` map — returns 400 for unknown IDs.
- Idempotent `array_append` via raw SQL: `UPDATE profiles SET completed_tours = array_append(completed_tours, $tourId), updated_at = now() WHERE id = $userId AND NOT ($tourId = ANY(completed_tours))`. Uses Drizzle `db.execute(sql\`...\`)` — the ORM's `.set()` has no native `array_append` helper. Uses the service-role key (all DB writes do); `auth.uid()` / SECURITY DEFINER RPCs are not used.

**Engine wiring** — terminal step branch in both `tours.ts::runStep` and `mobile-tour.ts::runMobileStep`:

```ts
setTourModeActive(false)
// Fire AFTER setTourModeActive(false) — Phase 12O interceptor blocks /api/* POSTs while active
window.dispatchEvent(new CustomEvent('tour-completed', { detail: { tourId: def.id } }))
fetch('/api/profile/complete-tour', { method: 'POST', ... }).catch(() => {})
return
```

The `tour-completed` CustomEvent gives the `/help` page an optimistic badge update without waiting for the server round-trip.

**Client-side state** (`help-client.tsx`):
- `HelpClientProps` gains `completedTours: string[]` (server-fetched on each `/help` page load via `db.query.profiles.findFirst({ columns: { completedTours: true } })`).
- `HelpInner` owns `localCompleted: string[]` initialized from the prop; a `useEffect` subscribes to `tour-completed` events and appends new IDs.
- `<TutorialCard completed={localCompleted.includes(t.tourId ?? '')} />` — `tourId ?? ''` is always false for Coming Soon cards (no false positives).

**Badge** (`tutorial-card.tsx`): `completed` prop → `<span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200"><CheckCircle2 size={12} /> Done</span>` rendered in the card header next to the `~N min` chip.

**Files**:
- Schema: `src/db/schema.ts` (profiles `completedTours` column)
- New route: `src/app/api/profile/complete-tour/route.ts`
- Rate-limit: `src/lib/rate-limit.ts` (`completeTour` bucket)
- Engine: `src/lib/help/tours.ts`, `src/lib/help/mobile-tour.ts` (terminal step completion dispatch)
- Server component: `src/app/(protected)/help/page.tsx` (query + pass `completedTours` prop)
- Client: `src/app/(protected)/help/help-client.tsx` (state + event listener + prop pass-through)
- UI: `src/components/help/tutorial-card.tsx` (`completed` prop + badge)

### Phase 13 — Performance Pass (SHIPPED 2026-05-03)

Root cause of app-wide serverless timeouts diagnosed and fixed. **Root cause**: `DATABASE_URL` was pointing at the transaction-mode pgBouncer pooler (port 6543); the session-mode pooler (port 5432) was correct for this setup. Switched `DATABASE_URL` → port 5432; removed `prepare: false` from `src/db/index.ts` (session mode supports prepared statements natively). `connect_timeout: 10`, `max: 1` unchanged.

**`layout.tsx` race fix**: `Promise.race` timeout branch changed from `reject(new Error(...))` to `resolve(null)`. A hanging DB query never rejects — it stalls the socket. `reject()` fires the timeout but the serverless function stays open because the original async work still holds the connection. `resolve(null)` guarantees the race always settles to a value, execution continues, and the function returns a response before Vercel's hard limit. `LAYOUT_TIMEOUT_MS = 8000`. Inner IIFE refactored into named `fetchLayoutData(userId)`.

**Master admin cold-cache rewrite**: `getCachedFacilityInfos` was running 4 queries per facility in a `Promise.all` loop. With `max:1` connection pool and N=30 facilities, that's 120 queries serialized through one socket = 2-4s cold-cache renders. Rewritten to 5 flat queries: 1 `facilities.findMany` + 4 `GROUP BY facility_id` aggregations (residents/stylists/bookings-this-month/admin-email) joined via `Map<facilityId, value>` lookups in JS. Two previously-uncached queries in master-admin/page.tsx wrapped: `master-admin-active-facilities-list` (5min, tag `facilities`) + `master-admin-franchise-list` (5min, tag `facilities`). All 4 cached functions wrapped in try/catch returning `[]` on error — previously any query failure propagated through `unstable_cache` and crashed the page render.

**Cross-facility summary cached**: `/api/billing/cross-facility-summary` 6-aggregate query wrapped in `unstable_cache(['cross-facility-summary'], { revalidate: 120, tags: ['billing'] })`.

**3 new partial indexes** (declared in `src/db/schema.ts`, present in DB):
- `bookings_facility_status_idx (facility_id, status) WHERE active = true`
- `qb_invoices_facility_open_status_idx (facility_id, status) WHERE status != 'paid'`
- `facility_users_facility_role_idx (facility_id, role)`

**Middleware short-circuit**: `src/middleware.ts` now returns `NextResponse.next()` before calling `supabase.auth.getUser()` for paths with their own auth or no auth: `/portal`, `/family`, `/invoice`, `/api/portal`, `/api/cron`, `/privacy`, `/terms`. Saves a Supabase network round-trip per request on these surfaces.

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
- `MobileDebugButton` (`src/components/layout/mobile-debug-button.tsx`): `md:hidden`, master-admin only (`isMaster` prop), positioned `left-4` at `bottom: calc(env(safe-area-inset-bottom)+88px)`. Receives `currentFacilityId: string` from `layout.tsx` (the facility currently driving the session, accounting for active debug impersonation). Facility dropdown initializes to `currentFacilityId` via `useState(currentFacilityId)`. BottomSheet with role picker + facility select → `window.location.href='/dashboard'`. In debug mode shows amber pill with inline change/exit.
- `DebugTab` (`src/app/(protected)/master-admin/debug-tab.tsx`): receives `currentFacilityId: string` from `master-admin/page.tsx` (reads `selected_facility_id` httpOnly cookie). Lazy `useState` initializer validates `currentFacilityId` against `eligible` (facilities with facilityCode) before defaulting — ineligible facilities stay blank.
- `InstallBanner` bottom raised to `96px` (from `80px`); banner now fully tappable (no separate "Show me how →" button — it overlapped the `+` FAB).

---

### Phase 12T — Stylist Check-In + Smart Day Rescheduling (SHIPPED 2026-05-12)

**Schema** — `stylist_checkins` table:
- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `stylist_id uuid NOT NULL REFERENCES stylists(id) ON DELETE CASCADE`
- `facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE`
- `date date NOT NULL`
- `checked_in_at timestamptz NOT NULL DEFAULT now()`
- `delay_minutes integer NOT NULL DEFAULT 0`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `UNIQUE(stylist_id, facility_id, date)` — idempotency key
- `CREATE INDEX stylist_checkins_stylist_date_idx ON stylist_checkins(stylist_id, date)`
- RLS enabled with `service_role_all` policy

Drizzle definition mirrors `logEntries` shape and lives in `src/db/schema.ts` between `signupSheetEntries` and the relations section. `stylistsRelations` gains a `checkins: many(stylistCheckins)` reference; a dedicated `stylistCheckinsRelations` exists for the inverse.

**API — `POST /api/checkin`** (`src/app/api/checkin/route.ts`):
- `export const dynamic = 'force-dynamic'`
- Stylist role only (403 otherwise)
- Rate-limit bucket `checkin` (10/h/user)
- Body Zod: `{ facilityId: uuid, date: 'YYYY-MM-DD' }`
- Guards: `facilityId === facilityUser.facilityId`, `profile.stylistId` present, `stylistFacilityAssignments` row exists with `active=true`
- Inside `db.transaction()`:
  1. SELECT existing checkin for `(stylistId, facilityId, date)`. If present → return its `delayMinutes`/`checkedInAt`.
  2. Otherwise SELECT today's earliest non-cancelled booking (using `dayRangeInTimezone(date, facility.timezone)` for window)
  3. `delayMinutes = max(0, floor((now - firstBookingStart) / 60_000))`. Wall-clock UTC math.
  4. INSERT new row.
- Response: `{ data: { checkedIn: true, delayMinutes: number, firstAppointmentTime: string | null } }`

**API — `PUT /api/bookings/bulk-reschedule`** (`src/app/api/bookings/bulk-reschedule/route.ts`):
- `export const dynamic = 'force-dynamic'`
- Stylist role only
- Rate-limit bucket `bulkReschedule` (20/h/user)
- Body Zod: `{ bookingIds: uuid[] (min 1, max 50), shiftMinutes: int 1–480 }`
- Inside `db.transaction()`:
  - Fetch all candidate rows in one `findMany({ where: inArray(id, bookingIds) })`
  - Validate per row: ownership (`stylistId === profile.stylistId`), facility scope, `status ∉ {cancelled, completed}`, `bookingKey === todayKey` in facility tz
  - On any failure: throw `INVALID:<json>` (handled by outer catch → 422 with `invalid: [{id, reason}]`)
  - On all-valid: `UPDATE bookings SET start_time = start_time + shift, end_time = end_time + shift WHERE id = ?` for each
- After commit: `revalidateTag('bookings', {})`
- **No Google Calendar sync** — accepted tradeoff for first ship; can be wired in fire-and-forget later if real-world testing surfaces desync
- Response: `{ data: { updated: number } }`

**`dayRangeInTimezone(dateStr, timezone, dayShift?)`** — extracted from `src/lib/reconciliation.ts` to `src/lib/time.ts` as a public export. DST-safe two-step offset derivation. Returns `{ start: Date; end: Date } | null`.

**Dashboard wiring** (`src/app/(protected)/dashboard/page.tsx`):
- Pre-`Promise.all`: a single `db.query.facilities.findFirst` for timezone, then `getLocalParts(new Date(), tz)` → `todayDateStr`, then `dayRangeInTimezone(todayDateStr, tz)` → `todayRange`.
- Two new entries in the existing `Promise.all`, both gated on `profileStylistId !== null`:
  1. `db.query.stylistCheckins.findFirst({ where: and(stylistId, facilityId, date=todayDateStr) })`
  2. `db.query.bookings.findMany({ where: stylist-scoped + active + date-range + not cancelled, columns: minimal, with: { resident, service } columns whitelisted, orderBy: asc(startTime) })`
- Bookings are serialized to `{ id, startTime, endTime, status, residentName, serviceName }` before passing to client.
- New props passed to `<DashboardClient />`: `alreadyCheckedIn` (boolean), `checkinTodayBookings` (TodayBooking[]).

**`<DashboardClient />`** (`src/app/(protected)/dashboard/dashboard-client.tsx`):
- `DashboardClientProps` gains two optional props.
- **Naming caveat**: prop is `checkinTodayBookings` NOT `todayBookings` — the latter collides with an existing local `const todayBookings = bookings.filter(...)` at line ~462. The existing local `todayDateStr` useMemo is reused (no separate prop).
- `<CheckInBanner />` is mounted in BOTH render paths, immediately above `<StylistPendingEntries />`:
  1. Mobile stylist-list view (around line 506)
  2. Desktop calendar view (around line 836)

**`<CheckInBanner />`** (`src/components/checkin/checkin-banner.tsx`):
- Returns null for: non-stylist role, `alreadyCheckedIn`, empty today bookings, or now > last booking end.
- Burgundy `bg-[#8B2E4A]` rounded-2xl card with "📍 You have N appointment(s) today" + "First appointment at HH:MMam" + "I'm Here →" white button.
- Tour anchors: `data-tour="checkin-banner"` on root, `data-tour="checkin-button"` on button.
- On submit:
  - `delayMinutes <= 0` → toast "Welcome! Have a great day 🎉" + fade-out + unmount
  - `delayMinutes > 0` → opens `<RescheduleSheet />`
- After RescheduleSheet confirm OR dismiss → same fade-out flow (check-in is recorded either way).

**`<RescheduleSheet />`** (`src/components/checkin/reschedule-sheet.tsx`):
- `useIsMobile()` chooses `<BottomSheet>` vs `<Modal>` shell.
- Header: "You're N minutes late" in DM Serif Display (`font-normal`).
- Filters todayBookings to future-only (`startTime > now`) and non-cancelled.
- Each row: resident + service on left; original time `line-through text-stone-400` over new time `font-bold text-stone-900` on right.
- Edge case: if all bookings have already started → "All appointments are already in progress" + single "Got it" button.
- Footer (when actionable): ghost "Keep original times" + primary "Confirm new times" → POSTs to `/api/bookings/bulk-reschedule`.
- All time formatting via `formatTimeInTz` in facility timezone.

**Tour** (`src/lib/help/tours.ts`):
- New `stylist-checkin` entry in TUTORIAL_CATALOG (icon: `Clock`).
- `TutorialIcon` union extended with `'Clock'`. `tutorial-card.tsx` imports `Clock` from lucide-react and adds to `ICON_MAP`.
- Six-step tour anchored to `checkin-banner` + `checkin-button` with one `isAction: true` step on the button.
- `ONBOARDING_CHECKLIST.stylist` extended to 5 items — `stylist-checkin` inserted as #4 (between daily-log and my-account).

**Rate-limit buckets** (`src/lib/rate-limit.ts`) — added to `Bucket` union and `LIMITS` record:
- `checkin: { tokens: 10, window: '1 h' }`
- `bulkReschedule: { tokens: 20, window: '1 h' }`

---

### Phase 12U — Overscroll Lock + Native Touch Polish (SHIPPED 2026-05-12)

CSS-only pass in `src/app/globals.css`. Changes: `html, body { overscroll-behavior: none }` prevents iOS elastic rubber-band bounce on document root; `* { -webkit-tap-highlight-color: transparent }` eliminates the blue/grey tap flash on tappable elements; `button, [role="button"], a, label { user-select: none; -webkit-user-select: none }` prevents accidental text selection on interactive elements; `.main-content { -webkit-overflow-scrolling: touch }` enables momentum scroll on the main content container. No component, route, or schema changes.

---

### Phase 12V — CMD+K Command Palette (SHIPPED 2026-05-12)

Global desktop command palette for fast jump-to-resident, jump-to-stylist, and page navigation.

**API** — `GET /api/search?q=<2-100 chars>` (`src/app/api/search/route.ts`):
- Auth-gated; allowed roles: `admin`, `bookkeeper`, master admin (env-email match). Returns 403 for stylist/facility_staff.
- `q` validated via Zod (`z.string().min(2).max(100)`); 400 on fail.
- Rate-limit: new `search` bucket — `{ tokens: 60, window: '1 m' }`, keyed on `user.id` (new sub-minute window — possible because the `Bucket` window type already supports `s | m | h | d`).
- Residents: `SELECT id, name, room_number, facility_id, facilities.name FROM residents INNER JOIN facilities WHERE active = true AND name ILIKE %q% [AND facility_id = facilityUser.facilityId]` — master skips the facility predicate. `LIMIT 8`, ordered by name.
- Stylists (non-master): `selectDistinct` from `stylists` INNER JOIN `stylist_facility_assignments` (active, scoped to caller's facility) INNER JOIN `facilities` — match on `name ILIKE %q% OR stylist_code ILIKE %q%`. DISTINCT covers multi-facility stylists that would otherwise dupe.
- Stylists (master): no assignments join — `LEFT JOIN facilities ON stylists.facility_id` (home facility, nullable for franchise-pool stylists). Same OR-match.
- Response: `{ data: { residents: [...], stylists: [...] } }`.

**Static pages table** — `src/lib/command-palette-pages.ts` exports `PALETTE_ROUTES: PaletteRoute[]` covering 10 pages (Calendar, Residents, Daily Log, Stylists, Billing, Analytics, Payroll, Settings, Master Admin, Stylist Directory). Each route declares its `roles: string[]`; master-only entries (Master Admin, Stylist Directory) have `roles: []` and only pass the `isMaster || p.roles.includes(role)` filter when isMaster is true. Page icons reference lucide names; the component maps them to actual `LucideIcon` components via a local `PAGE_ICON_MAP`.

**Component** — `<CommandPalette role isMaster facilityId />` (`src/components/command-palette/command-palette.tsx`, client). Mounted in `(protected)/layout.tsx` inside `<ToastProvider>` (alongside the tour providers), gated at the mount site:
```tsx
{(activeRole === 'admin' || activeRole === 'bookkeeper' || isMaster) && (
  <CommandPalette role={activeRole} isMaster={isMaster} facilityId={activeFacilityId} />
)}
```
super_admin is normalized to `'admin'` at `getUserFacility()` read time, so it gets the palette automatically.

Behavior:
- CMD+K / CTRL+K toggles open/closed (also `Esc` closes).
- Listens for `'open-command-palette'` CustomEvent (fired by sidebar button) to open programmatically.
- Auto-focus input on open via `requestAnimationFrame`. Clears state on close.
- Debounced search: 150ms timer + AbortController cleanup. Fires only at `query.length >= 2`.
- Filtered pages computed client-side from the role-filtered `PALETTE_ROUTES` plus a `query.includes(...)` filter on label/description.
- Flat `allItems` list (pages → residents → stylists) drives keyboard navigation. `activeIndex` resets on every query change. `↑/↓` moves with auto-`scrollIntoView({ block: 'nearest' })`. `Enter` selects via `router.push(item.route)` (SPA nav, NOT `window.location.href`).
- Backdrop `bg-black/40 backdrop-blur-sm z-[290]`. Panel `top-[15%] left-1/2 -translate-x-1/2 z-[300] w-[560px] max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl border border-stone-200 overflow-hidden`.
- Active result row: `bg-[#F9EFF2]` (blush). Each row carries `data-result-index={globalIndex}` for scroll targeting.
- Master admin: resident/stylist rows show secondary `Room 3 · Sunrise Bethesda` (with facility chip). Non-master: just `Room 3` or stylist code alone (no facility chip — there's only one).

**Sidebar trigger** — `src/components/layout/sidebar.tsx`, top of the `<nav>` element (line ~388). Gated `role === 'admin' || role === 'bookkeeper'`. `hidden md:flex` — desktop only. Inline SVG search icon (sidebar uses SVG, not lucide). On click: `window.dispatchEvent(new CustomEvent('open-command-palette'))`. Tour anchor `data-tour="cmd-k-trigger"`.

**Tour** — `admin-command-palette` (4 steps, `desktopOnly: true`): step 1 highlights the `[data-tour="cmd-k-trigger"]` button; steps 2-4 are info popovers explaining typing, keyboard nav, and global access. Added to `TUTORIAL_CATALOG` with `category: 'Navigation'`, `icon: 'Search'`, `roles: ['admin', 'super_admin', 'bookkeeper']`. NOT added to `ONBOARDING_CHECKLIST` (discovery feature, not first-day mandatory).

**Icon plumbing**: `Search` added to `TutorialIcon` union (`src/lib/help/tours.ts`) and to `tutorial-card.tsx`'s `ICON_MAP` + lucide imports. Tour-check passed at 83 selectors (was 82).

**Non-goals** — no mobile trigger (Phase 12W Peek Drawer will cover mobile jump-to-resident); no recent/frequent items; no "create new resident" command-style actions; multi-facility stylist for master admin returns home `facilityId` only (clicking through to the stylist detail page shows full assignment info).

### Phase 12W — Resident/Stylist Peek Drawer (SHIPPED 2026-05-12)

A globally mounted slide-out drawer that loads a quick read-only profile for a resident or stylist without navigating away from the current page. Triggered by clicking a resident or stylist name from daily log, billing, calendar, or dashboard mobile views.

**API** — `GET /api/peek?type=resident|stylist&id=<uuid>` (`src/app/api/peek/route.ts`). Auth-gated; viewers return 403; all other roles return 404 when the target is missing or out of scope (master bypasses scope). Rate-limited `peek` bucket: 120/min/user. `dynamic = 'force-dynamic'`.

**Scope rules**:
- Master admin (env-email match) can peek any resident/stylist.
- All other roles are restricted to `facilityUser.facilityId`. Resident scope: simple `eq(residents.facilityId, callerFacilityId)`. Stylist scope: INNER JOIN `stylistFacilityAssignments` filtered to `(stylistId, callerFacilityId, active=true)` — handles franchise-pool stylists whose `stylists.facilityId` may be null.
- 404 (not 403) on scope mismatch — avoid leaking resident/stylist existence across facilities.

**Resident payload**:
```ts
{ data: { type: 'resident', facilityTimezone: string,
  resident: {
    id, name, roomNumber, facilityName,
    poaName, poaPhone, poaEmail,
    lastVisits: Array<{ startTime, serviceName, stylistName }>,  // up to 3, completed, active, newest first
    nextVisit: { startTime, serviceName, stylistName } | null,  // status=scheduled, active, startTime > now()
  }
} }
```
Service name resolves through `service?.name ?? rawServiceName ?? 'Unknown service'` (Phase 12B null-service guard). `residents` has no `facility` Drizzle relation (only `bookings`), so the route does a separate `facilities.findFirst` rather than adding a relation that isn't used elsewhere.

**Stylist payload**:
```ts
{ data: { type: 'stylist', facilityTimezone: string,
  stylist: {
    id, name, stylistCode, facilityName, status,
    availableDays: string[],          // ['Mon','Tue','Thu']
    todayCount: number,               // bookings today, !cancelled, active
    weekCount: number,                // Monday-start week, !cancelled, active
  }
} }
```
Today/week counts use two `db.execute(sql\`SELECT COUNT(*)::int AS n FROM bookings WHERE ...\`)` queries. Date ranges via `dayRangeInTimezone(date, tz, dayShift?)` from `src/lib/time.ts` (Phase 12T export, now public). Monday-start week computed by taking the localized weekday string from `getLocalParts` and shifting `(weekdayIdx + 6) % 7`. **Postgres-js driver returns iterable rows directly — no `.rows` wrapper**: `(result as unknown as Array<{ n: number | string }>)[0]?.n`.

**Always filter `eq(bookings.active, true)`** on both visit queries and count queries (non-negotiable per CLAUDE.md).

**Module-level state** (`src/lib/peek-drawer.ts`): mirrors `tour-router.ts`.
```ts
export type PeekTarget = { type: 'resident'; id: string } | { type: 'stylist'; id: string }
export function setPeekHandler(fn: (target: PeekTarget) => void): void
export function openPeek(target: PeekTarget): void
```
Any component anywhere in the tree calls `openPeek({...})` without prop drilling.

**Component** (`src/components/peek-drawer/peek-drawer.tsx`): mounted globally in `(protected)/layout.tsx` inside `<ToastProvider>` next to `<CommandPalette />`. Mounted for all roles. Props: `role`, `isMaster`. State: `target`, `data`, `loading`, `open`, plus a `clearTimerRef` for the 300ms cleanup delay after close. `useToast()` returns `{ toast }` — destructure: `const { toast } = useToast()`.

Renderer branches on `useIsMobile()`. Mobile: `<BottomSheet isOpen onClose>` (no `title` prop, avatar header renders inside scroll area). Desktop: always-mounted right-side drawer with inline `transform` toggle.

**`getInitials` extracted** from `src/components/ui/avatar.tsx` to `src/lib/get-initials.ts`. `<Avatar>` now imports from the new module — single source of truth. Peek drawer uses it directly for its 48px header circle (Avatar has no `xl` size and the burgundy/gray fills differ from Avatar's per-letter palette).

**Trigger sites** wired in Phase 12W:
- `src/app/(protected)/log/log-client.tsx` — resident name (with `data-tour="peek-resident-trigger"` — the tour engine's anchor) and stylist section header (with `e.stopPropagation()` because the parent row toggles collapsed state).
- `src/app/(protected)/billing/views/ip-view.tsx` — resident name in invoice/payment rows.
- `src/app/(protected)/dashboard/dashboard-client.tsx` — mobile stylist's "today's bookings" cards (guarded on `b.residentId` truthy).
- **Booking modal SKIPPED** — the selected-resident UI is the typeahead input value, not a separate read-only display. Adding a peek chip there is UX churn for a flow already covered by daily log / calendar / billing triggers.

**Tour** — `admin-peek-drawer` (4 steps, NOT desktopOnly): step 1 is an action step on `/log` targeting `[data-tour="peek-resident-trigger"]`; steps 2–4 are info popovers. `PanelRight` lucide icon added to `TutorialIcon` union (`tours.ts`) and `ICON_MAP` (`tutorial-card.tsx`). Tour-check passed at 84 selectors (was 83). NOT added to `ONBOARDING_CHECKLIST` — discovery feature.

### Phase 12X — Fluid Typography + Skeleton/Page-Enter Audit (SHIPPED 2026-05-12)

A small, focused polish pass: CSS-only typography scaling + filling the last gaps in the skeleton-loading audit + bringing four laggard page clients into compliance with the `page-enter` mount animation convention.

**Fluid typography** (`src/app/globals.css`):
- Global `h1 { font-size: clamp(1.625rem, 4vw, 2.25rem) }` — scales from 26px (320px viewport) → 36px (large monitors).
- `.dashboard-greeting { font-size: clamp(1.75rem, 5vw, 2.5rem) }` — applied to the homepage "Good morning, Lisa" heading, scales 28px → 40px. Heading carries both `dashboard-greeting` and the existing `text-2xl` Tailwind class; the custom rule wins on `font-size` via source-order cascade (globals.css is loaded after the Tailwind import). `text-2xl` retains its `line-height` side-effect.
- New rules placed alongside the Phase 12U tap-highlight block in globals.css.

**Skeleton audit:** Inventory in CLAUDE.md was 95% complete. Created the one genuinely missing file: `src/app/(protected)/stylists/directory/loading.tsx` — header + search bar + 8 row skeletons using `.skeleton rounded-2xl` per design-system rules. Verified all other claimed paths exist on disk. Confirmed Next.js's loading.tsx cascade handles drill-down billing routes via the parent. Confirmed `/residents/import`, `/services/import`, `/master-admin/import-*`, and `/onboarding` are client-side flows with no SSR data fetch — no skeleton needed.

**`page-enter` mount animation audit:** Four page clients missed during the design-system rollout. Added the existing `page-enter` class as the FIRST class in each outermost `<div>` (keeping all other classes intact, per the existing CLAUDE.md rule):
- `src/app/(protected)/master-admin/master-admin-client.tsx` line 408
- `src/app/(protected)/services/services-page-client.tsx` line 201
- `src/app/(protected)/analytics/reports-client.tsx` line 185
- `src/app/(protected)/residents/import/import-client.tsx` line 217

**Intentional skips:**
- `dashboard-client.tsx` — excluded by design per existing rule (the page has its own custom mount animation logic).
- `onboarding-client.tsx` — full-height centered wizard (`min-h-screen flex items-center justify-center`); the `translateY 6px → 0` entrance animation would fight the layout. Skipped.

**Net diff:** 1 new file, 5 file edits, 0 new APIs, 0 new dependencies, 0 schema changes.

### Phase 12Y — Mobile Layout Shell + Tour System Overhaul + Directory Scroll Fix (SHIPPED 2026-05-13)

Three related polish items landed together. CSS + layout architecture + tour system tweaks. No schema, no API.

**Shell architecture (`src/app/(protected)/layout.tsx` + `globals.css`):**
- Outer container: `<div className="h-[100dvh] flex overflow-hidden">` (was `flex h-screen`). `100dvh` corrects iOS Safari address-bar dynamics.
- Inner column: `<div className="flex-1 min-w-0 flex flex-col overflow-hidden">` containing `<MobileFacilityHeader>` / `<TopBar>` / `<main>` / `<MobileNav>` as flex siblings.
- `<MobileNav>` moved INTO the inner column as the last flex child (`shrink-0`). No longer `position: fixed`.
- `<main className="main-content flex-1 min-h-0 overflow-y-auto overscroll-contain">` is THE only vertical scroll container.

> **`.main-content` `transform: translateZ(0)` was REVERTED in the 12Y followups** — it made the element a containing block, so `position: fixed` chrome scrolled with content. See the followups section below for the corrected approach.

**Global modal/drawer overlays portal to `document.body`** via `createPortal` (`<CommandPalette>`, `<PeekDrawer>`, `<MobileTourOverlay>`). Kept from 12Y; harmless and correct.

**Outer-shell viewport-anchored chrome** (OUTSIDE `<main>`, sibling of the inner column): `<TourModeBanner>` (top), `<DebugBadge>` (top-right, desktop), and — after the followups — `<MobileDebugButton>` + `<InstallBanner>`.

**CSS variables in `:root` (`globals.css`):**
- DELETED: `--mobile-nav-height`, `--mobile-header-height`.
- ADDED: `--app-header-height: 56px`, `--app-nav-height: 72px`, `--app-safe-top`, `--app-safe-bottom`, plus (followups) `--app-nav-clearance` + `--app-floating-bottom` with `@media (min-width: 768px)` overrides.

**Body padding-top removed.** `body { padding-top: env(safe-area-inset-top) }` is gone. The `<MobileFacilityHeader>` handles safe-area-top internally via `paddingTop: 'var(--app-safe-top)'`. Eliminates the double-pad/overflow bug.

### Phase 12Y followups — Layout Shell Fixes + Tour Audit + Tour Speed (SHIPPED 2026-05-13)

Fixed 7 regressions surfaced by real-device testing of the 12Y shell.

1. **Bottom nav gap** — added `html, body { height: 100% }` so the `h-[100dvh]` shell fills the viewport (defends against ancestor collapse on iOS).
2. **Containing-block trick reversed** — `transform: translateZ(0)` REMOVED from `.main-content` (it made `position: fixed` chrome scroll with content). `.main-content` now carries only `-webkit-overflow-scrolling: touch`.
3. **Centralized nav-clearance vars** — `--app-nav-clearance: calc(var(--app-nav-height) + var(--app-safe-bottom))` (md: `0px`) and `--app-floating-bottom: calc(var(--app-nav-clearance) + 1rem)` (md: `1.5rem`). All 8 floating components switched from plain `bottom-4` to `style={{ bottom: 'var(--app-floating-bottom)' }}`; the daily-log mobile footer bar uses `var(--app-nav-clearance)`.
4. **`<MobileDebugButton>` + `<InstallBanner>` moved OUT of `<main>`** back to outer-shell siblings — viewport-anchored chrome.
5. **`<TourModeBanner>` fix** — `top: env(safe-area-inset-top)` → `top: 0` + `paddingTop: calc(0.375rem + env(safe-area-inset-top))`. Fixes both the notch cutoff (text sits below the safe area, bg fills under it) AND the "banner peeks ~19px when hidden" bug (`translateY(-100%)` now fully clears it because the box starts at `top: 0`). `viewportFit: 'cover'` confirmed present in the root `layout.tsx` viewport export.
6. **Directory scroll** — removed `transform: translateZ(0)` (leading cause + a failed prior fix) AND moved the `selectAllRef.current.indeterminate` write out of the `directory-client.tsx` render body into a `useEffect` (an imperative DOM write during render thrashes layout). Documented fallbacks if it persists: `page-enter`'s retained `transform: translateY(0)`, or the row hover transitions.
7. **Tour audit** — 11 catalog entries tagged `platform: 'desktop'` (admin-reports, admin-compliance, bookkeeper-getting-started, bookkeeper-billing-dashboard, bookkeeper-payroll, all 6 master-*). `bookkeeper-scan-logs` / `-manual-entry` / `-duplicates` stay `'both'` (target `/log` + `/residents`, mobile-reachable).
8. **Tour speed** — `SLOW_PAGE_WAIT_MS` 5000 → 3000 (`tours.ts` + `mobile-tour.ts`); `SCROLL_SETTLE_MS` 50 → 25 (`mobile-tour.ts`). `waitForElement` was already MutationObserver-based (instant resolve); these constants only bound the worst case.

**Verification:** `npx tsc --noEmit` 0 errors; `npx tsx scripts/check-tours.ts` 90/90 selectors, 0 platform-consistency warnings.

**Tour engine — silent skip on missing element:**
- `src/lib/help/tours.ts` `runStep` (line ~917 area) and `src/lib/help/mobile-tour.ts` `runMobileStep` (line ~147 area) no longer fire `toastWarning('Couldn\'t find that element …')`. They `console.warn(\`[tour] \${def.id}[\${index}] target not found: \${step.element} — skipping\`)` and recursively call the next step.
- `toastWarning` export remains in tours.ts (still used by `<TourResumer>` for legitimate user-facing errors via the `help-tour-toast` CustomEvent bridge). Import removed from mobile-tour.ts.

**`Tutorial.platform?: 'mobile' | 'desktop' | 'both'`** field added to the `Tutorial` type (line ~32). `TourDefinition.desktopOnly` REMOVED — the catalog filter is the single source of truth. Engine-level desktopOnly gating in `startTour` REMOVED.

**`help-client.tsx::visibleFor(role, isMaster, browseAll, isMobile)`** extended with a viewport filter. Tours tagged `platform: 'mobile'` hide on desktop; `'desktop'` hides on mobile; `'both'` (or undefined) always show.

**`PLATFORM_TOUR_ALIASES`** map in `tours.ts` (exported) resolves base tour ids to platform variants at `startTour()` call time:
```ts
'stylist-getting-started' → { mobile: 'stylist-getting-started-mobile', desktop: 'stylist-getting-started-desktop' }
'stylist-calendar' → { mobile: 'stylist-calendar-mobile', desktop: 'stylist-calendar-desktop' }
```
External consumers (`<HelpTip tourId="stylist-calendar">`, `ONBOARDING_CHECKLIST`, `?tour=stylist-calendar` query param) continue to work without per-call-site changes.

**`isTourCompleted(baseId, completedTours)`** helper exported from `tours.ts`. Checks if either the base id OR any of its platform variants appears in the user's `completed_tours` array. Used by `<OnboardingChecklist>` so completing a variant tour ticks off the base-id checklist row.

**Stylist tour splits:**
- `stylist-getting-started-mobile` targets `[data-tour="stylist-mobile-booking-list"]` for the calendar-overview step (rest of the tour uses shared sidebar nav anchors).
- `stylist-getting-started-desktop` targets `[data-tour="calendar-time-grid"]` for the same step.
- `stylist-calendar-mobile` (4 steps) covers the today's-bookings list view.
- `stylist-calendar-desktop` (5 steps) covers the FullCalendar grid + toolbar.
- All other stylist tours (`stylist-daily-log`, `stylist-checkin`, `stylist-residents`, `stylist-finalize-day`, `stylist-my-account`, `stylist-signup-sheet`) remain single tours with implicit `platform: 'both'`.

**`admin-command-palette`** catalog entry tagged `platform: 'desktop'` (CMD+K trigger is desktop-only).

**New `data-tour` anchors in `dashboard-client.tsx`:**
- `data-tour="stylist-mobile-booking-list"` on the booking-list wrapper inside the stylist mobile view.
- `data-tour="stylist-mobile-booking-card"` on the first card (or on the empty-state card when no bookings).

**`scripts/check-tours.ts`** extended:
- New `tutorialPlatform` map built by regex-matching `tourId: '...'` + `platform: '...'` pairs in TUTORIAL_CATALOG.
- New `detectContext(value)` helper that scans the source file containing the matching `data-tour="..."` attribute for `md:hidden` (mobile-only) or `hidden md:(flex|block|grid|inline)` (desktop-only) class patterns in ~600 chars before the attribute (same JSX element).
- Mismatch warnings emitted but the script does NOT fail on warnings — heuristic with possible false positives.

**Verification (Phase 12Y):**
- `npx tsc --noEmit`: 0 errors.
- `npx tsx scripts/check-tours.ts`: 90/90 selectors found, 0 platform-consistency warnings.

---

## Upcoming Phases

### Immediate (next up)

- **Phase 12Z** — Toast action buttons. Success toasts gain inline action buttons ("Booking saved — Undo | View").

### Medium Term

- **Phase 13A** — "What's New" changelog widget. Bell icon in header, per-user read state persisted on `profiles`, surfaces new features when phases ship.
- **Phase 13B** — Optimistic UI on key actions: mark pay period paid, finalize log day, add resident. Immediate UI feedback before server round-trip.
- **Phase 13C** — Skeleton loading audit. Every data surface uses shimmer skeletons — no blank white screens on any protected route.
- **Phase 13D** — Keyboard shortcuts system. Esc closes any open modal. N = new booking from anywhere. ? = shortcut help overlay listing all bindings.
- **Phase 13E** — Daily 8am summary email to Lisa via Resend + Vercel cron. Covers yesterday's bookings, outstanding balances, upcoming coverage gaps.

### Longer Term

- **Phase 13F** — Time-off approval + coverage finder. Admin approval flow for stylist time-off requests. Coverage finder uses ZIP radius matching to surface nearby substitute stylists.
- **Phase 13G** — Resident photo uploads. Optional resident headshot stored in Supabase Storage private bucket; shown in resident detail and booking modal.
- **Phase 13H** — Large-print accessibility mode for family portal. Toggleable via `/family/[code]/settings`; scales font sizes and touch targets for elderly users.
- **Phase 13I** — Offline mode / service worker caching. Pre-caches today's schedule for stylists working in facilities with unreliable WiFi.
- **Phase 13J** — Drag-to-reorder services and categories. Admin can reorder service list and category order via drag handle; persisted to `facilities.serviceCategoryOrder`.
- **Phase 13K** — Bulk actions on mobile. Long-press on a list row enters multi-select mode; floating action bar offers bulk operations.
- **Phase 13L** — Branded invoice/receipt templates. Custom HTML templates for PDF invoices and email receipts, gated on DNS verification for `noreply@seniorstylist.com`.
- **Phase 13M** — QB API live sync (after Intuit production approval). Automated invoice pull on a schedule; flip `QB_INVOICE_SYNC_ENABLED='true'` in Vercel to activate.
- **Phase 13N** — Franchise layer. Full DB schema for franchise management, super_admin UI overhaul, bookkeeper role scoped to franchise.
- **Phase 13O** — Per-stylist Google Calendar integration. Each stylist OAuth-connects their personal Google Calendar; bookings sync as events.
- **Phase 13P** — Facility merge tool. UI-driven consolidation of duplicate facility records, building on the existing `POST /api/super-admin/merge-facilities` engine.

### Coming Soon Tours (unlock when features ship)

- `bookkeeper-quickbooks` → after Phase 13M (Intuit production approval)
- `bookkeeper-financial-reports` → after analytics expansion
- `master-franchise` → after Phase 13N
- `master-merge-duplicates` → after Phase 13P
- Time-off approval tour → after Phase 13F
