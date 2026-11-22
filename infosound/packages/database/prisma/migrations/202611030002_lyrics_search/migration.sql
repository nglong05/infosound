-- Derive the search index from saved cues; never change the original lyrics.
BEGIN;

CREATE FUNCTION infosound_search_normalize(value TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT btrim(regexp_replace(lower(public.infosound_unaccent(normalize(coalesce(value,''),NFKC))), '[^[:alnum:]]+', ' ', 'g'))
$$;

CREATE FUNCTION infosound_lyrics_search_text(value JSONB) RETURNS TEXT
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT public.infosound_search_normalize(coalesce(string_agg(cue->>'text',' ' ORDER BY ordinal),''))
  FROM jsonb_array_elements(value) WITH ORDINALITY AS cues(cue,ordinal)
$$;

ALTER TABLE track_lyrics ADD COLUMN search_text TEXT
  GENERATED ALWAYS AS (public.infosound_lyrics_search_text(lines)) STORED NOT NULL;
CREATE INDEX track_lyrics_search_trgm ON track_lyrics USING gin (search_text gin_trgm_ops);

REVOKE ALL ON FUNCTION infosound_search_normalize(TEXT),infosound_lyrics_search_text(JSONB) FROM PUBLIC,infosound_audio,infosound_background;
GRANT EXECUTE ON FUNCTION infosound_search_normalize(TEXT),infosound_lyrics_search_text(JSONB) TO infosound_api;

COMMIT;
