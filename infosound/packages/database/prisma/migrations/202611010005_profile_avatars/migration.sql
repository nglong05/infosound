ALTER TABLE users ADD COLUMN avatar_key TEXT;
ALTER TABLE users ADD COLUMN avatar_version_id TEXT;
ALTER TABLE users ADD COLUMN avatar_checksum VARCHAR(64);
ALTER TABLE users ADD COLUMN avatar_size BIGINT;
ALTER TABLE users ADD COLUMN avatar_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN image_upload_window_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN image_upload_window_bytes BIGINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN image_upload_window_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD CONSTRAINT users_image_quota_nonnegative CHECK (image_upload_window_bytes >= 0 AND image_upload_window_count >= 0);
ALTER TABLE users ADD CONSTRAINT users_avatar_revision_nonnegative CHECK (avatar_revision >= 0);
ALTER TABLE users ADD CONSTRAINT users_avatar_key_owned CHECK (avatar_key IS NULL OR avatar_key ~ ('^avatar/' || id::text || '/[a-f0-9-]{36}\.webp$'));
ALTER TABLE users ADD CONSTRAINT users_avatar_metadata_complete CHECK (
  (avatar_key IS NULL AND avatar_version_id IS NULL AND avatar_checksum IS NULL AND avatar_size IS NULL)
  OR (avatar_key IS NOT NULL AND avatar_checksum IS NOT NULL AND avatar_size IS NOT NULL AND avatar_checksum ~ '^[a-f0-9]{64}$' AND avatar_size > 0 AND avatar_size <= 2097152)
);
CREATE TABLE avatar_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  declared_size BIGINT NOT NULL CHECK (declared_size > 0 AND declared_size <= 5242880),
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
  filename VARCHAR(200) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  payload_hash VARCHAR(64) NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT avatar_uploads_object_owned CHECK (object_key ~ ('^images/avatar/' || user_id::text || '/[a-f0-9-]{36}$')),
  CONSTRAINT avatar_uploads_user_id_idempotency_key_key UNIQUE (user_id,idempotency_key)
);
CREATE INDEX avatar_uploads_expires_at_completed_at_idx ON avatar_uploads(expires_at,completed_at);
