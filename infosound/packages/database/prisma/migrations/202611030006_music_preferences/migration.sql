BEGIN;

CREATE TABLE music_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  genre_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  artist_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT music_preferences_genre_bounds CHECK (
    cardinality(genre_ids)<=50 AND array_position(genre_ids,NULL) IS NULL
    AND (cardinality(genre_ids)=0 OR array_ndims(genre_ids)=1)
  ),
  CONSTRAINT music_preferences_artist_bounds CHECK (
    cardinality(artist_ids)<=50 AND array_position(artist_ids,NULL) IS NULL
    AND (cardinality(artist_ids)=0 OR array_ndims(artist_ids)=1)
  )
);

COMMIT;
