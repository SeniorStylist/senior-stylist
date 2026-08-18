import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy — Senior Stylist',
}

export default function PrivacyPage() {
  return (
    <article className="space-y-10">
      <div>
        <h1
          className="text-4xl mb-2"
          style={{ fontFamily: 'var(--font-dm-serif)', color: '#8B2E4A' }}
        >
          Privacy Policy
        </h1>
        <p className="text-sm text-stone-500">Effective Date: August 18, 2026</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">1. Who We Are</h2>
        <p className="text-stone-600 leading-relaxed">
          Senior Stylist LLC (&ldquo;Senior Stylist,&rdquo; &ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;) provides
          salon scheduling and operations software for in-house salon services at senior living facilities.
          Our platform helps facilities schedule appointments, manage resident records, track stylist
          compliance, and process payroll.
        </p>
        <p className="text-stone-600 leading-relaxed">
          If you have questions about this Privacy Policy, please contact us at{' '}
          <a href="mailto:privacy@seniorstylist.com" className="text-[#8B2E4A] hover:underline">
            privacy@seniorstylist.com
          </a>
          .
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">2. Information We Collect</h2>
        <p className="text-stone-600 leading-relaxed">
          We collect information provided to us by facility administrators, stylists, and through use
          of our platform, including:
        </p>
        <ul className="list-disc list-inside space-y-1 text-stone-600 leading-relaxed pl-2">
          <li>
            <strong>Resident information:</strong> names, room numbers, contact information, booking
            history, and payment method preference (e.g., cash, check, credit card, facility billing,
            insurance). We do not store credit card numbers or other sensitive payment credentials.
          </li>
          <li>
            <strong>Stylist information:</strong> names, license numbers, license expiration dates,
            insurance documentation, availability schedules, and commission rates.
          </li>
          <li>
            <strong>Facility administrator information:</strong> names and email addresses.
          </li>
          <li>
            <strong>Usage data:</strong> login times, feature usage patterns, and activity logs used
            to operate and improve the platform.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">3. How We Use Your Information</h2>
        <p className="text-stone-600 leading-relaxed">We use the information we collect to:</p>
        <ul className="list-disc list-inside space-y-1 text-stone-600 leading-relaxed pl-2">
          <li>Schedule and confirm salon appointments for residents.</li>
          <li>Generate payroll reports for stylists based on completed bookings.</li>
          <li>Send booking confirmation emails to residents&apos; authorized representatives.</li>
          <li>
            Send text-message updates about salon appointments and accounts to family members who
            have provided a mobile phone number (see Section 4).
          </li>
          <li>Track license and insurance compliance deadlines and send expiration alerts.</li>
          <li>Operate, maintain, and improve the platform.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">4. Text Messages (SMS)</h2>
        <p className="text-stone-600 leading-relaxed">
          By providing your phone number to Senior Stylist — whether a resident&apos;s family member
          or authorized representative enters it on a facility&apos;s Salon Account sign-up page or a
          service request form, or asks salon staff to add it to the resident&apos;s record — you
          consent to receive text messages related to appointment scheduling, confirmations, and
          service coordination for that resident&apos;s salon services. These messages may include:
        </p>
        <ul className="list-disc list-inside space-y-1 text-stone-600 leading-relaxed pl-2">
          <li>Appointment confirmations and day-before reminders.</li>
          <li>Service receipts and payment requests.</li>
          <li>Account security notices (for example, when a payment card is saved).</li>
          <li>One-time sign-in codes for the family&apos;s online Salon Account.</li>
        </ul>
        <p className="text-stone-600 leading-relaxed">
          We never send marketing or promotional text messages. Message frequency varies with salon
          activity. Message and data rates may apply.
        </p>
        <p className="text-stone-600 leading-relaxed">
          <strong>Opting out:</strong> reply <strong>STOP</strong> to any message to stop receiving
          texts, or turn off text reminders in your Salon Account settings. Reply{' '}
          <strong>HELP</strong> for help, or call us at 443-450-3344.
        </p>
        <p className="text-stone-600 leading-relaxed">
          We do not sell or share your data with third parties. Specifically, no mobile information
          or SMS consent will be shared with third parties or affiliates for marketing or lead
          generation purposes. Text messaging originator opt-in data and consent will not be shared
          with any third parties. Your information will only be used by authorized staff to contact
          you regarding services you request.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">5. Information Sharing</h2>
        <p className="text-stone-600 leading-relaxed">
          We do not sell or share personal data with third parties for marketing or lead generation
          purposes, and no mobile information or SMS opt-in consent is ever shared with third
          parties or affiliates. The service providers below act solely on our behalf to operate
          the platform and are not permitted to use your information for their own purposes:
        </p>
        <ul className="list-disc list-inside space-y-1 text-stone-600 leading-relaxed pl-2">
          <li>
            <strong>Within your facility:</strong> facility administrators and stylists within the
            same facility may view resident and booking records scoped to that facility.
          </li>
          <li>
            <strong>QuickBooks Online:</strong> if enabled by the facility administrator, payroll
            figures (stylist name and net pay amounts) are transmitted to QuickBooks Online for
            accounting purposes.
          </li>
          <li>
            <strong>Resend:</strong> our transactional email provider used to deliver booking
            confirmations and compliance alerts.
          </li>
          <li>
            <strong>Twilio:</strong> our SMS delivery provider, used to deliver appointment and
            account text messages to family members who have provided a mobile number.
          </li>
          <li>
            <strong>Stripe:</strong> our payment processor. Card numbers are entered directly into
            and stored by Stripe — they never touch our servers.
          </li>
          <li>
            <strong>Google (Gemini):</strong> used to read scanned paper log sheets and checks that
            salon staff upload, so services and payments can be recorded accurately.
          </li>
          <li>
            <strong>Supabase:</strong> our database hosting provider (SOC 2 Type II compliant).
          </li>
          <li>
            <strong>Vercel:</strong> our application hosting provider.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">6. Data Retention</h2>
        <p className="text-stone-600 leading-relaxed">
          Booking records, resident information, and related operational data are retained for the
          life of the facility&apos;s active subscription, plus 90 days following the termination or
          expiration of the subscription to allow for data export. After that period, data is
          permanently deleted.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">7. Security</h2>
        <p className="text-stone-600 leading-relaxed">
          We implement industry-standard security measures to protect your data, including:
        </p>
        <ul className="list-disc list-inside space-y-1 text-stone-600 leading-relaxed pl-2">
          <li>TLS encryption for all data in transit.</li>
          <li>AES-256 encryption for data at rest.</li>
          <li>Row-level security policies ensuring data is scoped to the appropriate facility.</li>
          <li>Role-based access controls limiting data access by user role (admin, stylist, viewer).</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">8. Resident Rights</h2>
        <p className="text-stone-600 leading-relaxed">
          Residents or their authorized Power of Attorney representatives may request access to,
          correction of, or deletion of their personal information by contacting their facility
          administrator. Administrators can view and update resident records within the platform, or
          contact us at{' '}
          <a href="mailto:privacy@seniorstylist.com" className="text-[#8B2E4A] hover:underline">
            privacy@seniorstylist.com
          </a>{' '}
          for assistance.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">9. Changes to This Policy</h2>
        <p className="text-stone-600 leading-relaxed">
          We may update this Privacy Policy from time to time. We will notify facility administrators
          by email of any material changes at least 30 days before they take effect. Continued use
          of the platform after the effective date constitutes acceptance of the updated policy.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">10. Contact</h2>
        <p className="text-stone-600 leading-relaxed">
          For privacy-related questions or requests, please contact us at{' '}
          <a href="mailto:privacy@seniorstylist.com" className="text-[#8B2E4A] hover:underline">
            privacy@seniorstylist.com
          </a>{' '}
          or call{' '}
          <a href="tel:800-979-3759" className="text-[#8B2E4A] hover:underline">
            800.979.3759
          </a>
          .
        </p>
        <p className="text-stone-600 leading-relaxed">
          Senior Stylist LLC
          <br />
          2833 Smith Ave Ste 152
          <br />
          Baltimore, MD 21209
        </p>
      </section>
    </article>
  )
}
