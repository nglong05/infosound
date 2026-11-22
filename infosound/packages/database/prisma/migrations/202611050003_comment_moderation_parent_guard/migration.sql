BEGIN;
-- Lock the parent on insertion so a concurrent subtree deletion either includes
-- the new reply or completes first and makes the insert fail. Updates preserve
-- immutable scope while allowing tombstones/audits after a parent is removed.
CREATE OR REPLACE FUNCTION infosound_check_comment_parent() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE parent public.track_comments;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.track_id,NEW.user_id,NEW.source_version,NEW.at_seconds,NEW.parent_id)
    IS DISTINCT FROM (OLD.track_id,OLD.user_id,OLD.source_version,OLD.at_seconds,OLD.parent_id) THEN
    RAISE EXCEPTION 'immutable comment scope' USING ERRCODE='23514';
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    IF TG_OP='INSERT' THEN
      SELECT * INTO parent FROM public.track_comments WHERE id=NEW.parent_id FOR UPDATE;
    ELSE
      SELECT * INTO parent FROM public.track_comments WHERE id=NEW.parent_id;
    END IF;
    IF NOT FOUND OR parent.parent_id IS NOT NULL OR parent.track_id<>NEW.track_id
      OR parent.source_version<>NEW.source_version OR parent.at_seconds<>NEW.at_seconds
      OR (TG_OP='INSERT' AND (parent.moderation_status<>'VISIBLE' OR parent.deleted_at IS NOT NULL)) THEN
      RAISE EXCEPTION 'invalid comment parent' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION infosound_check_comment_parent() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION infosound_check_comment_parent() TO infosound_api,infosound_background;
COMMIT;
