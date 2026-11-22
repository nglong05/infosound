BEGIN;
-- Every pre-existing comment was public; the old schema has no hidden/deleted
-- state. Preserve those rows as LEGACY and never backfill AI jobs for them.
ALTER TABLE track_comments
  ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'VISIBLE'
    CHECK (moderation_status IN ('PENDING','VISIBLE','HELD','HIDDEN','DELETED')),
  ADD COLUMN content_version INTEGER NOT NULL DEFAULT 1 CHECK(content_version>0),
  ADD COLUMN moderation_revision INTEGER NOT NULL DEFAULT 1 CHECK(moderation_revision>0),
  ADD COLUMN decision_source TEXT NOT NULL DEFAULT 'LEGACY'
    CHECK(decision_source IN ('LEGACY','SYSTEM','AI','MANUAL','AUTHOR')),
  ADD COLUMN decision_at TIMESTAMPTZ,
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD COLUMN moderation_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE track_comments ALTER COLUMN moderation_status SET DEFAULT 'PENDING';
ALTER TABLE track_comments ALTER COLUMN decision_source SET DEFAULT 'SYSTEM';
CREATE INDEX track_comments_visible_idx ON track_comments(track_id,source_version,parent_id,created_at DESC,id)
  WHERE moderation_status='VISIBLE' AND deleted_at IS NULL;
CREATE TABLE comment_moderation_permissions (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK(permission IN ('moderation.read','moderation.review','moderation.retry')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,permission)
);
-- No default grants/accounts. Provision an existing user explicitly as owner.
CREATE TABLE comment_moderation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID NOT NULL REFERENCES track_comments(id) ON DELETE CASCADE,
  content_version INTEGER NOT NULL,
  moderation_revision INTEGER NOT NULL,
  policy_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  model TEXT NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  repeated BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','RUNNING','DONE','STALE')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
  manual_retries INTEGER NOT NULL DEFAULT 0 CHECK(manual_retries BETWEEN 0 AND 2),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deadline TIMESTAMPTZ NOT NULL,
  lease_expires_at TIMESTAMPTZ,
  run_token UUID,
  error_code TEXT,
  result JSONB,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE(comment_id,content_version,moderation_revision,policy_version,prompt_version)
);
CREATE INDEX comment_moderation_dispatch_idx ON comment_moderation_jobs(status,next_attempt_at,lease_expires_at);
CREATE TABLE comment_moderation_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID NOT NULL REFERENCES track_comments(id) ON DELETE CASCADE,
  content_version INTEGER NOT NULL,
  moderation_revision INTEGER NOT NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason VARCHAR(300) NOT NULL,
  job_id UUID REFERENCES comment_moderation_jobs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(job_id,action)
);
CREATE INDEX comment_moderation_audit_target_idx ON comment_moderation_audit(comment_id,created_at DESC);
CREATE TABLE comment_moderation_reviews (
  comment_id UUID NOT NULL REFERENCES track_comments(id) ON DELETE CASCADE,
  content_version INTEGER NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  PRIMARY KEY(comment_id,content_version)
);
CREATE TABLE comment_moderation_rate (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  minute_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('minute',now()),
  minute_count INTEGER NOT NULL DEFAULT 0,
  hour_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('hour',now()),
  hour_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE comment_moderation_budget (
  scope TEXT PRIMARY KEY,
  minute_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('minute',now()),
  minute_count INTEGER NOT NULL DEFAULT 0,
  day_at DATE NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  day_count INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  circuit_until TIMESTAMPTZ,
  active_until TIMESTAMPTZ,
  active_token UUID
);
COMMIT;
