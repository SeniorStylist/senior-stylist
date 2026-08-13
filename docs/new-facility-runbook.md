# New-Facility Onboarding Runbook (P53, 2026-08-13)

The exact order to bring a new facility live on the QR-to-chair funnel. Written
for Josh; every item is either a one-time platform step or a per-facility step.

## 1. Platform env (Vercel) — one-time, BEFORE printing any posters

| Setting | Why it matters |
|---|---|
| `STRIPE_SECRET_KEY` + `STRIPE_PUBLISHABLE_KEY` + `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` = platform **LIVE** keys | Today's TEST keys make real family cards look "declined". All portal payments now run on the platform account only. |
| Stripe Dashboard → **live-mode** webhook → `https://portal.seniorstylist.com/api/webhooks/stripe` subscribed to `checkout.session.completed`, `payment_intent.succeeded`, `setup_intent.succeeded`; its **live** signing secret in `STRIPE_WEBHOOK_SECRET` | Test and live secrets differ — a mismatch means charged-but-never-recorded. |
| `PAYMENTS_LIVE_ENABLED=true` | With live keys + flag off, the app now BLOCKS card vaulting/checkout with a clear message (before P53 it silently vaulted cards whose autopay never charged). |
| `NEXT_PUBLIC_APP_URL=https://portal.seniorstylist.com` | Magic-link emails build from this. (P53 added a production fallback, but set it anyway.) |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | **Without these there is NO rate limiting at all** — the signup matcher becomes guessable without bound. Required before public posters go up. |
| `RESEND_API_KEY` + verified sender domain | Magic links, confirmations, claim notifications are all email. |

**Never set a facility-level Stripe key** in Settings → Billing — portal
payments ignore it since P53 (it used to silently break payment recording).

## 2. Migrations (Supabase SQL Editor or psql) — one-time

Apply in order: `drizzle/0032`, `0033`, `0034`, `0035`, **`0036`** (new in P53:
credit-idempotency column/index + the portal_token backfill that turns on POA
booking-confirmation emails for claim-created residents). All idempotent. The
app self-bootstraps the columns if you forget, but NOT the backfills.
No psql handy? Master Admin → Facilities → "Turn on everywhere" covers 0035's
signup flip from the UI; the others still need SQL.

## 3. Per new facility — setup ORDER matters (P51 lockdown)

Facility admins cannot create services, stylists, or availability — so the
master (or a bookkeeper) does 1–4 BEFORE handing over logins:

1. Create the facility with an F-code (`F###`) — signup QR needs the code.
2. Build the **services catalog** (price-list). Zero services = families cannot
   request anything (the portal shows "contact the office").
3. Add the **stylists** (codes kept) and link their logins in Settings → Team.
4. Enter each stylist's **weekly availability windows** — availability drives
   request auto-assignment AND slot matching (P53 fixed the timezone bug that
   made afternoons look unavailable; empty availability still means requests
   land unassigned and every stylist sees them).
5. Invite the facility admin + front desk. Their scheduling now works ONLY
   through the Sign-Up Sheet (owner decision 2026-08-13): they log requests,
   the stylist picks the time. They keep calendar view, cancel, and non-time
   edits.
6. Print the QR posters — Settings → Family Portal or Signage → Family Sign-Up
   — from the PRODUCTION domain (a poster printed from a preview deploy encodes
   a URL families can't reach). Self-signup is ON by default since P52.

## 4. Verify with the dry run (no cleanup needed)

Master Admin → Debug → **Family Sign-Up Wizard (dry run)**: runs the whole
wizard — resident matching, the "is this them?" card, submission, the real
confirmation screen — and creates NOTHING (no accounts, residents, or emails).
Use it on the real facility right after step 3 to sanity-check the roster
matching before families ever scan.

## 5. First live family (end-to-end smoke)

1. Scan the poster on a phone → wizard loads (lowercase QR URLs now work).
2. Type a roster resident + room → confirm card shows name, room, masked
   family contact → "Yes" + the real POA name → instant link → magic-link
   email → signed in (first login runs the card/autopay/rhythm welcome flow).
3. Family requests a service with a preferred date → front desk sees it on the
   Sign-Up Sheet (badge on mobile More too) → the stylist's queue "Schedule"
   opens on the preferred date with the family's notes → convert → the family
   gets the confirmation email and sees it (facility-local time) in the portal.
4. Family adds a card (live keys!) and pays/prepays — a prepay shows as
   "Salon credit available" on their billing page; facility A/R updates.

## 6. Open decisions parked for Josh

- `maskName` shows the POA's initials + word count on the confirm card —
  owner-accepted; revisit if it feels like too much.
- Salon credit is display-only on the pay button (no auto-clamp) — per the
  never-auto-apply doctrine.
- Admin mobile pinned tabs don't include Sign-Up Sheet by default (the badge
  lives on More); swapping a default tab out is your call.
- The first-login welcome wizard only prompts for the FIRST resident of a
  multi-resident family (cards addable per resident from Billing).
- `resolveAvailableStylists` reads assignment rows only (home-only stylists
  without an assignment row can't be auto-assigned) — data invariant holds
  today; flagging, not changing.
