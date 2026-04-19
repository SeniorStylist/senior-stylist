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
        <p className="text-sm text-stone-500">Effective Date: April 19, 2026</p>
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
          <li>Track license and insurance compliance deadlines and send expiration alerts.</li>
          <li>Operate, maintain, and improve the platform.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">4. Information Sharing</h2>
        <p className="text-stone-600 leading-relaxed">
          We do not sell personal data. We share data only as necessary to provide our services:
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
            <strong>Supabase:</strong> our database hosting provider (SOC 2 Type II compliant).
          </li>
          <li>
            <strong>Vercel:</strong> our application hosting provider.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">5. Data Retention</h2>
        <p className="text-stone-600 leading-relaxed">
          Booking records, resident information, and related operational data are retained for the
          life of the facility&apos;s active subscription, plus 90 days following the termination or
          expiration of the subscription to allow for data export. After that period, data is
          permanently deleted.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">6. Security</h2>
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
        <h2 className="text-xl font-semibold text-stone-800">7. Resident Rights</h2>
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
        <h2 className="text-xl font-semibold text-stone-800">8. Changes to This Policy</h2>
        <p className="text-stone-600 leading-relaxed">
          We may update this Privacy Policy from time to time. We will notify facility administrators
          by email of any material changes at least 30 days before they take effect. Continued use
          of the platform after the effective date constitutes acceptance of the updated policy.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">9. Contact</h2>
        <p className="text-stone-600 leading-relaxed">
          For privacy-related questions or requests, please contact us at{' '}
          <a href="mailto:privacy@seniorstylist.com" className="text-[#8B2E4A] hover:underline">
            privacy@seniorstylist.com
          </a>
          .
        </p>
      </section>
    </article>
  )
}
