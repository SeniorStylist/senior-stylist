# Josh's Setup Checklist (P29 — 2026-07-12)

Everything pending on YOUR side (dashboards/accounts Claude can't touch), ordered by impact.
Work top-down; A–D take ~30 minutes total and unlock the most. E–H are gated on external
accounts/approvals. Check items off as you go.

Note: all 8 cron jobs are ALREADY registered in vercel.json and deploy automatically — the old
"add cron to vercel.json" to-dos are done. What they're missing is the secret (item C1).

## Status (updated 2026-07-12 walkthrough)

| Section | Status |
|---|---|
| A. Database (verify + catch-up) | ✅ **DONE** — 29/29 checks OK after applying the 0020 column + 0027 index |
| B. Storage bucket (`resident-photos`) | ✅ **DONE** — private bucket created |
| C. Vercel env vars | ✅ **DONE** — CRON_SECRET, QB_TOKEN_SECRET, Upstash already set; VAPID ×4 completed + redeployed |
| — Web push | ✅ **LIVE & TESTED** (confirmed on the iOS add-to-home-screen PWA) |
| D. Supabase Auth | ✅ **DONE** — Magic Link template verified 2026-08-17 (`{{ .Token }}` + `{{ .ConfirmationURL }}`); same-email linking needs no toggle (see D) |
| E. Stripe live payments | ⏸ **PARKED** — test keys work today; live-mode blocked on boss's live account (steps below) |
| F. SMS (Twilio) | ⏸ **PARKED** — needs `TWILIO_FROM_NUMBER` + 10DLC reg (~$10–35/mo). Set `TWILIO_ENABLED=false` meanwhile |
| G. QuickBooks | Creds set; `QB_INVOICE_SYNC_ENABLED` flips true after Intuit prod approval |
| H. Native apps | 🔄 **IN PROGRESS** — first-ever submission; org accounts + D-U-N-S underway |
| I. Optional | Upstash ✅ done; facility onboarding pending |

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

1. [x] ~~Same-email identity linking~~ — **nothing to toggle** (corrected 2026-08-17: the
       earlier instruction pointed at a setting that doesn't exist). Supabase links identities
       sharing a VERIFIED email automatically by default. The dashboard's "Allow manual
       linking" switch is a DIFFERENT feature (the `linkIdentity()` client API, which the app
       never calls) — leave it **OFF**. The real duplicate-login safety net is code-side:
       `healMembershipOnLogin` runs on every sign-in (auth/callback).
2. [x] Authentication → Email Templates → **Magic Link**: the template body must include the
       6-digit code token **`{{ .Token }}`** (keep the link too if you like). The native app's
       email-code login reads that code. ✅ Verified 2026-08-17 — code first, `ConfirmationURL`
       link second (correct order: the typed code survives cross-device opens and Safe-Links
       prefetch; the link is the desktop convenience).
3. [ ] OPTIONAL (speed): Authentication → JWT Keys (or "Signing Keys") → if the project is on
       the legacy HS256 shared secret, migrate to **asymmetric signing keys** (ECC). The
       middleware then verifies logins locally with zero network calls per request (Phase 25
       fast path); on HS256 it falls back to a server check — works, just slower.

## E. Stripe — live card payments (when you're ready to flip payments on)

The whole card-on-file/autopay/Tap-to-Pay stack is built and works in TEST mode already.
**LIVE ACCOUNT ACTIVATED 2026-09-01** (Stripe onboarding completed; Tax/Radar/Climate
extras skipped — optional add-ons, revisit only if ever needed).
1. [ ] Stripe dashboard (the PLATFORM Senior Stylist account, LIVE mode) → API keys →
       grab `sk_live_…` and `pk_live_…` and HOLD them (don't put in Vercel yet — see the
       one-redeploy rule below):
       - `STRIPE_SECRET_KEY` (sk_live_…)
       - `STRIPE_PUBLISHABLE_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (same pk_live_ value)
2. [ ] Developers → Webhooks → Add a **live-mode** endpoint
       `https://portal.seniorstylist.com/api/webhooks/stripe` with **ALL THREE** events —
       **`setup_intent.succeeded`**, **`payment_intent.succeeded`**, AND
       **`checkout.session.completed`** (that third one records EVERY family portal payment —
       balance, prepay, gift; a fresh live endpoint has no pre-existing selection, so missing
       it = families charged with nothing recorded). Copy the **live** signing secret and hold
       it with the keys → it becomes `STRIPE_WEBHOOK_SECRET`. Safe to create the endpoint
       today; do NOT swap the secret into Vercel early (it would 400 the current test events).
3. [ ] **ONE-REDEPLOY RULE**: swap ALL FIVE vars in a single Vercel update + one redeploy —
       the 4 keys/secrets above **plus `PAYMENTS_LIVE_ENABLED` = `true`**. The in-between
       state (live keys, flag off) is NOISY, not safe-idle: autopay attempts fail loudly
       (admin "auto-charge failed" alerts + pay-link emails to families whose checkout then
       503s), the portal keeps showing Pay/Add-card buttons that error on click, and refunds
       go live ungated. Also verify `NEXT_PUBLIC_APP_URL=https://portal.seniorstylist.com`
       is set (two checkout routes otherwise build vercel.app return URLs).
4. [ ] **GATE — decide the refund/cancellation policy BEFORE the flip** with the
       boss — card networks expect one displayed where cards are charged (the portal). Once
       decided, add a short section to `/terms`. This is an OWNER decision — don't let anyone
       (including Claude) invent the terms. Stripe's live-account website review is covered by
       the WordPress session list (`docs/a2p-wordpress-kit.md` Part 3) + the portal's existing
       privacy/terms pages.
5. [ ] After the flip: one small real charge (portal balance or at-chair) → confirm the
       `qb_payments` row + Stripe dashboard both show it → refund via the in-app Refund
       button (note: refunds don't auto-reverse invoice applications — pick a resident with
       no open invoices for the test, or fix the invoice by hand after).

**STATUS (2026-09-01):** live account is ACTIVE. Vercel still holds **TEST** keys (card-on-file
works with `4242 4242 4242 4242`). Remaining before real charges: items 1–2 (grab keys, create
the live webhook — safe today), item 4 (refund policy — the gate), then item 3's single
redeploy and item 5's test charge. Test/live signing secrets differ — a mismatch fails
silently (the webhook route returns 200 even on handler errors; watch Vercel logs for
`[stripe webhook …]` lines, not the Stripe delivery dashboard).

### E2. Apple Pay on the web (P36 — 2 minutes, do with the Stripe account)
1. [x] **DONE 2026-09-01 on the LIVE account** — Settings → Payments → Payment method
       domains shows `portal.seniorstylist.com` Enabled + Apple Pay enabled
       (auto-verified, no association file needed). Google Pay needs no setup.
       Until this was done the at-chair payment screen showed card-entry only (with
       the phone camera scan); after it, Apple Pay appears automatically.

## F. Twilio — SMS (when ready)

### F1. Go-live sequence (2026-08-25 — NEW console "Find your number" wizard; ~$19.50 one-time, ~$2.65/mo + ~$0.008/segment)

1. [x] **Upgrade the account** if it's still a trial (add a payment method) — trials can't
       complete paid A2P registration and only text verified numbers. ✅ 2026-08-25
2. [x] **Compliance profile** — done 2026-08-25 (incl. driver's-license identity check for
       the authorized rep). Legal-name rule for any future edits: EXACTLY the EIN CP-575
       name, **"Senior Stylist LLC"**.
3. [x] **Number bought 2026-08-25: `+19174733973`** ((917) 473-3973, NYC zone) — this is the
       `TWILIO_FROM_NUMBER` value. NOTE: 917 works identically everywhere, but families see a
       New York number for a Baltimore company; swapping to a 443/410 local number is a
       2-minute release-and-rebuy BEFORE campaign registration, and an extra re-linking step
       after. Josh's call.
4. [x] **Brand** — REGISTERED (Low Volume Standard, $4.50; confirmed when the campaign
       step unblocked ~2026-09-01). Legal name "Senior Stylist LLC" + EIN.
5. [x] **Campaign SUBMITTED 2026-09-01 — vetting pending** (~5 business days). Use case
       **Low Volume Mixed** ($15 one-time vetting + $1.50/mo). Watch for the approval email /
       campaign status flipping to VERIFIED in Messaging → Regulatory Compliance.
       GOTCHA (hit 2026-08-25): the wizard lets you into the campaign step while the brand
       is still PENDING vetting and throws a generic "Error Setting Up A2P Campaign
       Registration" — nothing is lost. Wait for the brand to show REGISTERED (minutes to a
       few hours), then resume from Phone Numbers → Active numbers → the 917 number →
       finish setup. If the brand shows FAILED instead, the reason is usually a legal-name/
       EIN mismatch — fix and resubmit.
       Description, opt-in/message-flow text, and 5 sample messages: use the paste blocks in
       `docs/a2p-wordpress-kit.md` Part 5 (samples come from the REAL `src/lib/sms.ts`
       templates; links only to our own portal domain — no shorteners). Opt-in proof =
       signup contact-step screenshot per the kit. Vetting ≈ up to 5 business days.
6. [ ] **Messaging Service**: purchased number in the campaign's sender pool; Advanced
       Opt-Out ON; HELP response mentions 443-450-3344 (matches privacy policy §4).
7. [ ] **Vercel env vars (Production) — stage 3 NOW, flip 1 on approval.** Safe today
       (code no-ops until the flag): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
       `TWILIO_FROM_NUMBER` = `+19174733973`. ONLY after the campaign is APPROVED and the
       number attached (early = messages filtered, error 30034): **`TWILIO_ENABLED`** =
       `true` (exact string) → redeploy. Turns on SEVEN pre-wired dormant features at once:
       receipt texts, day-before family reminders (nightly cron — fans out to every
       opted-in family with a next-day appointment, up to 100/night), payment-request
       links, signup welcome, booking confirmations, card-saved notices, family SMS-code
       login ("Text me a code" tab appears automatically). **Flip in the MORNING** so you
       can test before that night's reminder cron fires.
8. [ ] **Test** with your own phone as a REAL (non-demo) resident's POA phone at a test
       facility. PRE-FLIGHT before flipping: check no demo resident carries a real-looking
       `poa_phone` (the manual receipt send, webhook receipt, and card-saved notice have no
       is_demo guard — they're only safe because demo phones are fake seed data). First
       test = manual **Send Receipt** (synchronous, returns `smsSent: true/false` on the
       spot). Then: phone-only signup, reply STOP (should stop + confirm), then START to
       re-subscribe, and try the login page's "Text me a code" tab.
9. [ ] Note: this is entirely separate from the ZOOM Phone 10DLC registration for manual
       staff texts — both proceed independently; neither covers the other's numbers.

### F2. A2P 10DLC campaigns — Twilio (app) + Zoom (manual staff texts) (2026-08-19)

TWO independent registrations, both citing `https://portal.seniorstylist.com/privacy`.
Full form answers + paste copy in **`docs/a2p-wordpress-kit.md`**:

1. [ ] **Twilio campaign form**: website = `https://portal.seniorstylist.com`; privacy policy =
       `https://portal.seniorstylist.com/privacy`; opt-in method = **Website** with
       `https://portal.seniorstylist.com/family/<CODE>/signup` (any active facility's F-code);
       do NOT tick "I do not use web/written forms". Proof = screenshot of the signup wizard's
       contact step (consent line under the phone field).
2. [ ] **Zoom campaign form**: use case = operational staff messaging (schedules, log sheets,
       compliance — not marketing); privacy policy = the portal URL; consent = phone numbers
       provided during stylist onboarding (documented in `/privacy` §4 "Stylists and staff").
       Proof = screenshot of §4 (family + staff paragraphs) plus the sharing paragraph.
3. [ ] **WordPress — ONE editing session covers everything (2026-08-25 consolidation)**: the
       complete per-service list is **`docs/a2p-wordpress-kit.md` Part 3** — (a) phone typo
       fix on `/individual-services-request/`: (800) 979-7759 → **800.979.3759**
       (BOSS-FLAGGED PRE-ADVERTISING BLOCKER; confirm first by calling both — 800.979.3759
       reaches us, 7759 reaches a stranger; repo side verified consistent, 7759 appears
       nowhere in the app); (b) footer Quick Links "Privacy Policy" →
       `https://portal.seniorstylist.com/privacy` (REQUIRED for Zoom — brand registered
       against seniorstylist.com; helps Stripe underwriting); (c) request-form SMS disclosure
       below the submit button (Twilio — until submitters confirmed calls-only, Josh: "not
       sure"); (d) verify pass incl. site-wide "7759" search; (e) OPTIONAL WP privacy-page
       patch. Email text for whoever holds WordPress access: in the kit + chat (Gmail draft
       creation was blocked by connector approval — copy from chat). After Part 3,
       seniorstylist.com needs NOTHING further for Twilio, Zoom, or Stripe.
7. [ ] Merge/deploy the `claude/campaign-privacy-sms-compliance-35mru1` branch BEFORE
       submitting either campaign — reviewers check the LIVE pages.

Portal side is DONE as of 2026-08-19: `/privacy` covers families AND staff messaging with the
carrier-required language, the signup consent line is the full CTIA formula, and Privacy links
exist on `/login`, `/family`, and every family page footer.

## G. QuickBooks

1. [ ] Intuit Developer → create the production app → `QUICKBOOKS_CLIENT_ID`,
       `QUICKBOOKS_CLIENT_SECRET` in Vercel. (Payroll Bill push + vendor sync work after each
       facility connects via Settings → Integrations → Connect QuickBooks.)
1b. [ ] **Register the redirect URI** (P56 — this was Lisa's "connection problem" error):
       Intuit Developer Portal → the app → **Production** section → **Keys & OAuth** →
       Redirect URIs → add EXACTLY `https://portal.seniorstylist.com/api/quickbooks/callback`
       (https, no trailing slash, no www — Intuit matches character-for-character). The
       Development section needs its own entry for sandbox testing if used. Without this,
       every Connect attempt dies on Intuit's "redirect_uri query parameter value is
       invalid" page before the consent screen ever shows.
1c. [ ] (Optional) `QUICKBOOKS_REDIRECT_URI` in Vercel — only needed if the canonical URL
       ever differs from `NEXT_PUBLIC_APP_URL`. The app now always sends the canonical URI
       (`{NEXT_PUBLIC_APP_URL}/api/quickbooks/callback`, fallback portal.seniorstylist.com)
       regardless of which host the admin browsed from, so 1b's single registered entry is
       enough forever.
1d. [ ] After a facility connects: Settings → Billing & Payments → QuickBooks →
       **Test connection**. "✓ Connected to {company}" proves the production keys, the
       redirect URI, and the token exchange all work end to end. An amber "Connection
       broken" result means reconnect (the button links straight to it).
2. [ ] After Intuit grants PRODUCTION approval for the app: set
       **`QB_INVOICE_SYNC_ENABLED`** = `true`. This unlocks the whole live PULL side:
       "Sync from QB" invoice pulls, the payment/credit pull, and the nightly sync cron
       for every connected facility. (The WRITE side — payroll Bill push, vendor sync,
       customer sync, Send via QB invoice creation — works as soon as a facility
       connects, no flag needed.)
3. [ ] Apply the QB link-tables migration in prod:
       `psql "$DIRECT_URL" -f drizzle/0043_qb_links.sql` (self-bootstrapped by the app
       too, but apply it anyway so the first request doesn't pay the DDL cost).
4. [ ] Per connected facility, once: Settings → Billing & Payments → QuickBooks →
       **Sync Customers**. Links residents to their QuickBooks customers (numeric IDs)
       and creates missing sub-customers under the facility parent — after this,
       invoice/payment matching is exact instead of name-guessing.

## H. Native app — FIRST-EVER submission (org accounts, you build on your Mac)

**STATUS (2026-07-12):** decided on **Organization** developer accounts (company name on the
apps). This is a multi-day, multi-step process; go phase by phase.

**Phase 0 — prerequisites (start NOW; these gate everything):**
- [ ] **Supabase Magic Link template** must contain the code token, e.g. `Your code is {{ .Token }}`
      (Auth → Email Templates → Magic Link). Native login is a typed 6-digit code — broken without it.
- [ ] **Company D-U-N-S number** — Apple + Google org enrollment both require it. Check if the
      company already has one (D&B free lookup); if not, request free from Dun & Bradstreet
      (can take ~1–2 weeks). **Critical path — loop in the boss** (legal company name/address +
      authority to bind the company; likely boss-owned accounts).
- [ ] **Apple Developer Program (Organization)** — $99/yr, developer.apple.com/programs/enroll
      (~1–2 wks with org verification).
- [ ] **Google Play Console (Organization)** — $25 one-time; also needs org/D-U-N-S verification.

**Phase 1 — Mac toolchain (do in PARALLEL now, no waiting on accounts):**
- [ ] Install **Xcode** (Mac App Store, ~7 GB — start early), **Node LTS**, **CocoaPods**,
      **Android Studio**. Then `git clone` + `npm install`. (Claude will give exact commands.)

**Phase 2 — build + submit (once accounts clear; Android first per docs/native-app.md):**

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

## J. P50 — new-facility onboarding funnel (2026-08-03)

Ops to make the QR-to-chair funnel live for a NEW facility:

1. [ ] **Apply migrations 0032–0035 BEFORE deploy** (Supabase SQL Editor or psql):
       `drizzle/0032_p50_claim_details.sql`, `drizzle/0033_p50_signup_source.sql`,
       `drizzle/0034_p50_portal_onboarded.sql`, `drizzle/0035_p52_signup_everywhere.sql`.
       All idempotent. 0034 matters most — its backfill marks every EXISTING portal
       account as "already onboarded" so long-time families never see the first-login
       setup wizard. (The app self-bootstraps the columns if you forget, but NOT the
       backfills.) **No psql handy? For 0035's part only**: Master Admin → Facilities →
       "Turn on everywhere" does the same signup flip from the UI.
2. [ ] **Per new facility**: give it a `facilityCode` (F###) and assign the stylist(s)
       with weekly availability rows — availability is what drives request
       auto-assignment into the right stylist's queue. **Self-signup is now ON by
       default (P52)** — no toggle needed; Settings → Family Portal is only for turning
       a facility OFF.
3. [ ] **Print the QR poster** from Settings → Family Portal. No reprint needed for
       facilities that already have posters — the QR URL didn't change; the page behind
       it became the senior-friendly wizard.
4. [ ] **Cards/autopay work on Stripe TEST keys today** — E's live-keys +
       `PAYMENTS_LIVE_ENABLED=true` flip is only needed for real money. Card **camera
       scan** works in the phone BROWSER (Safari/Chrome offer it inside the Stripe card
       field); inside the installed app people type the number instead. Card-PHOTO OCR
       (snapping a picture of a card) is permanently off the table — PCI.
5. [ ] **SMS reminders stay dormant** until F (Twilio) is done — the family's SMS
       checkbox is honored the moment it's live.
6. [ ] **One-time sweep**: the calendar now shows an amber "Requested" chip on old
       family requests that became invisible phantom bookings — open the calendar,
       spot the chips, and either schedule or cancel them. New requests go to the
       Sign-Up Sheet queue instead, so chips should stop appearing.

---

When an item is done, tell Claude which one — each unlocked feature gets verified together.
