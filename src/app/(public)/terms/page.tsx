import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Service — Senior Stylist',
}

export default function TermsPage() {
  return (
    <article className="space-y-10">
      <div>
        <h1
          className="text-4xl mb-2"
          style={{ fontFamily: 'var(--font-dm-serif)', color: '#8B2E4A' }}
        >
          Terms of Service &amp; EULA
        </h1>
        <p className="text-sm text-stone-500">Effective Date: September 1, 2026</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">1. Acceptance</h2>
        <p className="text-stone-600 leading-relaxed">
          By accessing or using Senior Stylist, you agree to be bound by these Terms of Service
          (&ldquo;Terms&rdquo;). If you do not agree, do not use the platform. If you are using the service
          on behalf of a facility, organization, or other entity, you represent that you have the
          authority to bind that entity to these Terms, and references to &ldquo;you&rdquo; include that entity.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">2. Description of Service</h2>
        <p className="text-stone-600 leading-relaxed">
          Senior Stylist is a software-as-a-service (SaaS) platform for managing salon appointments,
          resident records, stylist schedules, compliance documentation, and payroll at senior living
          facilities. The platform is provided by Senior Stylist LLC.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">3. Accounts</h2>
        <p className="text-stone-600 leading-relaxed">
          Facility administrators are responsible for all activity that occurs under their facility
          account, including activity by any stylists, viewers, or other users they invite. You must
          maintain the confidentiality of your login credentials and notify us promptly at{' '}
          <a href="mailto:legal@seniorstylist.com" className="text-[#8B2E4A] hover:underline">
            legal@seniorstylist.com
          </a>{' '}
          if you suspect unauthorized access.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">4. License</h2>
        <p className="text-stone-600 leading-relaxed">
          Senior Stylist LLC grants you a limited, non-exclusive, non-sublicensable, non-transferable
          license to access and use the platform solely for your internal business operations during
          the term of your subscription. You may not:
        </p>
        <ul className="list-disc list-inside space-y-1 text-stone-600 leading-relaxed pl-2">
          <li>Reverse engineer, decompile, or disassemble the software.</li>
          <li>Copy, modify, or create derivative works of the platform.</li>
          <li>Resell, sublicense, or otherwise transfer access to the platform to third parties.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">5. Acceptable Use</h2>
        <p className="text-stone-600 leading-relaxed">You agree not to:</p>
        <ul className="list-disc list-inside space-y-1 text-stone-600 leading-relaxed pl-2">
          <li>Use the platform for any unlawful purpose or in violation of applicable regulations.</li>
          <li>Upload or transmit malicious code, viruses, or disruptive content.</li>
          <li>Attempt to gain unauthorized access to any system, account, or data.</li>
          <li>Scrape, harvest, or collect data from the platform through automated means.</li>
          <li>
            Use the platform in a manner that would violate HIPAA, state privacy laws, or other
            laws applicable to the health and personal care industry.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">6. Fees &amp; Payment</h2>
        <p className="text-stone-600 leading-relaxed">
          Subscription fees are billed monthly or annually as selected at the time of sign-up or
          as mutually agreed. All fees are non-refundable after the applicable billing cycle has
          started. We reserve the right to suspend or terminate access to the platform for
          non-payment following at least 10 days&apos; written notice. Fees are subject to change
          with 30 days&apos; notice to facility administrators.
        </p>
      </section>

      <section id="refunds" className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">
          7. Salon Payments, Refunds &amp; Cancellations
        </h2>
        <p className="text-stone-600 leading-relaxed">
          This section applies to salon services paid for by residents and their families —
          whether by card through the family portal, by a saved card on file, or in person.
        </p>
        <ul className="list-disc pl-6 text-stone-600 leading-relaxed space-y-2">
          <li>
            <strong>Cancellations.</strong> There is no charge for appointments cancelled at least
            24 hours in advance. You pay only for services performed; late cancellations or missed
            appointments may be subject to a fee.
          </li>
          <li>
            <strong>Service concerns.</strong> If you are not satisfied with a service, contact us
            within 30 days. We will offer to redo the service, or provide a refund or account
            credit at your request.
          </li>
          <li>
            <strong>Billing errors.</strong> Duplicate charges, billing mistakes, and charges for
            services that were not performed are always fully refunded.
          </li>
          <li>
            <strong>Prepaid funds.</strong> Unused funds added to a resident&apos;s salon account
            (including prepaid packages) are refundable at any time upon request. If a resident
            passes away or moves out of their community, we will refund any unused balance to the
            family or estate.
          </li>
          <li>
            <strong>Gifts.</strong> Gift payments are refundable to the sender until they are used.
            Once applied to services, they are treated like any other payment.
          </li>
        </ul>
        <p className="text-stone-600 leading-relaxed">
          Refunds are issued to the original payment method and typically appear within 5&ndash;10
          business days. To request a refund or cancel an appointment, call us at 443-450-3344 or
          contact the salon team at your community.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">8. Data Ownership</h2>
        <p className="text-stone-600 leading-relaxed">
          You retain ownership of your facility&apos;s resident records, booking history, and other
          operational data you input into the platform (&ldquo;Customer Data&rdquo;). Senior Stylist LLC
          retains ownership of the platform, software, algorithms, user interface designs, and any
          aggregated, anonymized analytics derived from platform usage that do not identify any
          individual or facility.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">9. Integrations</h2>
        <p className="text-stone-600 leading-relaxed">
          The platform offers optional integrations with third-party services, including QuickBooks
          Online and Google Calendar. Your use of these integrations is subject to the respective
          third-party&apos;s terms of service and privacy policies. Senior Stylist LLC is not
          responsible for the availability, accuracy, or reliability of third-party services, or for
          any interruption, data loss, or damages arising from a third-party service failure.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">10. Text Messaging (SMS)</h2>
        <p className="text-stone-600 leading-relaxed">
          Where a resident&apos;s family member, authorized representative, or a stylist or staff
          member opts in to receive text messages (see our{' '}
          <a href="/privacy" className="text-[#8B2E4A] hover:underline">
            Privacy Policy
          </a>
          ), the following terms apply. Messages are transactional notifications about salon
          services — appointment confirmations and reminders, service receipts, payment requests,
          account security notices, one-time sign-in codes, and operational updates for staff. We
          do not send marketing or promotional text messages. Message frequency varies. Message and
          data rates may apply. Reply <strong>STOP</strong> to any message to opt out at any time,
          or <strong>HELP</strong> for help; you can also call 443-450-3344 for assistance. Mobile
          phone numbers and SMS opt-in data are never shared with, sold to, or rented to third
          parties or affiliates. Wireless carriers are not liable for delayed or undelivered
          messages.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">11. Limitation of Liability</h2>
        <p className="text-stone-600 leading-relaxed">
          To the maximum extent permitted by applicable law, Senior Stylist LLC&apos;s total cumulative
          liability to you for any claims arising out of or related to these Terms or your use of
          the platform is limited to the fees paid by you in the 12 months immediately preceding the
          claim. Senior Stylist LLC is not liable for any indirect, incidental, special, punitive,
          or consequential damages, including loss of profits, data, or business opportunity, even
          if advised of the possibility of such damages.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">12. Termination</h2>
        <p className="text-stone-600 leading-relaxed">
          Either party may terminate the subscription with 30 days&apos; written notice. Senior Stylist
          LLC may terminate immediately for material breach of these Terms (including non-payment
          after notice). Upon termination, we will provide access to a data export for 30 days, after
          which your Customer Data will be permanently deleted per our data retention policy.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">13. Governing Law</h2>
        <p className="text-stone-600 leading-relaxed">
          These Terms are governed by and construed in accordance with the laws of the State of
          Maryland, USA, without regard to its conflict of law principles. Any disputes arising under
          these Terms shall be subject to the exclusive jurisdiction of the state and federal courts
          located in Maryland.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">14. Contact</h2>
        <p className="text-stone-600 leading-relaxed">
          For legal inquiries or questions about these Terms, please contact us at{' '}
          <a href="mailto:legal@seniorstylist.com" className="text-[#8B2E4A] hover:underline">
            legal@seniorstylist.com
          </a>
          .
        </p>
      </section>
    </article>
  )
}
