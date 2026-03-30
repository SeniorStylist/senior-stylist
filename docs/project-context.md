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

### Phase 4 PLANNED
- Cross-facility reporting
- Multi-facility revenue dashboard QuickBooks-style
- Outstanding balance view across facilities
- Facility grouping for custom reports

### Phase 5 PLANNED
- Resident portal enhancements
- POA can book on behalf of resident
- CSV template export for bookkeepers
- Booking confirmations to resident and POA

---

## 6. CURRENT STATUS

### Working
- Full auth flow: invite → accept → correct facility + role
- Stylist role: correct nav, correct restrictions, log filtering
- Admin role: full access to their facility
- Master admin: /super-admin, franchise management, all facilities
- Email: invites, access requests, approvals all send via Resend
- POA fields on residents
- Mobile speed improvements: prefetch, skeletons, instant tab highlight
- Franchise CRUD in super admin page

### In Progress / Needs Testing
- OCR log sheet import — getting network error on PDF upload
  Root cause: likely Vercel body size limit or timeout
  Fix needed: maxDuration=60 on route, body size limit in next.config.ts,
  explicit GEMINI_API_KEY check
  Model confirmed: gemini-1.5-flash
  PDF support added via Gemini inlineData

### Not Started
- Symphony Manor and Sunrise Bethesda not yet created in app
- Real stylists Sierra, Mariah Owens, Senait Edwards not yet invited
- Phase 4 cross-facility reporting
- Phase 5 resident portal POA booking

---

## 7. IMMEDIATE NEXT FIX

OCR network error fix — paste into Claude Code:

Read docs/master-spec.md, CLAUDE.md first.
Use supabase MCP to verify schema before writing code.
Then /plan the following before writing any code:

Read src/app/api/log/ocr/route.ts and next.config.ts

Fix the OCR network error on PDF upload:
1. Add to route.ts: export const maxDuration = 60
2. Add to route.ts: export const dynamic = 'force-dynamic'
3. Add explicit GEMINI_API_KEY check at top of handler
4. In next.config.ts add: experimental: { serverActions: { bodySizeLimit: '10mb' } }
5. Add detailed console.error logging around the full handler

Run npx tsc --noEmit, commit and push.
Update CLAUDE.md and docs/project-context.md.

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

5. Never use gemini-2.0-flash — use gemini-1.5-flash only.

6. All emails fire-and-forget — never await sendEmail().

7. Prices always in cents in DB, never floats.

8. Never hard delete — always active=false.

9. All DB queries scoped to facilityId via getUserFacility().

10. Next.js 16 async params — always { params: Promise<{id: string}> }.

---

## 9. END OF SESSION CHECKLIST

At the end of every Claude Code session:
1. Update docs/master-spec.md with new routes and schema
2. Update docs/design-system.md with new UI patterns
3. Update CLAUDE.md with new rules and bugs fixed
4. Update docs/project-context.md — current status, phases, next fix
5. Re-upload all four files to Claude Projects
