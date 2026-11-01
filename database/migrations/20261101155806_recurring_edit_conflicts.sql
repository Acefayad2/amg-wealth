-- Preserve newer shared-admin edits without changing activation or dispatch policy.
CREATE OR REPLACE FUNCTION amg_private.crm_recurring_edit_version()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := GREATEST(clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION amg_private.crm_recurring_edit_version() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER crm_recurring_edit_version BEFORE UPDATE ON amg_private.crm_recurring_reminders
FOR EACH ROW EXECUTE FUNCTION amg_private.crm_recurring_edit_version();

CREATE OR REPLACE FUNCTION public.amg_crm_save_recurring_reminder_versioned(
  p_id UUID, p_name TEXT, p_body TEXT, p_target_group_id UUID, p_zoom_url TEXT,
  p_timezone TEXT, p_local_time TIME, p_weekdays SMALLINT[], p_start_date DATE,
  p_status TEXT, p_idempotency_key UUID, p_expected_updated_at TIMESTAMPTZ
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result UUID; eligible_count INTEGER; requires_url BOOLEAN := FALSE; current_version TIMESTAMPTZ;
BEGIN
  PERFORM amg_private.require_crm_admin();
  IF p_id IS NOT NULL THEN
    SELECT updated_at INTO current_version FROM amg_private.crm_recurring_reminders WHERE id=p_id FOR UPDATE;
    IF p_expected_updated_at IS NULL OR current_version IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'Recurring reminder changed; refresh and try again' USING ERRCODE='40001';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_timezone) THEN
    RAISE EXCEPTION 'Timezone is invalid' USING ERRCODE='22023';
  END IF;
  IF cardinality(p_weekdays) NOT BETWEEN 1 AND 7
    OR NOT (p_weekdays <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]) THEN
    RAISE EXCEPTION 'Recurring weekdays are invalid' USING ERRCODE='22023';
  END IF;
  IF p_status NOT IN ('draft', 'active', 'paused') THEN
    RAISE EXCEPTION 'Recurring reminder status is invalid' USING ERRCODE='22023';
  END IF;
  IF p_target_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM amg_private.crm_groups WHERE id = p_target_group_id
  ) THEN
    RAISE EXCEPTION 'Recipient group is invalid' USING ERRCODE='22023';
  END IF;
  IF p_zoom_url IS NOT NULL AND p_zoom_url !~ '^https://' THEN
    RAISE EXCEPTION 'Meeting URL must use HTTPS' USING ERRCODE='22023';
  END IF;
  IF p_id IS NOT NULL THEN
    SELECT meeting_url_required INTO requires_url
    FROM amg_private.crm_recurring_reminders
    WHERE id = p_id;
  END IF;
  IF p_status = 'active' THEN
    IF p_target_group_id IS NULL OR p_local_time IS NULL OR (requires_url AND p_zoom_url IS NULL) THEN
      RAISE EXCEPTION 'Recipient group and all required schedule details are needed before activation' USING ERRCODE='22023';
    END IF;
    SELECT count(*)::int INTO eligible_count
    FROM amg_private.crm_contacts c
    JOIN amg_private.crm_group_members gm ON gm.contact_id = c.id
    WHERE gm.group_id = p_target_group_id AND c.consent_status = 'opted_in';
    IF eligible_count = 0 THEN
      RAISE EXCEPTION 'No opted-in recipients are eligible for this recurring reminder' USING ERRCODE='22023';
    END IF;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO amg_private.crm_recurring_reminders
      (name, body, target_group_id, zoom_url, timezone, local_time, weekdays,
       start_date, status, idempotency_key, created_by, updated_by)
    VALUES
      (p_name, p_body, p_target_group_id, nullif(btrim(p_zoom_url), ''), p_timezone,
       p_local_time, p_weekdays, p_start_date, p_status, p_idempotency_key, auth.uid(), auth.uid())
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO result;
    IF result IS NULL THEN
      SELECT id INTO result FROM amg_private.crm_recurring_reminders
      WHERE idempotency_key = p_idempotency_key AND created_by = auth.uid();
    END IF;
  ELSE
    UPDATE amg_private.crm_recurring_reminders
    SET name=p_name, body=p_body, target_group_id=p_target_group_id,
      zoom_url=nullif(btrim(p_zoom_url), ''), timezone=p_timezone,
      local_time=p_local_time, weekdays=p_weekdays, start_date=p_start_date,
      status=p_status, idempotency_key=p_idempotency_key,
      updated_by=auth.uid(), updated_at=NOW()
    WHERE id=p_id AND updated_at=p_expected_updated_at AND status <> 'active'
    RETURNING id INTO result;
  END IF;
  IF result IS NULL THEN
    RAISE EXCEPTION 'Recurring reminder could not be saved' USING ERRCODE='22023';
  END IF;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.amg_crm_save_recurring_reminder(
  p_id UUID, p_name TEXT, p_body TEXT, p_target_group_id UUID, p_zoom_url TEXT,
  p_timezone TEXT, p_local_time TIME, p_weekdays SMALLINT[], p_start_date DATE,
  p_status TEXT, p_idempotency_key UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM amg_private.require_crm_admin();
  IF p_id IS NOT NULL THEN
    RAISE EXCEPTION 'Reminder version is required; refresh and try again' USING ERRCODE='40001';
  END IF;
  RETURN public.amg_crm_save_recurring_reminder_versioned(p_id,p_name,p_body,p_target_group_id,p_zoom_url,
    p_timezone,p_local_time,p_weekdays,p_start_date,p_status,p_idempotency_key,NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.amg_crm_set_recurring_status(
  p_id UUID, p_status TEXT, p_expected_updated_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE reminder amg_private.crm_recurring_reminders%ROWTYPE;
DECLARE eligible_count INTEGER;
BEGIN
  PERFORM amg_private.require_crm_admin();
  IF p_status NOT IN ('active', 'paused', 'draft') THEN
    RAISE EXCEPTION 'Recurring reminder status is invalid' USING ERRCODE='22023';
  END IF;

  SELECT * INTO reminder FROM amg_private.crm_recurring_reminders WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recurring reminder is invalid' USING ERRCODE='22023'; END IF;
  IF reminder.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Recurring reminder changed; refresh and try again' USING ERRCODE='40001';
  END IF;

  IF p_status='active' THEN
    IF reminder.target_group_id IS NULL OR reminder.local_time IS NULL
      OR (reminder.meeting_url_required AND reminder.zoom_url IS NULL) THEN
      RAISE EXCEPTION 'Choose an audience and complete every required reminder field before activation' USING ERRCODE='22023';
    END IF;
    SELECT count(*)::int INTO eligible_count
    FROM amg_private.crm_group_members gm
    JOIN amg_private.crm_contacts c ON c.id=gm.contact_id
    WHERE gm.group_id=reminder.target_group_id AND c.consent_status='opted_in';
    IF eligible_count NOT BETWEEN 1 AND 100 THEN
      RAISE EXCEPTION 'The audience must contain 1 to 100 opted-in contacts' USING ERRCODE='22023';
    END IF;
  END IF;

  UPDATE amg_private.crm_recurring_reminders
  SET status=p_status,updated_by=auth.uid(),updated_at=NOW()
  WHERE id=p_id;
  RETURN jsonb_build_object('id',p_id,'status',p_status,'updated_at',(
    SELECT updated_at FROM amg_private.crm_recurring_reminders WHERE id=p_id
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.amg_crm_save_recurring_reminder_versioned(UUID,TEXT,TEXT,UUID,TEXT,TEXT,TIME,SMALLINT[],DATE,TEXT,UUID,TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.amg_crm_save_recurring_reminder_versioned(UUID,TEXT,TEXT,UUID,TEXT,TEXT,TIME,SMALLINT[],DATE,TEXT,UUID,TIMESTAMPTZ) TO authenticated;
