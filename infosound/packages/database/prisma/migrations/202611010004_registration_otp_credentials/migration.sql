ALTER TABLE users ADD COLUMN username VARCHAR(30);
ALTER TABLE users ADD CONSTRAINT users_username_format CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,30}$');
CREATE UNIQUE INDEX users_username_key ON users(username);

-- Retire every earlier passwordless-login challenge and legacy link before
-- enabling registration-only codes with immutable hashed credentials.
UPDATE email_otp_challenges SET consumed_at=NOW(),expires_at=LEAST(expires_at,NOW()) WHERE consumed_at IS NULL;
UPDATE pending_registrations SET consumed_at=NOW(),expires_at=LEAST(expires_at,NOW()) WHERE consumed_at IS NULL;
ALTER TABLE email_otp_challenges ADD COLUMN username VARCHAR(30);
ALTER TABLE email_otp_challenges ADD COLUMN password_hash TEXT;
ALTER TABLE email_otp_challenges ADD COLUMN last_sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE email_otp_challenges ADD CONSTRAINT email_otp_username_format CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,30}$');
ALTER TABLE email_otp_challenges ADD CONSTRAINT email_otp_registration_credentials CHECK (consumed_at IS NOT NULL OR (username IS NOT NULL AND password_hash IS NOT NULL));
ALTER TABLE email_otp_challenges ADD CONSTRAINT email_otp_password_hash_format CHECK (password_hash IS NULL OR password_hash LIKE '$argon2id$%');
-- Expired reservations are consumed by request processing or periodic cleanup.
-- Partial unique indexes make active reservations durable across API restarts.
CREATE UNIQUE INDEX email_otp_challenges_active_email_key ON email_otp_challenges(email) WHERE consumed_at IS NULL;
CREATE UNIQUE INDEX email_otp_challenges_active_username_key ON email_otp_challenges(username) WHERE consumed_at IS NULL;
