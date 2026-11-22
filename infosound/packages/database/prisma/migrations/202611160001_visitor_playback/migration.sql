-- Anonymous qualified listens share the public counter, never account history/fans.
CREATE TABLE visitor_track_listens (
  visitor_hash CHAR(64) NOT NULL CHECK (visitor_hash ~ '^[0-9a-f]{64}$'),
  track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  source_version INTEGER NOT NULL CHECK (source_version >= 1),
  last_counted_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > last_counted_at),
  PRIMARY KEY (visitor_hash, track_id)
);
CREATE INDEX visitor_track_listens_expiry_idx ON visitor_track_listens(expires_at);
REVOKE ALL ON visitor_track_listens FROM PUBLIC,infosound_api,infosound_audio,infosound_background;
GRANT SELECT,INSERT,UPDATE,DELETE ON visitor_track_listens TO infosound_api;
