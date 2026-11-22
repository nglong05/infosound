#!/usr/bin/env bash
set -euo pipefail
export OWNER_PASSWORD=$(cat /run/secrets/db_owner_password)
export API_PASSWORD=$(cat /run/secrets/db_api_password)
export AUDIO_PASSWORD=$(cat /run/secrets/db_audio_password)
export BACKGROUND_PASSWORD=$(cat /run/secrets/db_background_password)
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 <<'SQL'
\getenv owner_password OWNER_PASSWORD
\getenv api_password API_PASSWORD
\getenv audio_password AUDIO_PASSWORD
\getenv background_password BACKGROUND_PASSWORD
\getenv db_name POSTGRES_DB
CREATE ROLE infosound_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'owner_password';
CREATE ROLE infosound_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'api_password';
CREATE ROLE infosound_audio LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'audio_password';
CREATE ROLE infosound_background LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'background_password';
REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db_name" TO infosound_owner, infosound_api, infosound_audio, infosound_background;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO infosound_owner;
GRANT USAGE ON SCHEMA public TO infosound_api, infosound_audio, infosound_background;
SQL
unset OWNER_PASSWORD API_PASSWORD AUDIO_PASSWORD BACKGROUND_PASSWORD
