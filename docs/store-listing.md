# Store Submission Package — Senior Stylist (iOS App Store + Google Play)

Everything needed to fill in both store consoles. Pair with the signing/submission runbook in
`docs/native-app.md`. App id: `com.seniorstylist.app`.

---

## 1. Listing copy (both stores)

**App name:** Senior Stylist
**Subtitle / short description (30 chars iOS · 80 chars Play):**
- iOS: `Salon care for senior living`
- Play: `Scheduling, daily logs & billing for salons in senior living communities`

**Full description:**

> Senior Stylist is the all-in-one workspace for salon teams serving senior living communities.
>
> **For stylists**
> • See your day and week at a glance, with an evening reminder of tomorrow's schedule
> • One-tap "I'm Here" check-in that automatically reshuffles a late start
> • Keep the daily service log as you work — no paper sheets
> • Request time off and get notified the moment it's approved and covered
>
> **For facility teams**
> • Book residents in seconds with smart stylist assignment
> • Scan paper log sheets with the camera — appointments, services, and payments are read automatically
> • Track billing, invoices, and payments per resident and per facility
> • Keep families in the loop with a dedicated family portal
>
> **Built for care environments**
> • App Lock with Face ID / fingerprint protects resident information
> • Push notifications for new, moved, and cancelled appointments
> • Works with your existing QuickBooks and payment workflows
>
> Senior Stylist is for authorized salon staff and facility teams. Ask your administrator for an
> invitation to sign in.

**Keywords (iOS, 100 chars):** `senior,salon,stylist,scheduling,assisted living,barber,booking,care,daily log,billing`
**Category:** Business (primary) · Productivity (secondary)
**Play tags:** Business, Scheduling, Productivity

---

## 2. Privacy questionnaires

**Data collected & linked to the user (both stores):**
| Data | Purpose | Notes |
|---|---|---|
| Name, email | App functionality / account | Staff login identities |
| Phone number (optional) | App functionality | Contact info for staff/POA records |
| Photos (user-initiated) | App functionality | Log-sheet/check scans, resident profile photos — uploaded only when the user chooses |
| Customer service records | App functionality | Appointments, service logs, billing records for the business |
| Coarse actions/diagnostics | Analytics: **none** | No third-party analytics/ads SDKs |

**Answers:**
- Tracking (IDFA / cross-app): **No**
- Third-party advertising: **No**
- Data sold: **No**
- Data encrypted in transit: **Yes** (HTTPS everywhere; HSTS)
- Deletion path: account deletion on request via support (pmt@seniorstylist.com); note App Store
  requires an account-deletion path — support-email flow is acceptable for enterprise/staff apps
  with admin-managed accounts.
- Payment data: card entry is handled by **Stripe** (PCI DSS L1) inside Stripe-hosted fields; the
  app never stores card numbers.

**Play Data Safety additions:** data encrypted in transit — yes; users can request deletion — yes;
app is for a **closed user group** (invited staff), no public account creation.

**Age rating:** 4+ / Everyone (no objectionable content). Made for Kids: **No**.

---

## 3. Apple review notes (Guideline 4.2 defense + access)

Paste into App Review notes:

> Senior Stylist is a staff tool for salon teams operating inside senior living communities.
> Sign-in is invitation-only (facility administrators invite staff), so we have provided a demo
> account below.
>
> **Demo login:** [CREATE BEFORE SUBMISSION — a dedicated demo facility + stylist login using the
> email-code sign-in; put the email + a note that the 6-digit code will be forwarded, or use a
> fixed-code test account via Supabase test OTP]
>
> Native capabilities beyond the web experience:
> • Push notifications (APNs) — new/moved/cancelled appointment alerts and nightly schedule reminders
> • Face ID App Lock protecting resident personal information (NSFaceIDUsageDescription)
> • Camera capture for scanning paper service logs and checks (NSCameraUsageDescription)
> • Haptic feedback throughout; native share sheet for exports; offline-state awareness
> • Biometric-gated, invitation-only environment appropriate for care settings
>
> The app requires an account because it manages private operational data (schedules, billing)
> for real senior-living facilities (Guideline 5.1.1 compliance: demo account provided).

**Known review risks + mitigations:**
- 4.2 Minimum functionality → the native feature list above; mention App Lock + push + camera in
  the first response if questioned.
- 2.1 Sign-in blocked → make sure the demo account works from a fresh device; the 6-digit email
  code flow must be reachable by the reviewer (consider a fixed-OTP test user).
- 5.1.1 Account deletion → support-email deletion path documented in the privacy answers.

---

## 4. Screenshot shot-list (both stores)

Capture on iPhone 15 Pro Max (6.7") + iPad Pro 12.9" (iOS) and Pixel 8 Pro (Play), light mode,
demo facility data:
1. Dashboard — calendar + Today card ("Your whole salon day at a glance")
2. Daily log with a finalized day ("Paper log sheets, digitized")
3. OCR scan review screen ("Scan a paper sheet — we read it for you")
4. My Account with App Lock + push toggles ("Private by design")
5. Time-off request + approval badges ("Time off, handled")
6. Billing view (admin) ("Billing without the spreadsheet")
Frame with the burgundy brand color (#8B2E4A) and short captions.

---

## 5. Submission order
1. **Google Play first** (faster review): closed testing track (12+ testers, 14 days) → production.
2. **iOS after** Play closed test feedback: TestFlight internal → App Review with the notes above.
Both need: privacy policy URL `https://portal.seniorstylist.com/privacy`, support URL/email
(`pmt@seniorstylist.com`), marketing URL `https://portal.seniorstylist.com`.
