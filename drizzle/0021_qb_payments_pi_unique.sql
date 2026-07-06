-- Audit 2026-07: idempotency backstop for card collections.
-- The in-app confirm POST and the payment_intent.succeeded webhook both call
-- finalizeInAppPayment; without a unique key on the PaymentIntent id a race
-- double-records the payment and over-applies invoices. Partial index — legacy
-- rows with NULL PI are unaffected. Idempotent; also self-bootstrapped by
-- src/lib/payments-ddl.ts (keep in sync).
CREATE UNIQUE INDEX IF NOT EXISTS qb_payments_stripe_pi_unique
  ON qb_payments (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
