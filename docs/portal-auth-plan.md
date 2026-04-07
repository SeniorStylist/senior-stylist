# Resident & POA Portal Accounts — Implementation Plan

> Written 2026-04-07. This is a PLAN ONLY — not yet implemented.

---

## Problem

The resident portal (`/portal/[token]`) is currently anonymous — anyone with the
token can view bookings and book services. There's no way for a POA (Power of
Attorney) to create a persistent account, see booking history across sessions,
or manage bookings on behalf of their resident.

## Goals

1. POA can optionally create a Supabase account tied to their resident
2. Logged-in POA sees full past and upcoming booking history
3. The portal token still works for anyone — account creation is optional
4. The booking flow is completely unchanged for anonymous token users

## Proposed Architecture

### New DB table: `portal_accounts`

```sql
CREATE TABLE portal_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id UUID NOT NULL REFERENCES residents(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  relationship TEXT NOT NULL DEFAULT 'poa', -- 'poa' | 'family' | 'self'
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(resident_id, user_id)
);

ALTER TABLE portal_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON portal_accounts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

**Why a separate table instead of adding `poa_user_id` to residents:**
- A resident could have multiple POAs (spouse + child)
- A POA could manage multiple residents
- Keeps the residents table clean

### Auth Flow on `/portal/[token]`

1. Portal page loads as today (token lookup → resident data)
2. New UI section: "Create an account to manage bookings"
   - Only shown if no `portal_accounts` row exists for this resident + current session user
   - Uses `supabase.auth.signInWithOtp({ email })` (magic link, same as invite flow)
   - After auth: `POST /api/portal/[token]/link-account` creates `portal_accounts` row
3. If user is already logged in AND has a `portal_accounts` row for this resident:
   - Show extended booking history (all past bookings, not just last 10)
   - Show "My Account" link

### Token Auth + Session Auth Coexistence

The portal token remains the primary auth mechanism for the portal:
- `GET /api/portal/[token]` continues to work without any session
- If a Supabase session IS present, the API checks `portal_accounts` for extended data
- The session is never required — it only unlocks bonus features

### New API Routes

| Route | Auth | Purpose |
|-------|------|---------|
| `POST /api/portal/[token]/link-account` | Token + Supabase session | Create `portal_accounts` row |
| `GET /api/portal/[token]/history` | Token + Supabase session | Full booking history (all past) |

### Portal Client Changes

- Add optional "Sign in" / "Create account" section below booking list
- If signed in: show "Signed in as [email]" badge, extended history tab
- If not signed in: show prompt with benefits ("See full history, get reminders")
- The booking form, service selector, time picker — all unchanged

### POA Booking on Behalf

Once `portal_accounts` exists, a POA could:
1. Visit `/portal/[token]` while logged in
2. Book appointments as normal (the resident is already identified by the token)
3. Receive email confirmations at their own email address

This requires minimal changes — the booking API already creates bookings for
the resident identified by the token. The POA's email can be pulled from their
Supabase session for confirmation emails.

### Email Notifications to POA

With `portal_accounts`, we can send booking confirmations and reminders to:
- The POA's email (from their Supabase account)
- The resident's `poa_email` field (already exists)

This is additive — it doesn't change existing email behavior.

## What NOT to Change

- Token-based portal access must remain fully functional without login
- The booking API (`POST /api/portal/[token]/book`) stays token-authed
- Existing `poa_*` fields on residents are unrelated to portal accounts
- No changes to staff-side booking or scheduling

## Estimated Scope

- 1 new DB table + RLS
- 2 new API routes
- 1 modified client component (`portal-client.tsx`)
- 1 new section in portal UI

This is a Phase 5 feature and should be implemented after the invite/auth
flow is fully stable and tested in production.
