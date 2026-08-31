# A2P Campaign Kit — Twilio (app) + Zoom (manual staff texts)

TWO independent 10DLC registrations, both citing the same portal privacy policy
(`https://portal.seniorstylist.com/privacy`):

- **Twilio** — the app's automated family messages (receipts, reminders, sign-in codes).
- **Zoom Phone** — Josh's manual operational texts to stylists (schedules, log sheets, etc.).

They are registered independently; neither covers the other's numbers. The portal policy covers
BOTH audiences as of 2026-08-19: §4 has the family paragraphs AND a "Stylists and staff"
operational-messaging paragraph, plus the unqualified never-shared/never-sold sharing language.

**⚠️ Phone number:** the correct number is **800.979.3759** (matches the site footer and every
indexed listing). The Individual Services Request page body shows **(800) 979-7759 — a typo with
no corroboration anywhere**.

---

## Part 1 — Twilio campaign answers (app messages, zero WordPress)

| Campaign form field | Answer |
|---|---|
| Brand / campaign website | `https://portal.seniorstylist.com` |
| Privacy policy URL | `https://portal.seniorstylist.com/privacy` |
| Policy linked from homepage? | Yes — the logged-out homepage is the sign-in page, which carries a Privacy Policy · Terms footer; every family-facing page also links it (as of 2026-08-19) |
| Opt-in / consent method | **Website** |
| Opt-in URL | `https://portal.seniorstylist.com/family/<CODE>/signup` — use your most presentable live facility's F-code (e.g. Fitzgerald's once assigned; self-signup is ON by default for every active facility) |
| "I do not use web/written forms" | Do **NOT** tick — the signup wizard is a web form |
| Proof screenshot | The signup wizard's contact step, showing the consent line under the phone field: "By giving your phone number, you agree to receive text messages from Senior Stylist about salon appointments and your account. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help." with the Privacy Policy link |

The portal privacy policy already carries the reviewer's required language verbatim
("…no mobile information or SMS consent will be shared with third parties or affiliates for
marketing or lead generation purposes. Text messaging originator opt-in data and consent will
not be shared with any third parties…"), the full SMS Communications section (frequency, rates,
STOP, HELP), the subprocessor list (Twilio, Stripe, Google Gemini, etc.), and the business phone
+ Baltimore address.

## Part 2 — Zoom campaign answers (manual staff texting)

| Campaign form field | Answer |
|---|---|
| Use case | Operational staff messaging — schedules, route/location assignments, log sheet submissions, license/insurance compliance deadlines. Not marketing. |
| Privacy policy URL | `https://portal.seniorstylist.com/privacy` |
| Consent / opt-in method | Mobile numbers are provided by stylists and staff during employment/contractor onboarding; consent is documented in the privacy policy's §4 "Stylists and staff" paragraph (STOP honored). |
| Proof screenshot | §4 ONLY, one frame — from the "4. Text Messages (SMS)" heading down through the sharing paragraph ("No mobile information or SMS consent — including mobile phone numbers and SMS opt-in data — will be shared with, sold to, or rented to third parties or affiliates…"), browser address bar visible, PNG under 10MB. Don't include §5 — its processor list reads as "sharing" to a fast-skimming reviewer. |
| URL field entry | Always paste WITH the scheme — `https://portal.seniorstylist.com/privacy`, never the bare domain (bare domains often fail the Verify check). |

**Known fetch-tool artifact**: automated page-fetchers (including AI assistants browsing the policy)
often strip the text inside `mailto:`/`tel:` links, so the Contact sections can come back as
"contact us at . or call ." — the live page really does show privacy@seniorstylist.com,
800.979.3759, and the Baltimore address; a human reviewer in a browser sees them. Don't "fix"
this by de-linking the contact info.
| Homepage link | The Zoom brand is registered against **seniorstylist.com**, so its reviewer checks THAT homepage → the WordPress footer link in Part 3 is REQUIRED for this campaign. |

## Part 3 — WordPress: required

**Footer link (required for the Zoom campaign):** in Elementor, add **Privacy Policy** to the
footer Quick Links menu pointing at `https://portal.seniorstylist.com/privacy`. This also
retires the thin WordPress policy page — one canonical policy, no divergence.

**Request-form disclosure:** Josh wasn't sure whether people who submit the WordPress
**Individual Services Request** form ever get texted from the business number. Until that's
confirmed as calls-only, treat the form as an opt-in surface:

1. **Add this line directly below the form's submit button** (link "Privacy Policy" to
   `https://portal.seniorstylist.com/privacy` or the WordPress policy page):

   > By submitting this form, you agree to receive text messages from Senior Stylist regarding
   > your appointment request. Message frequency varies. Message and data rates may apply.
   > Reply STOP to opt out or HELP for help. See our Privacy Policy.

   If the campaign form allows multiple opt-in URLs, also list
   `https://seniorstylist.com/individual-services-request/` and screenshot the form showing the
   disclosure. (If Lisa confirms those submitters are only ever *called*, this form can be left
   off the campaign — but the disclosure is still good practice.)

2. **Fix the phone typo** on `/individual-services-request/`:
   (800) 979-7759 → **800.979.3759**. Customer-facing — people are dialing a wrong number.

## Part 4 — WordPress: optional hygiene (no longer campaign-blocking)

With the footer now linking the portal policy, the WordPress privacy page is out of the
reviewer's path. If you keep it anyway, align it — replace the "don't sell or share" paragraph
with the two blocks below:

  > We do not sell or share your data with third parties. Specifically, no mobile information or
  > SMS consent will be shared with third parties or affiliates for marketing or lead generation
  > purposes. Text messaging originator opt-in data and consent will not be shared with any third
  > parties. Your information will only be used by authorized staff to contact you regarding
  > services you request.
  >
  > **SMS Communications.** By providing your phone number to Senior Stylist, you may receive
  > text messages related to appointment scheduling, confirmations, and service coordination.
  > Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP
  > for assistance.

(The footer link itself is in Part 3 — required, always pointing at the portal policy.)

---

## Part 5 — Get Twilio live (new console, number-first wizard)

Order of operations (fees as of 2026-08: ~$19.50 one-time, ~$2.65/mo fixed + ~$0.008/segment):
upgrade account if trial → compliance profile → buy Local number (443/410, SMS only) → brand
**Low Volume Standard** ($4.50) → campaign **Low Volume Mixed** ($15 vetting + $1.50/mo) →
Messaging Service sender pool + Advanced Opt-Out → wait for approval → Vercel env vars →
test → done. Full checklist: josh-checklist §F1. Legal name on the compliance profile must be
EXACTLY the CP-575 name: **Senior Stylist LLC**.

**Campaign description (paste):**

> Senior Stylist provides salon services inside senior living communities. This campaign sends
> transactional account and appointment messages to residents' family members and authorized
> representatives who opt in by providing their mobile number: appointment confirmations and
> day-before reminders, service receipts, payment requests, account security notices, and
> one-time sign-in codes for their online Salon Account. No marketing or promotional content
> is sent.

**Opt-in / message flow (paste; swap `<CODE>` for a real facility code):**

> End users opt in by entering their mobile number on their community's Salon Account sign-up
> page at https://portal.seniorstylist.com/family/<CODE>/signup and actively checking an
> unchecked consent box beneath the phone field that reads "By giving your phone number, you
> agree to receive text messages from Senior Stylist about salon appointments and your account.
> Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for
> help." with links to the Privacy Policy and Terms. The box is never pre-selected and is
> required to submit a phone number. Additionally, end users can opt in verbally by asking
> salon staff in person to add their number to the resident's record. Privacy policy:
> https://portal.seniorstylist.com/privacy. Terms: https://portal.seniorstylist.com/terms.
> Opt-out: reply STOP. Help: reply HELP or call 443-450-3344.

**Sample messages (the app's real templates — paste up to 5):**

1. `[Facility Name]: you're signed up for [Resident Name]'s salon account. We'll text you about visits. Sign in any time with your phone number and password. Reply STOP to opt out.`
2. `Reminder: [Resident Name] has a [Service] appointment tomorrow at [Time] at [Facility Name]. Reply to the facility with any questions. -Senior Stylist`
3. `Senior Stylist receipt: [Service] with [Stylist Name] on [Date]. Service 45 + Tip 5 = Total 50. Thank you! -[Facility Name]`
4. `Good news — [Resident Name]'s [Service] with [Stylist Name] is set for [Date] at [Time]. -[Facility Name]`
5. `[Facility Name]: a balance of 48.50 is due for [Resident Name]'s salon services. Pay securely here: https://portal.seniorstylist.com/family/[code]/login`

(Links in messages go only to our own portal domain — never URL shorteners.)

---

## Appendix — complete drop-in Privacy Policy for seniorstylist.com (optional)

Use this if the WordPress privacy page is too thin to patch. It is scoped to the marketing site
and its request form; the portal app keeps its own policy at `portal.seniorstylist.com/privacy`.

---

**Privacy Policy**

*Effective Date: August 18, 2026*

**Who We Are.** Senior Stylist LLC ("Senior Stylist," "we," "our," or "us") provides full-service
salon management for senior living communities, and in-home salon services for individuals.
Questions about this policy: privacy@seniorstylist.com or 800.979.3759.

**Information We Collect.** When you contact us or submit a form on this website (including the
Individual Services Request form), we collect the information you provide: your name, phone
number, email address, mailing address, and the details of your request. We also collect standard
website usage data (pages visited, browser type) to operate and improve the site.

**How We Use Your Information.** We use the information you submit to respond to your inquiry,
schedule and coordinate the salon services you request, and communicate with you about those
services. Your information will only be used by authorized staff to contact you regarding
services you request.

**SMS Communications.** By providing your phone number to Senior Stylist, you may receive text
messages related to appointment scheduling, confirmations, and service coordination. Message
frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for
assistance. We never send marketing or promotional text messages.

**Information Sharing.** We do not sell or share your data with third parties. Specifically, no
mobile information or SMS consent will be shared with third parties or affiliates for marketing
or lead generation purposes. Text messaging originator opt-in data and consent will not be shared
with any third parties. We use a small number of service providers (such as our website host,
email provider, and SMS delivery provider) solely to operate our services on our behalf; they are
not permitted to use your information for their own purposes.

**Data Retention.** We retain inquiry and service-request information for as long as needed to
provide the services you request and to meet our legal and accounting obligations, after which it
is deleted.

**Security.** We use industry-standard measures, including encryption in transit, to protect the
information you submit through this website.

**Your Rights.** You may request access to, correction of, or deletion of your personal
information by contacting us at privacy@seniorstylist.com or 800.979.3759.

**Changes to This Policy.** We may update this policy from time to time; the effective date above
reflects the latest revision.

**Contact.** Senior Stylist LLC, 2833 Smith Ave Ste 152, Baltimore, MD 21209 ·
privacy@seniorstylist.com · 800.979.3759

---

*Updated 2026-08-19 (portal-first restructure; original WordPress-first kit 2026-08-18). If a
campaign reviewer asks for further language changes, update the portal's
`src/app/(public)/privacy/page.tsx` (and the WordPress page if it's in the reviewer's path) so
the policies never diverge on the carrier-required sentences.*
