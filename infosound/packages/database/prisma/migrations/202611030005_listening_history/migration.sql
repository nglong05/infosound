-- Keep a song's latest qualified listen separately from its30-minute count checkpoint.
-- Existing checkpoints are the only historical data available; do not invent events.
BEGIN;

ALTER TABLE track_listens ADD COLUMN last_listened_at TIMESTAMPTZ;
UPDATE track_listens SET last_listened_at=last_counted_at;
ALTER TABLE track_listens ALTER COLUMN last_listened_at SET DEFAULT now();
ALTER TABLE track_listens ALTER COLUMN last_listened_at SET NOT NULL;
CREATE INDEX track_listens_history_idx ON track_listens (user_id,last_listened_at DESC,track_id);

COMMIT;
