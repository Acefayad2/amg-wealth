-- Separate immediate and scheduled delivery controls. Rollout starts both
-- channels off, regardless of the legacy switch, then evolves them independently
-- with one optimistic-concurrency version and a shared immutable audit trail.
ALTER TABLE amg_private.crm_dispatch_control
  ADD COLUMN individual_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN scheduled_enabled BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE amg_private.crm_dispatch_control
SET individual_enabled = FALSE,
    scheduled_enabled = FALSE,
    enabled = FALSE
WHERE singleton = TRUE;

ALTER TABLE amg_private.crm_dispatch_audit
  ADD COLUMN channel TEXT NOT NULL DEFAULT 'global'
    CHECK (channel IN ('global', 'individual', 'scheduled'));

CREATE OR REPLACE FUNCTION public.amg_crm_get_dispatch_control()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result JSONB;
BEGIN
  PERFORM amg_private.require_crm_admin();
  SELECT jsonb_build_object(
    'individual_enabled', control.individual_enabled,
    'scheduled_enabled', control.scheduled_enabled,
    'version', control.version,
    'changed_at', control.changed_at,
    'changed_by', changer.email,
    'audit', COALESCE((
      SELECT jsonb_agg(to_jsonb(rows) ORDER BY rows.version DESC)
      FROM (
        SELECT audit.channel, audit.previous_enabled, audit.new_enabled, audit.version,
          audit.changed_at, actor.email AS changed_by
        FROM amg_private.crm_dispatch_audit audit
        JOIN auth.users actor ON actor.id = audit.changed_by
        ORDER BY audit.version DESC LIMIT 10
      ) rows
    ), '[]'::jsonb)
  ) INTO result
  FROM amg_private.crm_dispatch_control control
  LEFT JOIN auth.users changer ON changer.id = control.changed_by
  WHERE control.singleton = TRUE;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.amg_crm_set_dispatch_channel(
  p_channel TEXT, p_enabled BOOLEAN, p_expected_version BIGINT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE current_enabled BOOLEAN; current_version BIGINT; next_version BIGINT;
BEGIN
  PERFORM amg_private.require_crm_admin();
  IF p_channel IS NULL OR p_channel NOT IN ('individual', 'scheduled') THEN
    RAISE EXCEPTION 'Dispatch channel is invalid' USING ERRCODE='22023';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'Dispatch state is invalid' USING ERRCODE='22023';
  END IF;

  SELECT CASE p_channel
      WHEN 'individual' THEN individual_enabled
      ELSE scheduled_enabled
    END,
    version
  INTO current_enabled, current_version
  FROM amg_private.crm_dispatch_control
  WHERE singleton = TRUE FOR UPDATE;

  IF current_version IS NULL THEN
    RAISE EXCEPTION 'Dispatch control is unavailable' USING ERRCODE='55000';
  END IF;
  IF current_version <> p_expected_version THEN
    RAISE EXCEPTION 'Dispatch control changed; refresh and try again' USING ERRCODE='40001';
  END IF;
  IF current_enabled = p_enabled THEN
    RETURN public.amg_crm_get_dispatch_control();
  END IF;

  next_version := current_version + 1;
  UPDATE amg_private.crm_dispatch_control
  SET individual_enabled = CASE WHEN p_channel='individual' THEN p_enabled ELSE individual_enabled END,
      scheduled_enabled = CASE WHEN p_channel='scheduled' THEN p_enabled ELSE scheduled_enabled END,
      version = next_version,
      changed_by = auth.uid(),
      changed_at = NOW()
  WHERE singleton = TRUE AND version = current_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatch control changed; refresh and try again' USING ERRCODE='40001';
  END IF;

  INSERT INTO amg_private.crm_dispatch_audit
    (channel, previous_enabled, new_enabled, version, changed_by)
  VALUES (p_channel, current_enabled, p_enabled, next_version, auth.uid());
  RETURN public.amg_crm_get_dispatch_control();
END;
$$;

-- Fail old portal builds closed. A stale client must never re-couple channels.
CREATE OR REPLACE FUNCTION public.amg_crm_set_dispatch_enabled(
  p_enabled BOOLEAN, p_expected_version BIGINT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM amg_private.require_crm_admin();
  RAISE EXCEPTION 'Refresh the dashboard to manage individual and scheduled delivery separately'
    USING ERRCODE='55000';
END;
$$;

REVOKE ALL ON FUNCTION public.amg_crm_get_dispatch_control() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.amg_crm_set_dispatch_enabled(BOOLEAN,BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.amg_crm_set_dispatch_channel(TEXT,BOOLEAN,BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.amg_crm_get_dispatch_control() TO authenticated;
GRANT EXECUTE ON FUNCTION public.amg_crm_set_dispatch_enabled(BOOLEAN,BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.amg_crm_set_dispatch_channel(TEXT,BOOLEAN,BIGINT) TO authenticated;

COMMENT ON COLUMN amg_private.crm_dispatch_control.individual_enabled IS
  'Controls only explicit Send now requests from authenticated CRM admins.';
COMMENT ON COLUMN amg_private.crm_dispatch_control.scheduled_enabled IS
  'Controls future one-time and active recurring scheduler delivery.';
