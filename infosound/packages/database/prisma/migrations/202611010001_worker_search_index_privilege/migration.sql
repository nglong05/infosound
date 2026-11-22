-- PostgreSQL evaluates indexed expressions during worker track updates.
-- This pure text function grants no access to authentication tables.
GRANT EXECUTE ON FUNCTION public.infosound_unaccent(text)
TO infosound_audio, infosound_background;
