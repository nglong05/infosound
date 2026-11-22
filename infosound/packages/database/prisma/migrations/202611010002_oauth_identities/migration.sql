-- OAuth identities are keyed by the provider's immutable subject, never by email.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_password_requires_email CHECK (password_hash IS NULL OR email IS NOT NULL);

CREATE TABLE external_identities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(16) NOT NULL CHECK (provider IN ('google','microsoft','facebook')),
  subject VARCHAR(512) NOT NULL CHECK (length(subject)>0),
  provider_email VARCHAR(254),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider,subject)
);
CREATE INDEX external_identities_user_id_idx ON external_identities(user_id);

CREATE TABLE oauth_flows (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider VARCHAR(16) NOT NULL CHECK (provider IN ('google','microsoft','facebook')),
  role "Role" NOT NULL DEFAULT 'USER',
  state_hash VARCHAR(64) NOT NULL UNIQUE CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  binding_hash VARCHAR(64) NOT NULL CHECK (binding_hash ~ '^[a-f0-9]{64}$'),
  nonce_hash VARCHAR(64) CHECK (nonce_hash IS NULL OR nonce_hash ~ '^[a-f0-9]{64}$'),
  code_verifier VARCHAR(128),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((provider='facebook' AND code_verifier IS NULL AND nonce_hash IS NULL)
    OR (provider IN ('google','microsoft') AND length(code_verifier)>=43 AND nonce_hash IS NOT NULL))
);
CREATE INDEX oauth_flows_expires_at_idx ON oauth_flows(expires_at);
