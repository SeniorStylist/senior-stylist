-- Senior Stylist — DB verification report (P29, 2026-07-12)
-- READ-ONLY. Paste the whole file into the Supabase SQL Editor and Run.
-- Reports OK / MISSING for one representative object per migration (0005→0027)
-- plus the resident-photos storage bucket and RLS coverage.
-- If anything says MISSING: run scripts/db-catchup.sql, then re-run this.

WITH checks(ord, item, ok) AS (
  VALUES
  ( 1, '0005 feedback_submissions table', to_regclass('public.feedback_submissions') IS NOT NULL),
  ( 2, '0006 qb_invoices 3-col dedup index (includes invoice_date)',
       EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'qb_invoices_dedup_idx' AND indexdef LIKE '%invoice_date%')),
  ( 3, '0007 profiles.feedback_email',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'feedback_email')),
  ( 4, '0008 qb_unapplied_credits table', to_regclass('public.qb_unapplied_credits') IS NOT NULL),
  ( 5, '0009 qb_unapplied_credits.applied_cents',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'qb_unapplied_credits' AND column_name = 'applied_cents')),
  ( 6, '0010 feedback_submissions.meta',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'feedback_submissions' AND column_name = 'meta')),
  ( 7, '0011 invites.last_sent_at (delivery tracking)',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invites' AND column_name = 'last_sent_at')),
  ( 8, '0012 portal_coupons table', to_regclass('public.portal_coupons') IS NOT NULL),
  ( 9, '0012 portal_claim_requests table', to_regclass('public.portal_claim_requests') IS NOT NULL),
  (10, '0013 bookings.payment_method',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'payment_method')),
  (11, '0014 push_subscriptions table', to_regclass('public.push_subscriptions') IS NOT NULL),
  (12, '0014 residents.photo_path',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'residents' AND column_name = 'photo_path')),
  (13, '0014 facilities.daily_digest_enabled',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'facilities' AND column_name = 'daily_digest_enabled')),
  (14, '0015 bookings.mail_subject',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'mail_subject')),
  (15, '0016 payment_methods table (card-on-file)', to_regclass('public.payment_methods') IS NOT NULL),
  (16, '0016 residents.stripe_customer_id',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'residents' AND column_name = 'stripe_customer_id')),
  (17, '0016 facilities.autopay_mode',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'facilities' AND column_name = 'autopay_mode')),
  (18, '0017 services.source',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'services' AND column_name = 'source')),
  (19, '0018 import_batches.review_payload',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'import_batches' AND column_name = 'review_payload')),
  (20, '0019 coverage_requests.approved_by (time-off approval)',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'coverage_requests' AND column_name = 'approved_by')),
  (21, '0020 push_subscriptions.platform (native push)',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'push_subscriptions' AND column_name = 'platform')),
  (22, '0021 qb_payments Stripe-PI unique index (double-pay guard)',
       EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'qb_payments_stripe_pi_unique')),
  (23, '0022 notifications table (inbox)', to_regclass('public.notifications') IS NOT NULL),
  (24, '0023 waitlist_entries table', to_regclass('public.waitlist_entries') IS NOT NULL),
  (25, '0024 facilities.monthly_report_enabled',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'facilities' AND column_name = 'monthly_report_enabled')),
  (26, '0025 resident_photos table (style photos)', to_regclass('public.resident_photos') IS NOT NULL),
  (27, '0026 user_prefs table (synced nav tabs)', to_regclass('public.user_prefs') IS NOT NULL),
  (28, '0027 bookings (facility,resident,start) index (P25 speed)',
       EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'bookings_facility_resident_start_idx')),
  (29, 'storage bucket: resident-photos (private)',
       EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'resident-photos' AND public = false))
)
SELECT item,
       CASE WHEN ok THEN 'OK' ELSE '>>> MISSING <<<' END AS status
FROM checks
ORDER BY ok, ord;

-- Second report: any public table WITHOUT row-level security (should return 0 rows).
SELECT tablename AS "table missing RLS (should be empty)"
FROM pg_tables
WHERE schemaname = 'public'
  AND rowsecurity = false
ORDER BY tablename;
