# Josh's Setup Checklist (P29 — 2026-07-12)

Everything pending on YOUR side (dashboards/accounts Claude can't touch), ordered by impact.
Work top-down; A–D take ~30 minutes total and unlock the most. E–H are gated on external
accounts/approvals. Check items off as you go.

Note: all 8 cron jobs are ALREADY registered in vercel.json and deploy automatically — the old
"add cron to vercel.json" to-dos are done. What they're missing is the secret (item C1).

---

## A. Database — Supabase SQL Editor (~10 min, do first)

1. [ ] Open Supabase → SQL Editor → paste ALL of **`scripts/db-verify.sql`** → Run.
       It's read-only and prints OK / MISSING per migration, plus a second table that should
       be EMPTY (tables missing row-level security).
2. [ ] Paste the results back to Claude.
3. [ ] If anything says MISSING: paste ALL of **`scripts/db-catchup.sql`** → Run (idempotent —
       safe to run repeatedly, it only creates what's absent), then re-run db-verify.sql.

## B. Supabase Storage (~3 min)

1. [ ] Supabase → Storage → New bucket → name **`resident-photos`** → keep **Private** (public
       OFF) → Create. (Resident profile + style photos need it; uploads 500 until it exists.)
       The verify script's item 29 confirms it. No extra policy needed — the app uploads with
       the service-role key.

## C. Vercel environment variables (~15 min)

Vercel → Project → Settings → Environment Variables (Production). After adding, REDEPLOY.

1. [ ] **`CRON_SECRET`** — run locally: `openssl rand -hex 32` → paste as value.
       Without it EVERY scheduled job refuses to run: compliance-expiry alerts, daily digest,
       weekly owner digest, tomorrow-schedule reminders, autopay sweep, monthly facility
       reports, portal cleanup, demo cleanup. Highest-impact single item on this list.
       (Vercel automatically sends this secret as the Bearer token to the crons.)
2. [ ] **Web push (4 vars)** — run locally: `npx web-push generate-vapid-keys` →
       - `VAPID_PUBLIC_KEY` = the public key
       - `VAPID_PRIVATE_KEY` = the private key
       - `VAPID_SUBJECT` = `mailto:lisag@seniorstylist.com`
       - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` = same value as VAPID_PUBLIC_KEY
       Unlocks browser/PWA push (booking alerts, schedule reminders via the My Account toggle).
3. [ ] **`QB_TOKEN_SECRET`** — `openssl rand -hex 32` (encrypts stored QuickBooks OAuth tokens;
       required before any facility connects QuickBooks).

## D. Supabase Auth settings (~5 min)

1. [ ] Authentication → Providers/Settings → enable **"Link accounts with the same email"**
       (same-email identity linking). Root-cause prevention for the "invited stylist can't log
       back in" class of bug — Google + magic-link/OTP on one email collapse to one account.
2. [ ] Authentication → Email Templates → **Magic Link**: the template body must include the
       6-digit code token **`{{ .Token }}`** (keep the link too if you like). The native app's
       email-code login reads that code.
3. [ ] OPTIONAL (speed): Authentication → JWT Keys (or "Signing Keys") → if the project is on
       the legacy HS256 shared secret, migrate to **asymmetric signing keys** (ECC). The
       middleware then verifies logins locally with zero network calls per request (Phase 25
       fast path); on HS256 it falls back to a server check — works, just slower.

## E. Stripe — live card payments (when you're ready to flip payments on)

The whole card-on-file/autopay/Tap-to-Pay stack is built and works in TEST mode already.
1. [ ] Stripe dashboard (the PLATFORM Senior Stylist account) → API keys →
       - `STRIPE_SECRET_KEY` (sk_live_… when going live; sk_test_… works today)
       - `STRIPE_PUBLISHABLE_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (same value)
2. [ ] Developers → Webhooks → Add endpoint `https://portal.seniorstylist.com/api/webhooks/stripe`
       with events **`setup_intent.succeeded`** and **`payment_intent.succeeded`** (keep any
       existing `checkout.session.completed` selection) → copy the signing secret →
       `STRIPE_WEBHOOK_SECRET`.
3. [ ] LAST, when you want real charges: set **`PAYMENTS_LIVE_ENABLED`** = `true`. Until then
       the engine refuses live keys by design.

## F. Twilio — SMS (when ready)

1. [ ] Twilio account + a phone number →
       `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (e.g. `+12025551234`).
2. [ ] Set **`TWILIO_ENABLED`** = `true` (exact string). Turns on: receipt texts, family
       appointment-reminder texts (already wired into the nightly cron), payment-request texts.

## G. QuickBooks

1. [ ] Intuit Developer → create the production app → `QUICKBOOKS_CLIENT_ID`,
       `QUICKBOOKS_CLIENT_SECRET` in Vercel. (Payroll Bill push + vendor sync work after each
       facility connects via Settings → Integrations → Connect QuickBooks.)
2. [ ] After Intuit grants PRODUCTION approval for the app: set
       **`QB_INVOICE_SYNC_ENABLED`** = `true` to unlock live invoice pulls ("Sync from QB").

## H. Native app — one Mac sitting

1. [ ] On the Mac: `git pull && npm install && npm run cap:sync` → open Xcode / Android Studio
       → build. This picks up EVERYTHING since the first build: camera/photo permissions, the
       new offline cold-start screen (`native-offline.html`), app-lock, share-sheet exports.
2. [ ] Rebuild + resubmit both stores (listing copy, privacy answers, and review notes are
       ready in `docs/store-listing.md`).
3. [ ] **Firebase push** (native notifications): create a Firebase project → add Android app
       (download `google-services.json` → `android/app/`) + iOS app (download
       `GoogleService-Info.plist` → add in Xcode) → upload your APNs key in Firebase Cloud
       Messaging settings → enable Push Notifications + Background Modes(Remote notifications)
       capabilities in Xcode → in Firebase project settings download a service-account JSON,
       base64 it (`base64 -i service-account.json`) → Vercel env
       **`FIREBASE_SERVICE_ACCOUNT_BASE64`**. Full steps: `docs/native-app.md`.
4. [ ] **Apply for Apple's Tap to Pay entitlement NOW** (developer.apple.com → Tap to Pay on
       iPhone entitlement request) — approval takes weeks; the feature stays dormant until you
       also set `NEXT_PUBLIC_TAP_TO_PAY_ENABLED=true` + `STRIPE_TERMINAL_LOCATION_ID`.

## I. Optional / business

1. [ ] **Upstash Redis** (rate limiting): create a free Upstash Redis DB →
       `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` in Vercel. All rate limits are
       silent no-ops until then.
2. [ ] Onboard **Symphony Manor** + **Sunrise of Bethesda**: create facilities, invite the real
       stylists (Sierra, Mariah Owens, Senait Edwards), upload compliance docs, set weekly
       availability, connect QuickBooks per facility.

---

When an item is done, tell Claude which one — each unlocked feature gets verified together.
