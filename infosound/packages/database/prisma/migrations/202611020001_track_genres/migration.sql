-- Additive taxonomy: preserve the original scalar during backfill and retain
-- unknown labels privately rather than guessing their meaning or discarding them.
BEGIN;

CREATE TABLE genres (
  id TEXT PRIMARY KEY CHECK (length(id) <= 80 AND id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  aliases TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  is_selectable BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  CONSTRAINT genres_aliases_bounded CHECK (cardinality(aliases) <= 32 AND array_position(aliases,NULL) IS NULL)
);

INSERT INTO genres(id,name,aliases,sort_order) VALUES
 ('pop','Pop',ARRAY['popular','nhạc pop'],10),
 ('r-and-b','R&B',ARRAY['rnb','r&b','r and b','rhythm and blues'],20),
 ('hip-hop','Hip-Hop',ARRAY['hiphop','hip hop','hip-hop'],30),
 ('rap','Rap',ARRAY['rap'],40),
 ('latin','Latinh',ARRAY['latin','latino','latinh','nhạc latin'],50),
 ('disco','Disco',ARRAY['disco'],60),
 ('rock','Rock',ARRAY['rock','nhạc rock'],70),
 ('electronic','Electronic',ARRAY['electronic','điện tử','dien tu'],80),
 ('edm','EDM',ARRAY['electronic dance music','edm'],90),
 ('dance','Dance',ARRAY['dance'],100),
 ('house','House',ARRAY['house'],110),
 ('techno','Techno',ARRAY['techno'],120),
 ('acoustic','Acoustic',ARRAY['acoustic','mộc','moc'],130),
 ('ambient','Ambient',ARRAY['ambient'],140),
 ('jazz','Jazz',ARRAY['jazz'],150),
 ('blues','Blues',ARRAY['blues'],160),
 ('soul','Soul',ARRAY['soul'],170),
 ('funk','Funk',ARRAY['funk'],180),
 ('classical','Classical',ARRAY['classical','cổ điển','co dien'],190),
 ('country','Country',ARRAY['country','đồng quê','dong que'],200),
 ('folk','Folk',ARRAY['folk','dân gian','dan gian'],210),
 ('indie','Indie',ARRAY['indie'],220),
 ('alternative','Alternative',ARRAY['alternative'],230),
 ('reggae','Reggae',ARRAY['reggae'],240),
 ('metal','Metal',ARRAY['metal','heavy metal'],250),
 ('punk','Punk',ARRAY['punk'],260),
 ('ballad','Ballad',ARRAY['ballad'],270),
 ('lo-fi','Lo-fi',ARRAY['lofi','lo fi','lo-fi'],280),
 ('soundtrack','Soundtrack',ARRAY['soundtrack','ost','nhạc phim','nhac phim'],290),
 ('world','World',ARRAY['world','world music'],300),
 ('k-pop','K-pop',ARRAY['kpop','k pop','k-pop'],310),
 ('v-pop','V-pop',ARRAY['vpop','v pop','v-pop','nhạc việt','nhac viet'],320);

CREATE TABLE track_genres (
  track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  genre_id TEXT NOT NULL REFERENCES genres(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position >= 0 AND position < 8),
  PRIMARY KEY (track_id,genre_id),
  UNIQUE (track_id,position)
);
CREATE INDEX track_genres_genre_id_track_id_idx ON track_genres(genre_id,track_id);

CREATE FUNCTION infosound_genre_alias_key(value TEXT) RETURNS TEXT
LANGUAGE SQL IMMUTABLE STRICT AS $$
 SELECT lower(regexp_replace(btrim(value,E' \t\r\n\f\013'),'[[:space:]]+',' ','g'))
$$;

-- These explicit old composites are deliberate mappings, not a whitespace split.
CREATE FUNCTION infosound_known_genre_ids(value TEXT) RETURNS TEXT[]
LANGUAGE plpgsql STABLE STRICT AS $$
DECLARE
  alias_key TEXT := public.infosound_genre_alias_key(value);
  matched TEXT;
BEGIN
  CASE alias_key
    WHEN 'pop r&b' THEN RETURN ARRAY['pop','r-and-b'];
    WHEN 'disco pop' THEN RETURN ARRAY['disco','pop'];
    WHEN 'latinh hiphop' THEN RETURN ARRAY['latin','hip-hop'];
    WHEN 'latin hiphop' THEN RETURN ARRAY['latin','hip-hop'];
    WHEN 'r&b hiphop rap' THEN RETURN ARRAY['r-and-b','hip-hop','rap'];
    ELSE NULL;
  END CASE;
  SELECT g.id INTO matched FROM public.genres g
   WHERE g.is_selectable AND EXISTS (
    SELECT 1 FROM unnest(g.aliases || ARRAY[g.id,g.name]) AS a(label)
     WHERE public.infosound_genre_alias_key(a.label)=alias_key
   ) ORDER BY g.sort_order,g.id LIMIT 1;
  IF matched IS NULL THEN RETURN NULL; END IF;
  RETURN ARRAY[matched];
END
$$;

-- Shared by migration and legacy API requests. Split commas/semicolons only if
-- every component is recognized; otherwise preserve the complete original label.
CREATE FUNCTION infosound_resolve_legacy_genre(value TEXT) RETURNS TEXT[]
LANGUAGE plpgsql STABLE STRICT AS $$
DECLARE
  label TEXT := btrim(value,E' \t\r\n\f\013');
  known TEXT[];
  part TEXT;
  item TEXT;
  result TEXT[] := ARRAY[]::TEXT[];
  fallback TEXT[];
BEGIN
  IF label='' THEN RETURN result; END IF;
  fallback := ARRAY['legacy-' || md5(label)];
  known := public.infosound_known_genre_ids(label);
  IF known IS NOT NULL THEN RETURN known; END IF;
  IF label !~ '[,;]' THEN RETURN fallback; END IF;
  FOREACH part IN ARRAY regexp_split_to_array(label,'[,;]') LOOP
    IF btrim(part,E' \t\r\n\f\013')='' THEN CONTINUE; END IF;
    known := public.infosound_known_genre_ids(part);
    IF known IS NULL THEN RETURN fallback; END IF;
    FOREACH item IN ARRAY known LOOP
      IF NOT item=ANY(result) THEN result:=array_append(result,item); END IF;
    END LOOP;
    IF cardinality(result)>8 THEN RETURN fallback; END IF;
  END LOOP;
  IF cardinality(result)=0 THEN RETURN fallback; END IF;
  RETURN result;
END
$$;

INSERT INTO genres(id,name,aliases,is_selectable,sort_order)
 SELECT DISTINCT 'legacy-' || md5(btrim(t.genre,E' \t\r\n\f\013')),
        btrim(t.genre,E' \t\r\n\f\013'),ARRAY[]::TEXT[],false,10000
 FROM tracks t
 WHERE btrim(t.genre,E' \t\r\n\f\013')<>''
   AND public.infosound_resolve_legacy_genre(t.genre)=ARRAY['legacy-' || md5(btrim(t.genre,E' \t\r\n\f\013'))];

INSERT INTO track_genres(track_id,genre_id,position)
 SELECT t.id,g.genre_id,(g.ordinality-1)::INTEGER
 FROM tracks t
 CROSS JOIN LATERAL unnest(public.infosound_resolve_legacy_genre(t.genre)) WITH ORDINALITY AS g(genre_id,ordinality);

REVOKE ALL ON FUNCTION infosound_genre_alias_key(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION infosound_known_genre_ids(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION infosound_resolve_legacy_genre(TEXT) FROM PUBLIC;

COMMIT;
