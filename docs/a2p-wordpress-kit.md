# A2P Campaign Kit — portal-first (WordPress off the critical path)

The Twilio A2P 10DLC campaign runs entirely off **portal.seniorstylist.com** (Josh's call,
2026-08-19): the portal hosts the compliant privacy policy, links it from every public entry
page, and its family signup wizard is the web opt-in form with the SMS disclosure built in.
WordPress is needed only for two safety/hygiene items below.

**⚠️ Phone number:** the correct number is **800.979.3759** (matches the site footer and every
indexed listing). The Individual Services Request page body shows **(800) 979-7759 — a typo with
no corroboration anywhere**.

---

## Part 1 — Campaign form answers (zero WordPress)

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

## Part 2 — WordPress: still required

Josh wasn't sure whether people who submit the WordPress **Individual Services Request** form
ever get texted from the business number. Until that's confirmed as calls-only, treat the form
as an opt-in surface:

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

## Part 3 — WordPress: optional hygiene (no longer campaign-blocking)

Whenever you're in Elementor anyway:

- **Privacy page**: replace the "don't sell or share" paragraph with the two blocks below —
  keeps the two policies aligned on the carrier-required sentences:

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

- **Footer Quick Links**: add **Privacy Policy** — point it at the WordPress privacy page or at
  `https://portal.seniorstylist.com/privacy`.

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
