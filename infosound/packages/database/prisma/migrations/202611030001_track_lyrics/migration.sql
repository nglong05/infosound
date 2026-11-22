-- Additive line-synchronized lyrics. Existing tracks remain without lyrics;
-- source_version prevents lyrics from silently following replaced audio.
BEGIN;

CREATE FUNCTION infosound_valid_lyrics_lines(value JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog AS $$
DECLARE
  cue JSONB;
  position_ms NUMERIC;
  previous_ms INTEGER := -1;
  has_text BOOLEAN := false;
BEGIN
  IF jsonb_typeof(value) <> 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(value) < 1 OR jsonb_array_length(value) > 2000 THEN RETURN false; END IF;
  -- JSONB adds structural whitespace compared with the API's compact64KiB
  -- representation. This storage bound covers that expansion without widening
  -- the API's64KiB document or global HTTP parser limits.
  IF octet_length(value::TEXT) > 131072 THEN RETURN false; END IF;
  FOR cue IN SELECT jsonb_array_elements(value) LOOP
    IF jsonb_typeof(cue) <> 'object' THEN RETURN false; END IF;
    IF NOT cue ?& ARRAY['startMs','text'] OR cue - 'startMs' - 'text' <> '{}'::JSONB THEN RETURN false; END IF;
    IF jsonb_typeof(cue->'startMs') <> 'number' OR jsonb_typeof(cue->'text') <> 'string' THEN RETURN false; END IF;
    position_ms := (cue->>'startMs')::NUMERIC;
    IF position_ms < 0 OR position_ms > 86400000 OR position_ms <> trunc(position_ms) OR position_ms <= previous_ms THEN RETURN false; END IF;
    previous_ms := position_ms::INTEGER;
    IF length(cue->>'text') > 500 OR (cue->>'text') ~ E'[\x01-\x1f\x7f]' THEN RETURN false; END IF;
    IF length(btrim(cue->>'text')) > 0 THEN has_text := true; END IF;
  END LOOP;
  RETURN has_text;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END
$$;

CREATE TABLE track_lyrics (
  track_id UUID PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  source_version INTEGER NOT NULL CHECK (source_version >= 1),
  lines JSONB NOT NULL CHECK (public.infosound_valid_lyrics_lines(lines)),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

REVOKE ALL ON FUNCTION infosound_valid_lyrics_lines(JSONB) FROM PUBLIC;
REVOKE ALL ON track_lyrics FROM PUBLIC, infosound_api, infosound_audio, infosound_background;
GRANT EXECUTE ON FUNCTION infosound_valid_lyrics_lines(JSONB) TO infosound_api;
GRANT SELECT,INSERT,UPDATE,DELETE ON track_lyrics TO infosound_api;

COMMIT;
