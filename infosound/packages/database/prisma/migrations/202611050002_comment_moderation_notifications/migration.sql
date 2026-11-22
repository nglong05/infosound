BEGIN;
-- Separate moderation delivery records preserve the existing release-only
-- notifications/release-event relation and all previously delivered entries.
CREATE TABLE comment_moderation_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment_id UUID NOT NULL REFERENCES track_comments(id) ON DELETE CASCADE,
  content_version INTEGER NOT NULL CHECK (content_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  UNIQUE(comment_id,content_version)
);
CREATE INDEX comment_moderation_notifications_inbox_idx
  ON comment_moderation_notifications(recipient_id,created_at DESC,id)
  WHERE resolved_at IS NULL;
COMMIT;
