CREATE TABLE email_otp_challenges (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  request_hash VARCHAR(64) NOT NULL UNIQUE CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  email VARCHAR(254) NOT NULL,
  code_hash VARCHAR(64) NOT NULL CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  display_name VARCHAR(80) NOT NULL,
  role "Role" NOT NULL DEFAULT 'USER',
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX email_otp_challenges_email_created_at_idx ON email_otp_challenges(email,created_at);
CREATE INDEX email_otp_challenges_expires_at_idx ON email_otp_challenges(expires_at);
