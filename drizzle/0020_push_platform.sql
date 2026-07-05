-- N3: native push (FCM). push_subscriptions gains a platform discriminator and the
-- web-push keys become nullable (native rows store the FCM device token in
-- `endpoint` and have no p256dh/auth). Idempotent.
-- Apply: psql "$DIRECT_URL" -f drizzle/0020_push_platform.sql
-- Keep in sync with src/lib/push-ddl.ts::ensurePushSchema().

ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'web';
ALTER TABLE push_subscriptions ALTER COLUMN p256dh DROP NOT NULL;
ALTER TABLE push_subscriptions ALTER COLUMN auth DROP NOT NULL;
