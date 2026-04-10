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

---

## 6. CURRENT STATUS

### Working
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

User lifecycle overhaul complete (2026-04-10). cheflisa817@gmail.com invites reset — she needs to re-accept them. Next steps:
1. Have cheflisa817@gmail.com click her invite links to complete onboarding (invites reset with fresh 7-day expiry)
2. Check Supabase Auth settings: Email+OTP enabled, Site URL = https://senior-stylist.vercel.app, Redirect URLs include /auth/callback
3. Onboard Symphony Manor + Sunrise Bethesda — invite real stylists Sierra, Mariah Owens, Senait Edwards
4. Test PDF parser on Vercel with real Symphony Manor price sheet
5. Test OCR import with a real handwritten log sheet from Symphony Manor
6. Phase 5 resident portal POA booking (plan written at docs/portal-auth-plan.md)

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
