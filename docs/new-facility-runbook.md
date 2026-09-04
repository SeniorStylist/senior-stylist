# New-Facility Onboarding Runbook (P53, 2026-08-13; P54 Fitzgerald additions 2026-08-16; P55 identity/charging 2026-08-17)

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
| `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_FROM_NUMBER` + `TWILIO_ENABLED=true` | Flipping Twilio on activates SEVEN dormant features at once: receipt texts, day-before family reminders (nightly cron, up to 100/night), payment-request links, signup welcome, booking confirmations, card-saved security texts, and the "Text me a code" sign-in tab. The first three vars are safe to stage early (code no-ops without the flag); flip `TWILIO_ENABLED` only after the A2P campaign is APPROVED (early = carrier-filtered, error 30034), in the morning so you can test before the reminder cron fires. Full sequence: josh-checklist §F1. |

**Never set a facility-level Stripe key** in Settings → Billing — portal
payments ignore it since P53 (it used to silently break payment recording).

## 2. Migrations (Supabase SQL Editor or psql) — one-time

Apply in order: `drizzle/0032`, `0033`, `0034`, `0035`, **`0036`** (new in P53:
credit-idempotency column/index + the portal_token backfill that turns on POA
booking-confirmation emails for claim-created residents), then the P54 trio
**`0037`** (signup auto-create merge suggestion), **`0038`** (signup card
tokens — the wizard's payment step), **`0039`** (multi-service sign-up
entries), then the P55 trio **`0040`** (frees real sign-up requests that were
stranded on the tutorial's "Demo Sarah" — data heal, migration-only),
**`0041`** (email-or-phone accounts: nullable email, phone-digits unique
index, held signup passwords), **`0042`** (SMS login codes), then the P60 pair
**`0047`** (a unique index on ACTIVE facility codes — **run the pre-check query
printed at the top of that file first**; if it returns a row, two active
facilities share a code and must be merged from Master Admin → Merge before the
index will apply) and **`0048`** (`invites.stylist_id`, so a stylist invite
links to the right record instead of guessing by name). All idempotent.
The app self-bootstraps the columns/tables if you forget, but NOT the
backfills/heals (0034, 0036, 0040 must be run).
No psql handy? Master Admin → Facilities → "Turn on everywhere" covers 0035's
signup flip from the UI; the others still need SQL.

## 3. Per new facility — the guided setup (P60)

Steps 1–4 below used to be four separate screens. Since P60 they are ONE flow:
**Master Admin → + Create Facility** (or Settings → Advanced → New facility,
or the sidebar's "+ Add facility" — they all open `/facilities/new`). The old
inline forms and `/onboarding` are gone.

The wizard walks: **Facility** (name; the F-code is suggested and editable, and
one is minted automatically if you leave it) → **Hours** (salon days and times)
→ **Stylists** (pick existing ones by name or ST-code, create new ones, or
upload the stylist sheet — each carries day chips that seed their weekly
availability) → **Services** (upload the community's price sheet; the scanner
reads it) → **Billing** (who pays, revenue share, and the autopay rule from 3b)
→ **Done** (a readiness checklist, **Print QR poster**, and **Enter facility**).

The facility is created when you leave the Hours step; everything after that
can be skipped and finished later from Settings. Facility admins still cannot
create services, stylists, or availability (P51 lockdown), so the master or a
bookkeeper runs this before handing over logins.

**Onboarding many communities at once?** Master Admin → Imports → **Facility
Sheet Import** takes the spreadsheet export. Communities whose F-code the app
doesn't know are CREATED (family sign-up on, code minted if the sheet has none);
known ones get billing type, revenue share, phone and address refreshed. A
header row is read in any column order.

What the wizard does NOT cover, in order:

1. **Link each stylist's login** in Settings → Team. The wizard attaches
   stylist RECORDS to the facility; connecting a person's login to their record
   is still a Team-screen step, and an unlinked stylist sees an amber banner
   asking an admin to do it.
2. **Check the weekly availability** the wizard seeded. It gives every stylist
   you added the salon's own days; adjust anyone who works a different pattern.
   Availability drives request auto-assignment AND slot matching (P53 fixed the
   timezone bug that made afternoons look unavailable). Empty availability means
   requests land unassigned and every stylist sees them — since P60 that is also
   what happens at a multi-stylist facility, instead of the request being parked
   on one arbitrary person.
3. Invite the facility admin + front desk. Their scheduling now works ONLY
   through the Sign-Up Sheet (owner decision 2026-08-13): they log requests,
   the stylist picks the time. They keep calendar view, cancel, and non-time
   edits.
4. Print the QR posters. The wizard's Done screen has **Print QR poster**;
   Settings → Family Portal and Signage → Family Sign-Up have the same one.
   Since P60 every poster builds its URL from `NEXT_PUBLIC_APP_URL`, so a poster
   printed from a preview deploy no longer encodes a domain families can't
   reach. Self-signup is ON by default since P52. The poster title is
   "Create an Account" (owner decision).
5. **QuickBooks**: the company is connected ONCE (Master Admin → QuickBooks).
   A new facility just needs attaching — Master Admin → QuickBooks → **Attach
   to QuickBooks** on its card (or "Attach the other N"); a franchise owner can
   do the same from the Franchise page. Then in the facility's Settings →
   Billing & Payments → QuickBooks: pick the **Expense Account** (required
   before payroll can push) → **Test connection** (must show "✓ Connected to
   {company}") → **Sync Customers** (links residents to QB customers under the
   F-code parent, creates missing sub-customers). After that: payroll pushes as
   Bills, Send via QB creates invoices, card payments collected on the site are
   recorded in QuickBooks automatically against the same invoices, and — with
   `QB_INVOICE_SYNC_ENABLED` on — invoices/payments pull nightly (one pull per
   company, routed to every attached facility).

## 3b. Fitzgerald of Palisades — charge-after-each-service (P54)

The Fitzgerald model is card-on-file at signup + automatic charge when each
visit completes. Everything ships enabled EXCEPT one per-facility switch:

1. **Settings → Billing → Automatic payment → mode = "When a visit completes"**
   (`autopay_mode = on_completion`). This is THE flip that makes
   charge-after-each-service real — the platform default stays "manual" so
   other facilities are never surprise-charged.
2. Everything upstream is automatic once Stripe live keys are set (section 1):
   the signup wizard ends with "Continue to Payment" → the family saves a card
   → per-visit autopay turns on for that resident (consent email included).
   The wizard silently skips the payment step when Stripe isn't configured —
   by design, so signup never dead-ends on a config gap.
3. Unsure signups now AUTO-CREATE the resident (no pending queue): watch
   Settings → Family Portal → "New Family Accounts to Review" during launch
   week and keep-or-merge each card. Merging moves portal access + billing
   history; if the toast warns the card couldn't move, ask that family to
   re-add it from the portal's Billing page.
4. Walk-ins: tell stylists to collect the family's EMAIL in the walk-in form —
   it auto-sends the "finish setting up your account" link, which is how
   chair-side residents enter the funnel without a QR scan.
5. **P55 — charging now also fires at day close**: with mode =
   "When a visit completes", the stylist tapping **Finalize day** charges the
   saved cards of autopay residents for that day's unpaid completed visits
   (each visit stamped paid — re-finalizing never double-charges). Scanned
   paper sheets get a "Charge cards" review screen after import — nothing is
   charged until a human confirms the names. Autopay stays opt-in per
   resident (owner decision).
6. **Gift links**: every resident's page has "Copy gift link" — hand it to any
   relative and they can send salon credit without seeing the account. The
   family's Billing page has "Share a gift link" too; gifts appear in their
   new "Payment history" section.

**Held for the next owners' meeting** (deliberately NOT built): cash policy,
facility logo upload on the wizard, specialty-based stylist routing,
on_completion as the new-facility default, Spanish emails.

## 4. Verify with the dry run (no cleanup needed)

**Walking the whole thing with the owners?** `docs/fitzgerald-walkthrough.md` is
the click-through script — nine scenarios from creating the facility to the
family seeing their receipt, each saying what to tap and what you should see.
Master Admin → Debug → **Launch rehearsal** prepares a practice facility for it
and opens scenario 2.

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

## Repairs

**A stylist exists but appears nowhere** (the Tatyana ST833 case). Before P60 a
stylist created from the Master Admin screen could be saved with no facility at
all, so no roster, dropdown or count ever showed them. The cause is fixed; an
already-broken record is repaired either way:

- *From the app (preferred):* open Stylists at the right facility and add them
  again by their code. The app answers that the code is already in use, which
  confirms the record exists — then attach them with the same screen's
  pick-existing search. The New-Facility wizard's Stylists step does the same.
- *From SQL:* set the home facility and insert the assignment row the roster
  surfaces actually read.

```sql
-- replace both placeholders with the real facility id
UPDATE stylists SET facility_id = '<F240-facility-id>' WHERE stylist_code = 'ST833';
INSERT INTO stylist_facility_assignments (stylist_id, facility_id, active)
SELECT id, '<F240-facility-id>', true FROM stylists WHERE stylist_code = 'ST833'
ON CONFLICT DO NOTHING;
```

**Duplicate stylist records** (one person, several ST-codes from separate
imports) still merge by hand: rename the survivor on `/stylists/[id]`, move any
assignments, deactivate the rest. There is no automatic stylist merge.
