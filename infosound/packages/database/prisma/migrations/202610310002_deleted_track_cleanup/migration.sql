-- Keep the track row for unavailable playlist/like/notification references, but
-- retire its media only after retention and after every worker lease has expired.
CREATE INDEX tracks_deleted_cleanup_idx ON public.tracks (deleted_at)
WHERE deleted_at IS NOT NULL;

CREATE FUNCTION public.infosound_prepare_deleted_track_cleanup(target_track UUID, cutoff TIMESTAMPTZ)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  object_row RECORD;
  object_count INTEGER := 0;
BEGIN
  IF cutoff IS NULL OR cutoff > now() - INTERVAL '48 hours' THEN
    RAISE EXCEPTION 'Media cleanup retention must be at least 48 hours' USING ERRCODE='22023';
  END IF;

  -- Match the task -> track lock order used by audio claim/finalize. A worker
  -- cannot renew/commit while these rows are being retired.
  PERFORM id FROM public.processing_tasks
  WHERE track_id = target_track ORDER BY id FOR UPDATE;
  PERFORM id FROM public.tracks
  WHERE id = target_track AND deleted_at IS NOT NULL AND deleted_at <= cutoff
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF EXISTS (
    SELECT 1 FROM public.processing_tasks
    WHERE track_id = target_track AND status = 'PROCESSING'
      AND lease_expires_at > now()
  ) THEN RETURN 0; END IF;

  -- Queue durable, idempotent object deletion before removing any references.
  -- The dispatcher will re-check references across all remaining live records.
  FOR object_row IN
    SELECT DISTINCT bucket, key, version_id FROM (
      SELECT bucket, key, version_id FROM public.track_assets WHERE track_id = target_track
      UNION ALL
      SELECT source_bucket, source_key, source_version_id FROM public.processing_tasks WHERE track_id = target_track
      UNION ALL
      SELECT bucket, object_key, NULL::TEXT FROM public.upload_sessions WHERE track_id = target_track
    ) AS retired_objects
  LOOP
    INSERT INTO public.outbox_events (id, type, payload)
    VALUES (gen_random_uuid(), 'OBJECT_DELETE', jsonb_build_object(
      'trackId', target_track, 'bucket', object_row.bucket,
      'key', object_row.key, 'versionId', object_row.version_id
    ));
    object_count := object_count + 1;
  END LOOP;

  UPDATE public.tracks
  SET playback_asset_id = NULL, artwork_asset_id = NULL,
      processing_state = 'FAILED', publication_state = 'UNPUBLISHED', updated_at = now()
  WHERE id = target_track;
  DELETE FROM public.track_assets WHERE track_id = target_track;
  DELETE FROM public.processing_tasks WHERE track_id = target_track;
  DELETE FROM public.upload_sessions WHERE track_id = target_track;
  RETURN object_count;
END;
$$;

REVOKE ALL ON FUNCTION public.infosound_prepare_deleted_track_cleanup(UUID,TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.infosound_prepare_deleted_track_cleanup(UUID,TIMESTAMPTZ) TO infosound_background;
