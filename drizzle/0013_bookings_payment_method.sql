-- Add free-text payment method to bookings (idempotent)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_method text;
