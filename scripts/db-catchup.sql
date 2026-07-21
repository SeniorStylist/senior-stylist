-- Senior Stylist — DB catch-up (P29, generated 2026-07-12)
-- Concatenation of drizzle/0001→0027, ALL idempotent (IF NOT EXISTS guards).
-- Safe to run repeatedly. Paste the whole file into the Supabase SQL Editor and Run.
-- Then re-run scripts/db-verify.sql to confirm everything reports OK.


-- ============================================================
-- drizzle/0001_phase13_demo_tutorial.sql
-- ============================================================
-- Phase 13-Tutorial — demo data + scripted-tour schema
--
-- WHY THIS FILE EXISTS: the Phase 13 app code queries `is_demo`,
-- `profiles.has_seen_first_tour`, `profiles.help_progress`, and the
-- `help_step_events` table. `drizzle-kit push` prompts interactively when it
-- sees the NOT NULL columns / new index, and aborts in a non-interactive shell
-- without applying — which left the deployed code 500-ing on a DB that lacked
-- these columns. This file is fully idempotent and applies cleanly with:
--
--   psql "$DIRECT_URL" -f drizzle/0001_phase13_demo_tutorial.sql
--
-- (or paste it into the Supabase SQL editor for project goomnlsdguetfgwjpwer).
-- After it runs, `drizzle-kit push` should report "No changes".

BEGIN;

-- ── demo flag on the six seeded tables ───────────────────────────────────
ALTER TABLE residents        ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE stylists         ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE services         ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE bookings         ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE log_entries      ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE stylist_checkins ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

-- ── profiles: first-tour autolaunch + mid-tour resume state ──────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS has_seen_first_tour boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS help_progress jsonb;

-- ── partial index for demo-record lookups / seeding ──────────────────────
CREATE INDEX IF NOT EXISTS residents_demo_idx ON residents (facility_id) WHERE is_demo = true;

-- ── help_step_events telemetry table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS help_step_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL,
  user_id     uuid REFERENCES profiles(id)   ON DELETE SET NULL,
  tour_id     text    NOT NULL,
  step_index  integer NOT NULL,
  action      text    NOT NULL, -- 'shown' | 'completed' | 'abandoned' | 'skipped'
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS help_step_events_tour_step_action_idx ON help_step_events (tour_id, step_index, action);
CREATE INDEX IF NOT EXISTS help_step_events_facility_created_idx ON help_step_events (facility_id, created_at);

-- ── RLS (project rule: every table goes through service_role) ─────────────
ALTER TABLE help_step_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON help_step_events;
CREATE POLICY "service_role_all" ON help_step_events FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;

-- ============================================================
-- drizzle/0002_facilities_is_demo.sql
-- ============================================================
-- Phase 13-Tutorial Batch 2: add is_demo to facilities
-- Idempotent — safe to run multiple times.
-- Apply via: psql "$DIRECT_URL" -f drizzle/0002_facilities_is_demo.sql
BEGIN;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS facilities_demo_idx ON facilities (id) WHERE is_demo = TRUE;
COMMIT;

-- ============================================================
-- drizzle/0003_signup_sheet_is_demo.sql
-- ============================================================
-- Phase 13-Tutorial Batch 4 — is_demo on signup_sheet_entries.
-- Idempotent: safe to re-run. The column is also declared in src/db/schema.ts.
BEGIN;
ALTER TABLE signup_sheet_entries ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
COMMIT;

-- ============================================================
-- drizzle/0004_billing_payroll_is_demo.sql
-- ============================================================
-- Phase 13-Tutorial — is_demo on billing + payroll tables.
-- Lets the scripted billing/payroll/QuickBooks tutorials show populated demo
-- screens (a demo invoice, payment, pay period, and pay item) without those
-- records ever leaking into real billing, payroll, or analytics. Reads are
-- demo-symmetric: eq(table.is_demo, tutorialMode).
-- Idempotent: safe to re-run. Columns are also declared in src/db/schema.ts.
BEGIN;
ALTER TABLE qb_invoices       ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE qb_payments       ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE pay_periods       ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE stylist_pay_items ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
COMMIT;

-- ============================================================
-- drizzle/0005_feedback.sql
-- ============================================================
-- Feedback widget (2026-06-11) — idempotent. Apply with:
--   psql "$DIRECT_URL" -f drizzle/0005_feedback.sql

CREATE TABLE IF NOT EXISTS feedback_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL,
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  role text,
  category text NOT NULL DEFAULT 'other',
  message text NOT NULL,
  page_path text,
  user_agent text,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_submissions_status_created_idx
  ON feedback_submissions (status, created_at);

ALTER TABLE feedback_submissions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'feedback_submissions' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON feedback_submissions
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- drizzle/0006_qb_invoices_dedup_date.sql
-- ============================================================
-- QB invoice numbers are "MMDD Lastname" — the same number recurs across years
-- (e.g. "1026 Means" in 2022 AND 2023). The old (invoice_num, facility_id) unique
-- key silently merged those distinct invoices on import. Adding invoice_date to the
-- key keeps re-imports idempotent while letting different-date invoices coexist.
-- Idempotent — apply with: psql "$DIRECT_URL" -f drizzle/0006_qb_invoices_dedup_date.sql
DROP INDEX IF EXISTS qb_invoices_dedup_idx;
CREATE UNIQUE INDEX IF NOT EXISTS qb_invoices_dedup_idx
  ON qb_invoices (invoice_num, facility_id, invoice_date);

-- ============================================================
-- drizzle/0007_profiles_feedback_email.sql
-- ============================================================
-- 2026-06-12: Custom feedback notification email for master admin profile
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS feedback_email text;

-- ============================================================
-- drizzle/0008_qb_unapplied_credits.sql
-- ============================================================
-- Unapplied QB credits snapshot — payments/credit memos received in QuickBooks but
-- never applied to an invoice. Populated by the "Customer Balance Detail" CSV import
-- (Step 5 on /master-admin/imports/quickbooks); wiped and replaced on every import.
-- Idempotent: apply with  psql "$DIRECT_URL" -f drizzle/0008_qb_unapplied_credits.sql

CREATE TABLE IF NOT EXISTS qb_unapplied_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  resident_id uuid REFERENCES residents(id) ON DELETE SET NULL,
  qb_customer_id text NOT NULL,
  txn_type text NOT NULL DEFAULT 'Payment',
  txn_date date NOT NULL,
  num text,
  amount_cents integer NOT NULL DEFAULT 0,
  open_balance_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qb_unapplied_credits_facility_idx ON qb_unapplied_credits (facility_id);

ALTER TABLE qb_unapplied_credits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all ON qb_unapplied_credits;
CREATE POLICY "service_role_all" ON qb_unapplied_credits FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- drizzle/0009_unapplied_apply.sql
-- ============================================================
-- Site-side application of unapplied QB credits (2026-06-12).
-- Idempotent — apply with: psql "$DIRECT_URL" -f drizzle/0009_unapplied_apply.sql
-- (Also self-bootstrapped by src/lib/unapplied-ddl.ts — keep the two in sync.)

ALTER TABLE qb_unapplied_credits ADD COLUMN IF NOT EXISTS applied_cents integer NOT NULL DEFAULT 0;
ALTER TABLE qb_unapplied_credits ADD COLUMN IF NOT EXISTS applied_at timestamptz;
ALTER TABLE qb_unapplied_credits ADD COLUMN IF NOT EXISTS applied_by uuid;
ALTER TABLE qb_unapplied_credits ADD COLUMN IF NOT EXISTS applied_detail jsonb;

-- ============================================================
-- drizzle/0010_feedback_meta.sql
-- ============================================================
-- Client context snapshot on feedback submissions (viewport, screen, dpr,
-- timezone, language, standalone/PWA, online). Idempotent — apply with:
--   psql "$DIRECT_URL" -f drizzle/0010_feedback_meta.sql
-- Also self-bootstrapped by src/lib/feedback-ddl.ts (keep in sync).

ALTER TABLE feedback_submissions ADD COLUMN IF NOT EXISTS meta jsonb;

-- ============================================================
-- drizzle/0011_invite_tracking.sql
-- ============================================================
-- Invite delivery + engagement tracking. Idempotent.
-- Apply with: psql "$DIRECT_URL" -f drizzle/0011_invite_tracking.sql
-- (also self-bootstrapped at runtime by src/lib/invite-ddl.ts)

ALTER TABLE invites
  ADD COLUMN IF NOT EXISTS last_sent_at timestamp,
  ADD COLUMN IF NOT EXISTS email_failed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS viewed_at timestamp,
  ADD COLUMN IF NOT EXISTS accepted_at timestamp;

-- ============================================================
-- drizzle/0012_portal_expansion.sql
-- ============================================================
-- Portal Expansion (Phase 14A): self-signup, coupons, claim requests (2026-06-15)
-- Apply with: psql "$DIRECT_URL" -f drizzle/0012_portal_expansion.sql

-- 1. Add birthday to residents
ALTER TABLE residents ADD COLUMN IF NOT EXISTS date_of_birth date;

-- 2. Expand portal_accounts with profile info for self-signup
ALTER TABLE portal_accounts ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE portal_accounts ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE portal_accounts ADD COLUMN IF NOT EXISTS date_of_birth date;

-- 3. Portal feature flags on facilities
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS portal_self_signup_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS portal_coupons_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS portal_welcome_coupon_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS portal_welcome_coupon_type text;  -- 'percent' | 'fixed'
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS portal_welcome_coupon_value integer;  -- percent or cents

-- 4. Portal coupons (templates that drive redemptions)
CREATE TABLE IF NOT EXISTS portal_coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid REFERENCES facilities(id) ON DELETE CASCADE,
  code text NOT NULL,
  type text NOT NULL,         -- 'welcome' | 'birthday' | 'referral' | 'loyalty' | 'manual'
  discount_type text NOT NULL, -- 'percent' | 'fixed'
  discount_value integer NOT NULL, -- percent (1–100) or cents
  description text,
  max_redemptions integer,    -- null = unlimited
  max_per_account integer DEFAULT 1,
  expires_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  CONSTRAINT portal_coupons_code_key UNIQUE (code)
);

ALTER TABLE portal_coupons ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_all" ON portal_coupons FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS portal_coupons_facility_type_idx
  ON portal_coupons(facility_id, type) WHERE active = true;

-- 5. Portal coupon redemptions (issued to a portal account)
CREATE TABLE IF NOT EXISTS portal_coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL REFERENCES portal_coupons(id) ON DELETE CASCADE,
  portal_account_id uuid NOT NULL REFERENCES portal_accounts(id) ON DELETE CASCADE,
  resident_id uuid REFERENCES residents(id) ON DELETE SET NULL,
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  discount_cents integer NOT NULL DEFAULT 0,  -- 0 = pending; set at checkout for percent coupons
  redeemed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE portal_coupon_redemptions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_all" ON portal_coupon_redemptions FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS portal_coupon_redemptions_account_coupon_idx
  ON portal_coupon_redemptions(portal_account_id, coupon_id);
CREATE INDEX IF NOT EXISTS portal_coupon_redemptions_facility_idx
  ON portal_coupon_redemptions(facility_id, redeemed_at DESC);

-- 6. Portal claim requests (self-signup approval queue)
CREATE TABLE IF NOT EXISTS portal_claim_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  facility_code text NOT NULL,
  email text NOT NULL,
  full_name text NOT NULL,
  phone text,
  date_of_birth date,
  resident_id uuid REFERENCES residents(id) ON DELETE SET NULL,
  match_type text,            -- 'email' | 'name' | null
  match_confidence text,      -- 'high' | 'medium' | 'low' | null
  status text NOT NULL DEFAULT 'pending_review',  -- 'auto_approved' | 'pending_review' | 'approved' | 'rejected'
  reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE portal_claim_requests ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_all" ON portal_claim_requests FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS portal_claim_requests_facility_status_idx
  ON portal_claim_requests(facility_id, status);
CREATE INDEX IF NOT EXISTS portal_claim_requests_email_facility_idx
  ON portal_claim_requests(email, facility_id);

-- ============================================================
-- drizzle/0013_bookings_payment_method.sql
-- ============================================================
-- Add free-text payment method to bookings (idempotent)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_method text;

-- ============================================================
-- drizzle/0014_wave2_wave3.sql
-- ============================================================
-- Wave 2 & 3 schema additions (idempotent — safe to re-run)

-- 13A: changelog read-state on profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS changelog_last_read_at timestamptz;

-- 13E: per-facility opt-in daily digest
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS daily_digest_enabled boolean NOT NULL DEFAULT false;

-- 13G: resident profile photo (path in private bucket resident-photos)
ALTER TABLE residents ADD COLUMN IF NOT EXISTS photo_path text;

-- 13J: service sort order within category
ALTER TABLE services ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- 13Q: web push subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'push_subscriptions' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON push_subscriptions
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (user_id);

-- ============================================================
-- drizzle/0015_booking_mail_subject.sql
-- ============================================================
-- Per-log-sheet "Mail Subject" for the daily-log Excel export (column B).
-- Entered at OCR-scan time per sheet; export-modal subject is the fallback.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS mail_subject text;

-- ============================================================
-- drizzle/0016_payments_cof.sql
-- ============================================================
-- Payments: Card-On-File auto-collect + in-app stylist card processing.
-- Idempotent. Apply with: psql "$DIRECT_URL" -f drizzle/0016_payments_cof.sql
-- Keep in sync with src/lib/payments-ddl.ts::ensurePaymentsSchema().

-- residents: Stripe customer + per-resident auto-collect config
ALTER TABLE residents ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE residents ADD COLUMN IF NOT EXISTS autopay_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE residents ADD COLUMN IF NOT EXISTS autopay_method text;

-- facilities: facility-level auto-collect config
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS autopay_mode text NOT NULL DEFAULT 'manual';
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS autopay_sweep_cadence text NOT NULL DEFAULT 'off';
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS autopay_last_swept_at timestamptz;

-- qb_payments: Stripe charge linkage + in-app collector
ALTER TABLE qb_payments ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;
ALTER TABLE qb_payments ADD COLUMN IF NOT EXISTS collected_by uuid;

-- bookings: auto-collect audit trail
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS autopay_attempted_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS autopay_last_error text;

-- payment_methods: saved cards (tokens only — no PAN/CVC ever stored)
CREATE TABLE IF NOT EXISTS payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL,
  stripe_payment_method_id text NOT NULL,
  brand text,
  last4 text,
  exp_month integer,
  exp_year integer,
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_methods_resident_active_idx ON payment_methods (resident_id) WHERE active = true;
CREATE UNIQUE INDEX IF NOT EXISTS payment_methods_stripe_pm_unique ON payment_methods (stripe_payment_method_id);
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all ON payment_methods;
CREATE POLICY "service_role_all" ON payment_methods FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- drizzle/0017_services_source.sql
-- ============================================================
-- Services origin flag: distinguish the facility's real price-list catalog from
-- ad-hoc services bookkeepers create while logging. Idempotent.
-- Apply: psql "$DIRECT_URL" -f drizzle/0017_services_source.sql

ALTER TABLE services ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'price_list';

-- Backfill: services that match the exact shape the OCR daily-log importer creates
-- (price 0, no category, plain fixed pricing) were almost certainly bookkeeper-made.
-- Everything else stays 'price_list'. Admins can fix edge cases via the Promote action.
UPDATE services
SET source = 'ocr_import'
WHERE source = 'price_list'
  AND price_cents = 0
  AND category IS NULL
  AND pricing_type = 'fixed'
  AND addon_amount_cents IS NULL
  AND pricing_tiers IS NULL
  AND pricing_options IS NULL;

CREATE INDEX IF NOT EXISTS services_facility_source_idx ON services (facility_id, source) WHERE active = true;

-- ============================================================
-- drizzle/0018_ocr_batch_payload.sql
-- ============================================================
-- OCR daily-log scans: store the confirmed review sheets so an "Undo & edit" can
-- reopen the scan review pre-filled (change facility/stylist, re-import). Idempotent.
-- Apply: psql "$DIRECT_URL" -f drizzle/0018_ocr_batch_payload.sql

ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS review_payload jsonb;

-- ============================================================
-- drizzle/0019_coverage_approval.sql
-- ============================================================
-- 13F: time-off approval workflow — coverage requests now start 'pending' and an
-- admin approves (→ 'open') or denies (→ 'denied') before the substitute search.
-- Existing rows are untouched ('open' = already approved). Idempotent.
-- Apply: psql "$DIRECT_URL" -f drizzle/0019_coverage_approval.sql

ALTER TABLE coverage_requests ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES profiles(id);
ALTER TABLE coverage_requests ADD COLUMN IF NOT EXISTS approved_at timestamp;
ALTER TABLE coverage_requests ADD COLUMN IF NOT EXISTS denied_reason text;

-- ============================================================
-- drizzle/0020_push_platform.sql
-- ============================================================
-- N3: native push (FCM). push_subscriptions gains a platform discriminator and the
-- web-push keys become nullable (native rows store the FCM device token in
-- `endpoint` and have no p256dh/auth). Idempotent.
-- Apply: psql "$DIRECT_URL" -f drizzle/0020_push_platform.sql
-- Keep in sync with src/lib/push-ddl.ts::ensurePushSchema().

ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'web';
ALTER TABLE push_subscriptions ALTER COLUMN p256dh DROP NOT NULL;
ALTER TABLE push_subscriptions ALTER COLUMN auth DROP NOT NULL;

-- ============================================================
-- drizzle/0021_qb_payments_pi_unique.sql
-- ============================================================
-- Audit 2026-07: idempotency backstop for card collections.
-- The in-app confirm POST and the payment_intent.succeeded webhook both call
-- finalizeInAppPayment; without a unique key on the PaymentIntent id a race
-- double-records the payment and over-applies invoices. Partial index — legacy
-- rows with NULL PI are unaffected. Idempotent; also self-bootstrapped by
-- src/lib/payments-ddl.ts (keep in sync).
CREATE UNIQUE INDEX IF NOT EXISTS qb_payments_stripe_pi_unique
  ON qb_payments (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- ============================================================
-- drizzle/0022_notifications.sql
-- ============================================================
-- Phase 15 F1 — in-app notification inbox.
-- Idempotent; also self-bootstrapped by src/lib/notifications-ddl.ts (keep in sync).
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  facility_id uuid REFERENCES facilities(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  url text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notifications' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON notifications FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- drizzle/0023_waitlist.sql
-- ============================================================
-- Phase 15 F4 — cancellation waitlist.
-- Idempotent; also self-bootstrapped by src/lib/waitlist-ddl.ts (keep in sync).
CREATE TABLE IF NOT EXISTS waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  resident_id uuid REFERENCES residents(id),
  resident_name text NOT NULL,
  room_number text,
  service_id uuid REFERENCES services(id),
  service_name text,
  preferred_stylist_id uuid REFERENCES stylists(id),
  earliest_date date NOT NULL,
  latest_date date,
  notes text,
  created_by uuid NOT NULL REFERENCES profiles(id),
  status text NOT NULL DEFAULT 'pending',
  booking_id uuid REFERENCES bookings(id),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS waitlist_facility_pending_idx ON waitlist_entries (facility_id, earliest_date) WHERE status = 'pending';
ALTER TABLE waitlist_entries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='waitlist_entries' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON waitlist_entries FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- drizzle/0024_monthly_report_flag.sql
-- ============================================================
-- Phase 16 G4 — auto-emailed monthly facility reports (opt-in per facility).
-- Idempotent; also self-bootstrapped by src/lib/monthly-report-ddl.ts (keep in sync).
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS monthly_report_enabled boolean NOT NULL DEFAULT false;

-- ============================================================
-- drizzle/0025_resident_photos.sql
-- ============================================================
-- Phase 16 G11 — resident style gallery + booking photos.
-- Idempotent; also self-bootstrapped by src/lib/resident-photos-ddl.ts (keep in sync).
CREATE TABLE IF NOT EXISTS resident_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  path text NOT NULL,
  caption text,
  shared_with_family boolean NOT NULL DEFAULT false,
  created_by uuid,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resident_photos_resident_created_idx ON resident_photos (resident_id, created_at DESC);
ALTER TABLE resident_photos ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='resident_photos' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON resident_photos FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- drizzle/0026_user_prefs.sql
-- ============================================================
-- Phase 19 — server-synced per-user preferences (mobile nav tab picks).
-- New TABLE (not a column on profiles) so deploys are order-proof: full-row
-- selects on existing tables never see an unknown column.
-- Idempotent; also self-bootstrapped by src/lib/user-prefs-ddl.ts (keep in sync).
CREATE TABLE IF NOT EXISTS user_prefs (
  user_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  mobile_nav jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_prefs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_prefs' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON user_prefs FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- drizzle/0027_bookings_resident_idx.sql
-- ============================================================
-- Phase 25 — covering index for per-resident booking aggregates.
-- Serves: residents page GROUP BY resident_id stats, due-for-visit's
-- window function (PARTITION BY resident_id ORDER BY start_time), and
-- peek-drawer last-visit lookups.
-- Additive + idempotent: safe to apply at any time, before or after deploy.
-- Apply: psql "$DIRECT_URL" -f drizzle/0027_bookings_resident_idx.sql
--   (or: npx dotenv -e .env.local -- npx drizzle-kit push)

CREATE INDEX IF NOT EXISTS bookings_facility_resident_start_idx
  ON bookings (facility_id, resident_id, start_time DESC);

-- ============================================================
-- drizzle/0028_resident_merge_log.sql (P36 — self-bootstrapped)
-- ============================================================
-- P36 — audit row per resident duplicate-merge. Idempotent; also
-- self-bootstrapped by src/lib/resident-merge-ddl.ts (keep in sync).
CREATE TABLE IF NOT EXISTS resident_merge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  performed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL,
  keep_resident_id uuid,
  merged_resident_id uuid,
  merged_resident_name text NOT NULL,
  moved jsonb NOT NULL DEFAULT '{}'::jsonb,
  fields_inherited text[] NOT NULL DEFAULT '{}'::text[],
  cards_left_behind integer NOT NULL DEFAULT 0,
  notes text
);

ALTER TABLE resident_merge_log ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'resident_merge_log' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON resident_merge_log FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- drizzle/0029_resident_preferences.sql (P36 — self-bootstrapped)
-- ============================================================
-- P36 — family-editable care preferences (NEW table per the hot-table rule;
-- self-bootstrapped by src/lib/resident-prefs-ddl.ts — keep in sync).
CREATE TABLE IF NOT EXISTS resident_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL UNIQUE REFERENCES residents(id) ON DELETE CASCADE,
  style_notes text,
  allergy_notes text,
  preferred_stylist_id uuid REFERENCES stylists(id) ON DELETE SET NULL,
  visit_frequency text,
  email_reminders boolean NOT NULL DEFAULT true,
  sms_reminders boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE resident_preferences ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'resident_preferences' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON resident_preferences FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- drizzle/0030_feedback_reply.sql (P37 — self-bootstrapped)
-- ============================================================
-- P37 — two-way feedback replies (keep in sync with src/lib/feedback-ddl.ts)
ALTER TABLE feedback_submissions ADD COLUMN IF NOT EXISTS reply text;
ALTER TABLE feedback_submissions ADD COLUMN IF NOT EXISTS replied_at timestamptz;
ALTER TABLE feedback_submissions ADD COLUMN IF NOT EXISTS replied_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE feedback_submissions ADD COLUMN IF NOT EXISTS reply_read_at timestamptz;
