-- Cumulative qualified listens start at zero; no historical plays are invented.
-- Only the latest dedupe checkpoint per user/track is retained, not event history.
BEGIN;

ALTER TABLE tracks ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0 CHECK (play_count >= 0);
CREATE INDEX tracks_popular_idx ON tracks (publication_state,processing_state,play_count DESC,published_at DESC,id);

CREATE TABLE track_listens (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  source_version INTEGER NOT NULL CHECK (source_version >= 1),
  last_counted_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id,track_id)
);

REVOKE ALL ON track_listens FROM PUBLIC,infosound_api,infosound_audio,infosound_background;
GRANT SELECT,INSERT,UPDATE,DELETE ON track_listens TO infosound_api;

COMMIT;
