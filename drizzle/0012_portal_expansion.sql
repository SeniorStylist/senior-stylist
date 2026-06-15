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
