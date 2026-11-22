BEGIN;

-- Each existing checkpoint proves at least one counted listen. Earlier repetitions
-- were never stored per user and cannot be reconstructed from the aggregate.
ALTER TABLE track_listens ADD COLUMN qualified_plays INTEGER NOT NULL DEFAULT 1
  CHECK (qualified_plays>=1);
CREATE INDEX track_listens_fans_idx ON track_listens (track_id,qualified_plays DESC,last_counted_at DESC,user_id);

CREATE TABLE track_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_version INTEGER NOT NULL CHECK (source_version>=1),
  body VARCHAR(2000) NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  at_seconds DOUBLE PRECISION NOT NULL CHECK (at_seconds>=0 AND at_seconds<=900 AND at_seconds<>'NaN'::float8),
  parent_id UUID REFERENCES track_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (parent_id IS NULL OR parent_id<>id)
);
CREATE INDEX track_comments_page_idx ON track_comments(track_id,source_version,parent_id,created_at DESC,id);
CREATE INDEX track_comments_markers_idx ON track_comments(track_id,source_version,at_seconds,id);

-- Defense in depth for imports/owner operations too: only one reply level and
-- an exact parent track/source/time; no reply can attach to an unrelated song.
CREATE FUNCTION infosound_check_comment_parent() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE parent public.track_comments;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.track_id,NEW.user_id,NEW.source_version,NEW.at_seconds,NEW.parent_id)
    IS DISTINCT FROM (OLD.track_id,OLD.user_id,OLD.source_version,OLD.at_seconds,OLD.parent_id) THEN
    RAISE EXCEPTION 'immutable comment scope' USING ERRCODE='23514';
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    SELECT * INTO parent FROM public.track_comments WHERE id=NEW.parent_id;
    IF NOT FOUND OR parent.parent_id IS NOT NULL OR parent.track_id<>NEW.track_id
      OR parent.source_version<>NEW.source_version OR parent.at_seconds<>NEW.at_seconds THEN
      RAISE EXCEPTION 'invalid comment parent' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER track_comments_parent_check BEFORE INSERT OR UPDATE ON track_comments
  FOR EACH ROW EXECUTE FUNCTION infosound_check_comment_parent();

CREATE TABLE track_comment_likes (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment_id UUID NOT NULL REFERENCES track_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,comment_id)
);
CREATE INDEX track_comment_likes_target_idx ON track_comment_likes(comment_id);

CREATE FUNCTION infosound_valid_waveform_peaks(value JSONB) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path=pg_catalog AS $$
  SELECT CASE WHEN jsonb_typeof(value)='array' THEN
    jsonb_array_length(value)=512 AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(value) item
      WHERE NOT CASE WHEN jsonb_typeof(item)='number'
        THEN (item::text)::numeric BETWEEN 0 AND 1 ELSE false END
    ) ELSE false END;
$$;
CREATE TABLE track_waveforms (
  track_id UUID PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  source_version INTEGER NOT NULL CHECK (source_version>=1),
  pipeline_version INTEGER NOT NULL CHECK (pipeline_version>=1),
  playback_asset_id UUID NOT NULL,
  status "TaskStatus" NOT NULL DEFAULT 'QUEUED',
  duration DOUBLE PRECISION CHECK (duration>0 AND duration<=900 AND duration<>'NaN'::float8),
  peaks JSONB,
  run_token UUID,
  lease_expires_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  error_code TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status<>'SUCCEEDED' OR (duration IS NOT NULL AND peaks IS NOT NULL AND infosound_valid_waveform_peaks(peaks)))
);
CREATE INDEX track_waveforms_reconcile_idx ON track_waveforms(status,next_attempt_at,lease_expires_at);

REVOKE ALL ON FUNCTION infosound_check_comment_parent(),infosound_valid_waveform_peaks(JSONB) FROM PUBLIC;
COMMIT;
