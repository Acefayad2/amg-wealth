-- Website CRM dispatch control is fail-closed, admin-only, versioned for
-- concurrent updates, and isolated from AMG app notification settings.
CREATE TABLE amg_private.crm_dispatch_control (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  changed_by UUID REFERENCES auth.users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE amg_private.crm_dispatch_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  previous_enabled BOOLEAN NOT NULL,
  new_enabled BOOLEAN NOT NULL,
  version BIGINT NOT NULL,
  changed_by UUID NOT NULL REFERENCES auth.users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

REVOKE ALL ON amg_private.crm_dispatch_control, amg_private.crm_dispatch_audit
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE amg_private.crm_dispatch_audit_id_seq
  FROM PUBLIC, anon, authenticated;

INSERT INTO amg_private.crm_dispatch_control (singleton, enabled)
VALUES (TRUE, FALSE)
ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION public.amg_crm_get_dispatch_control()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result JSONB;
BEGIN
  PERFORM amg_private.require_crm_admin();
  SELECT jsonb_build_object(
    'enabled', control.enabled,
    'version', control.version,
    'changed_at', control.changed_at,
    'changed_by', changer.email,
    'audit', COALESCE((
      SELECT jsonb_agg(to_jsonb(rows) ORDER BY rows.version DESC)
      FROM (
        SELECT audit.previous_enabled, audit.new_enabled, audit.version,
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

CREATE OR REPLACE FUNCTION public.amg_crm_set_dispatch_enabled(
  p_enabled BOOLEAN, p_expected_version BIGINT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE current_enabled BOOLEAN; current_version BIGINT; next_version BIGINT;
BEGIN
  PERFORM amg_private.require_crm_admin();
  SELECT enabled, version INTO current_enabled, current_version
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
  SET enabled=p_enabled, version=next_version, changed_by=auth.uid(), changed_at=NOW()
  WHERE singleton = TRUE AND version=current_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatch control changed; refresh and try again' USING ERRCODE='40001';
  END IF;
  INSERT INTO amg_private.crm_dispatch_audit
    (previous_enabled, new_enabled, version, changed_by)
  VALUES (current_enabled, p_enabled, next_version, auth.uid());
  RETURN public.amg_crm_get_dispatch_control();
END;
$$;

REVOKE ALL ON FUNCTION public.amg_crm_get_dispatch_control() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.amg_crm_set_dispatch_enabled(BOOLEAN,BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.amg_crm_get_dispatch_control() TO authenticated;
GRANT EXECUTE ON FUNCTION public.amg_crm_set_dispatch_enabled(BOOLEAN,BIGINT) TO authenticated;

COMMENT ON TABLE amg_private.crm_dispatch_control IS
  'Fail-closed website CRM dispatch switch. It does not alter AMG app notification settings.';
COMMENT ON TABLE amg_private.crm_dispatch_audit IS
  'Immutable audit trail for website CRM dispatch enable and disable changes.';
