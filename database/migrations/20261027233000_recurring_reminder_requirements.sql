-- Book Club needs its pending Zoom URL. BOM reminder drafts do not imply a
-- meeting link because the requested copy only announces the event time.
ALTER TABLE amg_private.crm_recurring_reminders
  ADD COLUMN meeting_url_required BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE amg_private.crm_recurring_reminders
SET meeting_url_required = TRUE
WHERE name = 'AMG Book Club';

ALTER TABLE amg_private.crm_recurring_reminders
  DROP CONSTRAINT crm_recurring_reminders_check;
ALTER TABLE amg_private.crm_recurring_reminders
  ADD CONSTRAINT crm_recurring_reminders_activation_check
  CHECK (
    status <> 'active'
    OR (
      target_group_id IS NOT NULL
      AND local_time IS NOT NULL
      AND (NOT meeting_url_required OR zoom_url IS NOT NULL)
    )
  );

CREATE OR REPLACE FUNCTION public.amg_crm_save_recurring_reminder(
  p_id UUID, p_name TEXT, p_body TEXT, p_target_group_id UUID, p_zoom_url TEXT,
  p_timezone TEXT, p_local_time TIME, p_weekdays SMALLINT[], p_start_date DATE,
  p_status TEXT, p_idempotency_key UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result UUID; eligible_count INTEGER; requires_url BOOLEAN := FALSE;
BEGIN
  PERFORM amg_private.require_crm_admin();
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
    WHERE id=p_id AND status <> 'active'
    RETURNING id INTO result;
  END IF;
  IF result IS NULL THEN
    RAISE EXCEPTION 'Recurring reminder could not be saved' USING ERRCODE='22023';
  END IF;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.amg_crm_get_state()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result JSONB;
BEGIN
  PERFORM amg_private.require_crm_admin();
  SELECT jsonb_build_object(
    'contacts', COALESCE((SELECT jsonb_agg(to_jsonb(rows) ORDER BY rows.full_name) FROM (
      SELECT c.id, c.full_name, c.phone, c.consent_status, c.consent_evidence, c.timezone,
        COALESCE(array_agg(g.id) FILTER (WHERE g.id IS NOT NULL), '{}') AS group_ids
      FROM amg_private.crm_contacts c
      LEFT JOIN amg_private.crm_group_members gm ON gm.contact_id = c.id
      LEFT JOIN amg_private.crm_groups g ON g.id = gm.group_id GROUP BY c.id
    ) rows), '[]'::jsonb),
    'groups', COALESCE((SELECT jsonb_agg(to_jsonb(rows) ORDER BY rows.name) FROM (
      SELECT g.id, g.name, count(gm.contact_id)::int AS member_count,
        count(gm.contact_id) FILTER (WHERE c.consent_status = 'opted_in')::int AS eligible_count
      FROM amg_private.crm_groups g
      LEFT JOIN amg_private.crm_group_members gm ON gm.group_id = g.id
      LEFT JOIN amg_private.crm_contacts c ON c.id = gm.contact_id GROUP BY g.id
    ) rows), '[]'::jsonb),
    'messages', COALESCE((SELECT jsonb_agg(to_jsonb(rows) ORDER BY COALESCE(rows.scheduled_for, rows.created_at) DESC) FROM (
      SELECT m.id, m.body, m.target_type, m.target_id, m.target_name, m.status,
        m.scheduled_for, m.timezone, m.failure_reason, m.created_at, count(r.id)::int AS recipient_count
      FROM amg_private.crm_messages m
      LEFT JOIN amg_private.crm_message_recipients r ON r.message_id = m.id
      GROUP BY m.id ORDER BY COALESCE(m.scheduled_for, m.created_at) DESC LIMIT 500
    ) rows), '[]'::jsonb),
    'recurring_reminders', COALESCE((SELECT jsonb_agg(to_jsonb(rows) ORDER BY rows.name) FROM (
      SELECT rr.id, rr.name, rr.body, rr.target_group_id, g.name AS target_group_name,
        rr.zoom_url, rr.meeting_url_required, rr.timezone, rr.local_time, rr.weekdays,
        rr.start_date, rr.status, rr.idempotency_key, rr.created_at, rr.updated_at
      FROM amg_private.crm_recurring_reminders rr
      LEFT JOIN amg_private.crm_groups g ON g.id = rr.target_group_id
    ) rows), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;
