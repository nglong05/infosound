CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TYPE "Role" AS ENUM ('USER', 'AUTHOR');

CREATE TYPE "ProcessingState" AS ENUM ('DRAFT', 'QUEUED', 'PROCESSING', 'READY', 'FAILED');

CREATE TYPE "PublicationState" AS ENUM ('UNPUBLISHED', 'PUBLISHED');

CREATE TYPE "TaskStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED');

CREATE TYPE "AssetKind" AS ENUM ('ORIGINAL', 'PLAYBACK', 'ARTWORK');

CREATE TABLE "pending_registrations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "display_name" TEXT NOT NULL,
  "role" "Role" NOT NULL,
  "token_hash" TEXT NOT NULL UNIQUE,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "consumed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "password_hash" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "bio" TEXT NOT NULL DEFAULT '',
  "role" "Role" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "auth_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "user_id" UUID NOT NULL,
  "refresh_hash" TEXT NOT NULL UNIQUE,
  "previous_hash" TEXT,
  "rotated_at" TIMESTAMPTZ,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "revoked_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ON "auth_sessions" ("user_id");

CREATE TABLE "password_reset_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "user_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL UNIQUE,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "consumed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ON "password_reset_requests" ("user_id");

CREATE TABLE "tracks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "author_id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "genre" TEXT NOT NULL DEFAULT '',
  "download_enabled" BOOLEAN NOT NULL DEFAULT false,
  "processing_state" "ProcessingState" NOT NULL DEFAULT 'DRAFT',
  "publication_state" "PublicationState" NOT NULL DEFAULT 'UNPUBLISHED',
  "source_version" INTEGER NOT NULL DEFAULT 1,
  "pipeline_version" INTEGER NOT NULL DEFAULT 1,
  "duration" DOUBLE PRECISION,
  "sample_rate" INTEGER,
  "bit_depth" INTEGER,
  "channels" INTEGER,
  "source_codec" TEXT,
  "output_codec" TEXT,
  "lossy_transcode" BOOLEAN NOT NULL DEFAULT false,
  "provenance" TEXT NOT NULL DEFAULT 'USER_PROVIDED',
  "playback_asset_id" UUID,
  "artwork_asset_id" UUID,
  "published_at" TIMESTAMPTZ,
  "deleted_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ON "tracks" ("publication_state","processing_state","created_at","id");

CREATE INDEX ON "tracks" ("author_id","deleted_at");

CREATE TABLE "upload_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "user_id" UUID NOT NULL,
  "track_id" UUID NOT NULL,
  "source_version" INTEGER NOT NULL,
  "kind" "AssetKind" NOT NULL DEFAULT 'ORIGINAL',
  "object_key" TEXT NOT NULL UNIQUE,
  "bucket" TEXT NOT NULL DEFAULT 'uploads-quarantine',
  "declared_size" BIGINT NOT NULL,
  "content_type" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "task_id" UUID,
  "completed_at" TIMESTAMPTZ,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("user_id","idempotency_key")
);

CREATE INDEX ON "upload_sessions" ("expires_at","completed_at");

CREATE TABLE "track_assets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "track_id" UUID NOT NULL,
  "source_version" INTEGER NOT NULL,
  "pipeline_version" INTEGER NOT NULL,
  "kind" "AssetKind" NOT NULL,
  "bucket" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "version_id" TEXT,
  "checksum" TEXT,
  "size" BIGINT NOT NULL,
  "content_type" TEXT NOT NULL,
  "run_token" UUID,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("track_id","source_version","pipeline_version","kind")
);

CREATE TABLE "processing_tasks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "track_id" UUID NOT NULL,
  "source_version" INTEGER NOT NULL,
  "pipeline_version" INTEGER NOT NULL,
  "status" "TaskStatus" NOT NULL DEFAULT 'QUEUED',
  "source_bucket" TEXT NOT NULL,
  "source_key" TEXT NOT NULL,
  "source_version_id" TEXT,
  "run_token" UUID,
  "lease_expires_at" TIMESTAMPTZ,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "error_code" TEXT,
  "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("track_id","source_version","pipeline_version")
);

CREATE INDEX ON "processing_tasks" ("status","lease_expires_at");

CREATE TABLE "outbox_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "run_token" UUID,
  "lease_expires_at" TIMESTAMPTZ,
  "available_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "delivered_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ON "outbox_events" ("delivered_at","available_at");

CREATE TABLE "track_likes" (
  "user_id" UUID NOT NULL,
  "track_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("user_id","track_id")
);

CREATE INDEX ON "track_likes" ("track_id");

CREATE TABLE "artist_follows" (
  "user_id" UUID NOT NULL,
  "author_id" UUID NOT NULL,
  "notify_new_releases" BOOLEAN NOT NULL DEFAULT false,
  "subscribed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("user_id","author_id")
);

CREATE INDEX ON "artist_follows" ("author_id","notify_new_releases");

CREATE TABLE "playlists" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "owner_id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "is_public" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ON "playlists" ("owner_id");

CREATE TABLE "playlist_tracks" (
  "playlist_id" UUID NOT NULL,
  "track_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  PRIMARY KEY ("playlist_id","track_id")
);

CREATE INDEX ON "playlist_tracks" ("playlist_id","position");

CREATE TABLE "release_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "track_id" UUID NOT NULL UNIQUE,
  "author_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "recipient_id" UUID NOT NULL,
  "release_event_id" UUID NOT NULL,
  "read_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("recipient_id","release_event_id")
);

CREATE INDEX ON "notifications" ("recipient_id","created_at");

ALTER TABLE "auth_sessions" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;

ALTER TABLE "password_reset_requests" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;

ALTER TABLE "tracks" ADD FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE RESTRICT;

ALTER TABLE "upload_sessions" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT;

ALTER TABLE "upload_sessions" ADD FOREIGN KEY ("track_id") REFERENCES "tracks" ("id") ON DELETE RESTRICT;

ALTER TABLE "track_assets" ADD FOREIGN KEY ("track_id") REFERENCES "tracks" ("id") ON DELETE RESTRICT;

ALTER TABLE "processing_tasks" ADD FOREIGN KEY ("track_id") REFERENCES "tracks" ("id") ON DELETE RESTRICT;

ALTER TABLE "track_likes" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;

ALTER TABLE "track_likes" ADD FOREIGN KEY ("track_id") REFERENCES "tracks" ("id") ON DELETE RESTRICT;

ALTER TABLE "artist_follows" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;

ALTER TABLE "artist_follows" ADD FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE CASCADE;

ALTER TABLE "playlists" ADD FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE CASCADE;

ALTER TABLE "playlist_tracks" ADD FOREIGN KEY ("playlist_id") REFERENCES "playlists" ("id") ON DELETE CASCADE;

ALTER TABLE "playlist_tracks" ADD FOREIGN KEY ("track_id") REFERENCES "tracks" ("id") ON DELETE RESTRICT;

ALTER TABLE "release_events" ADD FOREIGN KEY ("track_id") REFERENCES "tracks" ("id") ON DELETE RESTRICT;

ALTER TABLE "notifications" ADD FOREIGN KEY ("recipient_id") REFERENCES "users" ("id") ON DELETE CASCADE;

ALTER TABLE "notifications" ADD FOREIGN KEY ("release_event_id") REFERENCES "release_events" ("id") ON DELETE RESTRICT;

ALTER TABLE tracks ADD CONSTRAINT tracks_source_positive CHECK (source_version > 0 AND pipeline_version > 0);

CREATE FUNCTION infosound_check_ready_asset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM tracks WHERE id=NEW.id AND processing_state='READY' AND playback_asset_id IS NULL) THEN
    RAISE EXCEPTION 'READY track requires a playback asset' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ready_has_playback AFTER INSERT OR UPDATE ON tracks
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION infosound_check_ready_asset();

ALTER TABLE track_assets ADD CONSTRAINT asset_size_positive CHECK (size > 0);

ALTER TABLE upload_sessions ADD CONSTRAINT upload_size_positive CHECK (declared_size > 0 AND declared_size <= 268435456);

ALTER TABLE playlist_tracks ADD CONSTRAINT playlist_position_positive CHECK (position >= 0);

ALTER TABLE artist_follows ADD CONSTRAINT no_self_follow CHECK (user_id <> author_id);

ALTER TABLE tracks ADD CONSTRAINT tracks_playback_asset_fk FOREIGN KEY (playback_asset_id) REFERENCES track_assets(id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE tracks ADD CONSTRAINT tracks_artwork_asset_fk FOREIGN KEY (artwork_asset_id) REFERENCES track_assets(id) DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION infosound_unaccent(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT public.unaccent('public.unaccent', $1) $$;

CREATE INDEX tracks_title_trgm ON tracks USING gin (infosound_unaccent(lower(title)) gin_trgm_ops);

CREATE INDEX users_name_trgm ON users USING gin (infosound_unaccent(lower(display_name)) gin_trgm_ops);

CREATE INDEX playlists_title_trgm ON playlists USING gin (infosound_unaccent(lower(title)) gin_trgm_ops);
