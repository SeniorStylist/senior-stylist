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
        <p className="text-sm text-stone-500">Effective Date: April 19, 2026</p>
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

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">7. Data Ownership</h2>
        <p className="text-stone-600 leading-relaxed">
          You retain ownership of your facility&apos;s resident records, booking history, and other
          operational data you input into the platform (&ldquo;Customer Data&rdquo;). Senior Stylist LLC
          retains ownership of the platform, software, algorithms, user interface designs, and any
          aggregated, anonymized analytics derived from platform usage that do not identify any
          individual or facility.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">8. Integrations</h2>
        <p className="text-stone-600 leading-relaxed">
          The platform offers optional integrations with third-party services, including QuickBooks
          Online and Google Calendar. Your use of these integrations is subject to the respective
          third-party&apos;s terms of service and privacy policies. Senior Stylist LLC is not
          responsible for the availability, accuracy, or reliability of third-party services, or for
          any interruption, data loss, or damages arising from a third-party service failure.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">9. Limitation of Liability</h2>
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
        <h2 className="text-xl font-semibold text-stone-800">10. Termination</h2>
        <p className="text-stone-600 leading-relaxed">
          Either party may terminate the subscription with 30 days&apos; written notice. Senior Stylist
          LLC may terminate immediately for material breach of these Terms (including non-payment
          after notice). Upon termination, we will provide access to a data export for 30 days, after
          which your Customer Data will be permanently deleted per our data retention policy.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">11. Governing Law</h2>
        <p className="text-stone-600 leading-relaxed">
          These Terms are governed by and construed in accordance with the laws of the State of
          Maryland, USA, without regard to its conflict of law principles. Any disputes arising under
          these Terms shall be subject to the exclusive jurisdiction of the state and federal courts
          located in Maryland.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-stone-800">12. Contact</h2>
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
