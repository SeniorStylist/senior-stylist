-- Senior Stylist — DB verification report (P29, 2026-07-12)
-- READ-ONLY. Paste the whole file into the Supabase SQL Editor and Run.
-- Reports OK / MISSING for one representative object per migration (0005→0048)
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
  (29, '0028 resident_merge_log table', to_regclass('public.resident_merge_log') IS NOT NULL),
  (30, '0029 resident_preferences table (family care notes)', to_regclass('public.resident_preferences') IS NOT NULL),
  (31, '0030 feedback_submissions.reply (two-way feedback)',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'feedback_submissions' AND column_name = 'reply')),
  (32, '0031 assistant_memories table', to_regclass('public.assistant_memories') IS NOT NULL),
  (33, '0032 portal_claim_requests.resident_name',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'portal_claim_requests' AND column_name = 'resident_name')),
  (34, '0033 signup_sheet_entries.source (portal requests)',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'signup_sheet_entries' AND column_name = 'source')),
  (35, '0034 portal_accounts.onboarded_at (+ its backfill — see note)',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'portal_accounts' AND column_name = 'onboarded_at')),
  (36, '0035 facilities.portal_self_signup_enabled defaults TRUE',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'facilities' AND column_name = 'portal_self_signup_enabled'
                 AND column_default ILIKE '%true%')),
  (37, '0036 qb_unapplied_credits.stripe_payment_intent_id',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'qb_unapplied_credits' AND column_name = 'stripe_payment_intent_id')),
  (38, '0037 portal_claim_requests.merge_suggestion_resident_id',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'portal_claim_requests' AND column_name = 'merge_suggestion_resident_id')),
  (39, '0038 portal_signup_card_tokens table', to_regclass('public.portal_signup_card_tokens') IS NOT NULL),
  (40, '0039 signup_sheet_entries.service_ids (multi-service)',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'signup_sheet_entries' AND column_name = 'service_ids')),
  (41, '0041 portal_accounts.email is NULLABLE (email-or-phone identity)',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'portal_accounts' AND column_name = 'email' AND is_nullable = 'YES')),
  (42, '0041 portal_accounts phone-digits unique index',
       EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'portal_accounts_phone_digits_uniq')),
  (43, '0042 portal_login_codes table (SMS sign-in)', to_regclass('public.portal_login_codes') IS NOT NULL),
  (44, '0043 qb_customer_links table (QB customer sync)', to_regclass('public.qb_customer_links') IS NOT NULL),
  (45, '0044 qb_invoice_site_payments table (site-paid protection)', to_regclass('public.qb_invoice_site_payments') IS NOT NULL),
  (46, '0045 qb_payment_mirror_queue table', to_regclass('public.qb_payment_mirror_queue') IS NOT NULL),
  (47, '0046 qb_connections table (realm-level QuickBooks)', to_regclass('public.qb_connections') IS NOT NULL),
  (48, '0047 facilities active-code unique index',
       EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'facilities_code_active_uniq')),
  (49, '0048 invites.stylist_id (deterministic stylist linking)',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invites' AND column_name = 'stylist_id')),
  (50, 'storage bucket: resident-photos (private)',
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

-- 0040 (P55) is a DATA HEAL with no schema footprint, so it cannot be checked by
-- shape. It frees real sign-up requests that were stranded on the tutorial's
-- "Demo Sarah". This should return 0 rows; if it returns any, run drizzle/0040.
SELECT count(*) AS "real requests stranded on a demo stylist (should be 0)"
FROM signup_sheet_entries e
JOIN stylists s ON s.id = e.assigned_to_stylist_id
WHERE e.is_demo = false AND s.is_demo = true;

-- 0047 pre-check. Must return 0 rows BEFORE the unique index can be created;
-- merge any duplicates from Master Admin -> Merge first.
SELECT upper(facility_code) AS "duplicate ACTIVE facility code (should be empty)", count(*)
FROM facilities
WHERE active = true AND facility_code IS NOT NULL
GROUP BY 1 HAVING count(*) > 1;
