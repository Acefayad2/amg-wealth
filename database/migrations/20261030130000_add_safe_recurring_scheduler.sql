-- Isolated website-CRM scheduler support. This migration does not activate any
-- reminder, enable dispatch, alter application auth, or grant new public access.
ALTER TABLE amg_private.crm_recurring_occurrences
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

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
  IF reminder.updated_at <> p_expected_updated_at THEN
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

REVOKE ALL ON FUNCTION public.amg_crm_set_recurring_status(UUID,TEXT,TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.amg_crm_set_recurring_status(UUID,TEXT,TIMESTAMPTZ) TO authenticated;

-- Called only through the private server database connection. It considers only
-- today's local occurrence. A worker outage therefore cannot create a backlog of
-- surprise sends from prior dates.
CREATE OR REPLACE FUNCTION amg_private.materialize_due_recurring(p_now TIMESTAMPTZ DEFAULT NOW())
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE reminder RECORD;
DECLARE local_date DATE;
DECLARE scheduled_at TIMESTAMPTZ;
DECLARE occurrence_id UUID;
DECLARE v_message_id UUID;
DECLARE eligible_count INTEGER;
DECLARE materialized_count INTEGER := 0;
DECLARE skipped_count INTEGER := 0;
DECLARE message_body TEXT;
BEGIN
  FOR reminder IN
    SELECT rr.*,g.name AS group_name
    FROM amg_private.crm_recurring_reminders rr
    LEFT JOIN amg_private.crm_groups g ON g.id=rr.target_group_id
    WHERE rr.status='active' AND rr.local_time IS NOT NULL
    FOR UPDATE OF rr
  LOOP
    local_date := (p_now AT TIME ZONE reminder.timezone)::date;
    IF local_date < reminder.start_date
      OR NOT (extract(dow FROM local_date)::smallint = ANY(reminder.weekdays)) THEN
      CONTINUE;
    END IF;
    scheduled_at := (local_date + reminder.local_time) AT TIME ZONE reminder.timezone;
    IF scheduled_at > p_now THEN CONTINUE; END IF;

    INSERT INTO amg_private.crm_recurring_occurrences
      (reminder_id,occurrence_local_date,scheduled_for,status)
    VALUES (reminder.id,local_date,scheduled_at,'pending')
    ON CONFLICT (reminder_id,occurrence_local_date) DO NOTHING
    RETURNING id INTO occurrence_id;
    IF occurrence_id IS NULL THEN CONTINUE; END IF;

    IF scheduled_at < p_now - INTERVAL '10 minutes' THEN
      UPDATE amg_private.crm_recurring_occurrences
      SET status='skipped',failure_reason='Missed the 10-minute safe dispatch window; no backlog was sent.',updated_at=NOW()
      WHERE id=occurrence_id;
      skipped_count := skipped_count + 1;
      CONTINUE;
    END IF;

    SELECT count(*)::int INTO eligible_count
    FROM amg_private.crm_group_members gm
    JOIN amg_private.crm_contacts c ON c.id=gm.contact_id
    WHERE gm.group_id=reminder.target_group_id AND c.consent_status='opted_in';
    IF reminder.target_group_id IS NULL OR eligible_count NOT BETWEEN 1 AND 100
      OR (reminder.meeting_url_required AND reminder.zoom_url IS NULL) THEN
      UPDATE amg_private.crm_recurring_occurrences
      SET status='skipped',failure_reason='Reminder readiness changed before materialization.',updated_at=NOW()
      WHERE id=occurrence_id;
      skipped_count := skipped_count + 1;
      CONTINUE;
    END IF;

    v_message_id := occurrence_id;
    message_body := reminder.body || CASE WHEN reminder.zoom_url IS NOT NULL
      THEN E'\n\nJoin on Zoom: ' || reminder.zoom_url ELSE '' END;
    IF char_length(message_body) > 1600 THEN
      UPDATE amg_private.crm_recurring_occurrences
      SET status='failed',failure_reason='Message plus meeting URL exceeds 1600 characters.',updated_at=NOW()
      WHERE id=occurrence_id;
      skipped_count := skipped_count + 1;
      CONTINUE;
    END IF;

    INSERT INTO amg_private.crm_messages
      (id,body,target_type,target_id,target_name,status,scheduled_for,timezone,
       idempotency_key,created_by)
    VALUES (v_message_id,message_body,'group',reminder.target_group_id,reminder.group_name,
      'scheduled',scheduled_at,reminder.timezone,occurrence_id,reminder.updated_by);
    INSERT INTO amg_private.crm_message_recipients
      (message_id,contact_id,phone_snapshot,status)
    SELECT v_message_id,c.id,c.phone,'scheduled'
    FROM amg_private.crm_group_members gm
    JOIN amg_private.crm_contacts c ON c.id=gm.contact_id
    WHERE gm.group_id=reminder.target_group_id AND c.consent_status='opted_in'
    ORDER BY c.id LIMIT 100;
    UPDATE amg_private.crm_recurring_occurrences
    SET status='materialized',message_id=v_message_id,updated_at=NOW()
    WHERE id=occurrence_id;
    materialized_count := materialized_count + 1;
  END LOOP;
  RETURN jsonb_build_object('materialized',materialized_count,'skipped',skipped_count);
END;
$$;

REVOKE ALL ON FUNCTION amg_private.materialize_due_recurring(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION amg_private.materialize_due_recurring(TIMESTAMPTZ) IS
  'Private fail-closed materializer. Uses each reminder timezone and never backfills a prior local date.';

CREATE OR REPLACE FUNCTION public.amg_crm_get_scheduler_events()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result JSONB;
BEGIN
  PERFORM amg_private.require_crm_admin();
  SELECT COALESCE(jsonb_agg(to_jsonb(events) ORDER BY events.scheduled_for DESC),'[]'::jsonb)
  INTO result FROM (
    SELECT o.id,o.reminder_id,o.occurrence_local_date,o.scheduled_for,o.status,
      o.failure_reason,o.message_id,o.updated_at
    FROM amg_private.crm_recurring_occurrences o
    ORDER BY o.scheduled_for DESC LIMIT 50
  ) events;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.amg_crm_get_scheduler_events() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.amg_crm_get_scheduler_events() TO authenticated;
