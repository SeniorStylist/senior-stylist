# A2P 10DLC WordPress Kit — seniorstylist.com (Elementor)

Paste-ready fixes for the Twilio A2P 10DLC campaign submission. Three reviewer blockers live on
the WordPress marketing site (not the portal): thin privacy-policy SMS language, no Privacy
Policy link in the homepage footer, and a phone-collecting form with no SMS disclosure. Everything
below is copy-paste ready. (The portal side — `portal.seniorstylist.com/privacy` and the family
signup consent line — was hardened in the same commit as this file and needs no manual work.)

**⚠️ Phone number:** the correct number is **800.979.3759** (matches the site footer and every
indexed listing). The Individual Services Request page body shows **(800) 979-7759 — a typo with
no corroboration anywhere**. Fix it while you're in Elementor (Step 4).

---

## Step 1 — Privacy Policy page: replace the second paragraph

On the WordPress Privacy Policy page, replace the current "we don't sell or share your data"
paragraph with BOTH blocks below, exactly. Reviewers scan for the literal phrases "mobile
information," "SMS consent," and "opt-in data."

> We do not sell or share your data with third parties. Specifically, no mobile information or
> SMS consent will be shared with third parties or affiliates for marketing or lead generation
> purposes. Text messaging originator opt-in data and consent will not be shared with any third
> parties. Your information will only be used by authorized staff to contact you regarding
> services you request.
>
> **SMS Communications.** By providing your phone number to Senior Stylist, you may receive text
> messages related to appointment scheduling, confirmations, and service coordination. Message
> frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for
> assistance.

If the existing page is too thin to patch, use the complete drop-in policy in the Appendix
instead.

## Step 2 — Link Privacy Policy from the homepage footer

The campaign form makes you tick a box confirming the Privacy Policy URL is linked from your
homepage. The footer Quick Links currently run Home → Individual Services Request Form with no
Privacy Policy entry.

In Elementor: edit the footer Quick Links menu → add **Privacy Policy** → point it at the
WordPress privacy page (patched per Step 1). Alternative if you'd rather maintain ONE policy:
point it at `https://portal.seniorstylist.com/privacy` — that page carries all the required
language as of 2026-08-18.

## Step 3 — Individual Services Request form: SMS disclosure + campaign answers

The request form collects phone numbers, so it IS a web opt-in form. On the campaign form:

- Do **NOT** tick "I do not use web/written forms."
- Check **Website** as a consent method, with the URL
  `https://seniorstylist.com/individual-services-request/`.
- Add this line directly below the form's submit button (link "Privacy Policy" to the page from
  Step 2):

> By submitting this form, you agree to receive text messages from Senior Stylist regarding your
> appointment request. Message frequency varies. Message and data rates may apply. Reply STOP to
> opt out or HELP for help. See our Privacy Policy.

- Then screenshot the form **showing that disclosure** and upload the screenshot as proof.

## Step 4 — Fix the phone typo

On `/individual-services-request/`, change **(800) 979-7759** → **800.979.3759** in the page
body. (The footer's 800.979.3759 is already correct.)

---

## Appendix — complete drop-in Privacy Policy for seniorstylist.com

Use this if patching the existing page (Step 1) isn't enough. It is scoped to the marketing site
and its request form; the portal app has its own policy at `portal.seniorstylist.com/privacy`.

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

*This kit was generated 2026-08-18 alongside the portal privacy-page hardening commit. If the
campaign reviewer asks for further language changes, update BOTH the WordPress page and
`src/app/(public)/privacy/page.tsx` so the two policies never diverge on the carrier-required
sentences.*
