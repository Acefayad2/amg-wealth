-- Allow authorized admins to edit a one-time scheduled message without letting
-- a stale browser overwrite a newer admin's change or an in-flight delivery.
CREATE OR REPLACE FUNCTION amg_private.crm_message_edit_version()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := GREATEST(clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION amg_private.crm_message_edit_version() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER crm_message_edit_version BEFORE UPDATE ON amg_private.crm_messages
FOR EACH ROW EXECUTE FUNCTION amg_private.crm_message_edit_version();

CREATE OR REPLACE FUNCTION public.amg_crm_save_message_versioned(
  p_message_id UUID, p_body TEXT, p_target_type TEXT, p_target_id UUID, p_status TEXT,
  p_scheduled_for TIMESTAMPTZ, p_timezone TEXT, p_idempotency_key UUID,
  p_expected_updated_at TIMESTAMPTZ
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  result UUID; resolved_target_name TEXT; recipient_count INTEGER;
  current_version TIMESTAMPTZ; current_status TEXT; current_owner UUID;
BEGIN
  PERFORM amg_private.require_crm_admin();
  IF p_status NOT IN ('draft', 'scheduled') THEN
    RAISE EXCEPTION 'Message status is invalid' USING ERRCODE='22023';
  END IF;
  IF p_status = 'scheduled' AND (p_scheduled_for IS NULL OR p_scheduled_for <= NOW()) THEN
    RAISE EXCEPTION 'Scheduled time must be in the future' USING ERRCODE='22023';
  END IF;
  IF p_target_type = 'individual' THEN
    SELECT COALESCE(full_name, phone) INTO resolved_target_name
    FROM amg_private.crm_contacts WHERE id=p_target_id;
  ELSIF p_target_type = 'group' THEN
    SELECT name INTO resolved_target_name FROM amg_private.crm_groups WHERE id=p_target_id;
  ELSE
    RAISE EXCEPTION 'Recipient type is invalid' USING ERRCODE='22023';
  END IF;
  IF resolved_target_name IS NULL THEN
    RAISE EXCEPTION 'Recipient is invalid' USING ERRCODE='22023';
  END IF;

  IF p_message_id IS NULL THEN
    INSERT INTO amg_private.crm_messages
      (body,target_type,target_id,target_name,status,scheduled_for,timezone,idempotency_key,created_by)
    VALUES
      (p_body,p_target_type,p_target_id,resolved_target_name,p_status,p_scheduled_for,p_timezone,p_idempotency_key,auth.uid())
    ON CONFLICT (idempotency_key) DO NOTHING RETURNING id INTO result;
    IF result IS NULL THEN
      SELECT id INTO result FROM amg_private.crm_messages
      WHERE idempotency_key=p_idempotency_key AND created_by=auth.uid();
      IF result IS NULL THEN
        RAISE EXCEPTION 'Request key is already in use' USING ERRCODE='23505';
      END IF;
      RETURN result;
    END IF;
  ELSE
    SELECT updated_at,status,created_by INTO current_version,current_status,current_owner
    FROM amg_private.crm_messages WHERE id=p_message_id FOR UPDATE;
    IF current_owner IS DISTINCT FROM auth.uid() OR current_status NOT IN ('draft','scheduled') THEN
      RAISE EXCEPTION 'Only your draft or scheduled messages can be edited' USING ERRCODE='22023';
    END IF;
    IF p_expected_updated_at IS NULL OR current_version IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'Scheduled message changed; refresh and try again' USING ERRCODE='40001';
    END IF;
    DELETE FROM amg_private.crm_message_recipients WHERE message_id=p_message_id;
    UPDATE amg_private.crm_messages
    SET body=p_body,target_type=p_target_type,target_id=p_target_id,target_name=resolved_target_name,
      status=p_status,scheduled_for=p_scheduled_for,timezone=p_timezone,
      idempotency_key=p_idempotency_key,failure_reason=NULL,updated_at=NOW()
    WHERE id=p_message_id AND updated_at=p_expected_updated_at RETURNING id INTO result;
    IF result IS NULL THEN
      RAISE EXCEPTION 'Scheduled message changed; refresh and try again' USING ERRCODE='40001';
    END IF;
  END IF;

  IF p_status = 'scheduled' THEN
    IF p_target_type = 'individual' THEN
      INSERT INTO amg_private.crm_message_recipients (message_id,contact_id,phone_snapshot)
      SELECT result,id,phone FROM amg_private.crm_contacts
      WHERE id=p_target_id AND consent_status='opted_in';
    ELSE
      INSERT INTO amg_private.crm_message_recipients (message_id,contact_id,phone_snapshot)
      SELECT result,c.id,c.phone FROM amg_private.crm_contacts c
      JOIN amg_private.crm_group_members gm ON gm.contact_id=c.id
      WHERE gm.group_id=p_target_id AND c.consent_status='opted_in';
    END IF;
    SELECT count(*)::int INTO recipient_count
    FROM amg_private.crm_message_recipients WHERE message_id=result;
    IF recipient_count = 0 THEN
      RAISE EXCEPTION 'No opted-in recipients are eligible for this schedule' USING ERRCODE='22023';
    END IF;
    IF recipient_count > 100 THEN
      RAISE EXCEPTION 'A scheduled group is limited to 100 opted-in recipients' USING ERRCODE='22023';
    END IF;
  END IF;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.amg_crm_save_message_versioned(UUID,TEXT,TEXT,UUID,TEXT,TIMESTAMPTZ,TEXT,UUID,TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.amg_crm_save_message_versioned(UUID,TEXT,TEXT,UUID,TEXT,TIMESTAMPTZ,TEXT,UUID,TIMESTAMPTZ) TO authenticated;

-- Old clients may still create messages but cannot edit without a version.
CREATE OR REPLACE FUNCTION public.amg_crm_save_message(
  p_message_id UUID, p_body TEXT, p_target_type TEXT, p_target_id UUID, p_status TEXT,
  p_scheduled_for TIMESTAMPTZ, p_timezone TEXT, p_idempotency_key UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM amg_private.require_crm_admin();
  IF p_message_id IS NOT NULL THEN
    RAISE EXCEPTION 'Message version is required; refresh and try again' USING ERRCODE='40001';
  END IF;
  RETURN public.amg_crm_save_message_versioned(
    p_message_id,p_body,p_target_type,p_target_id,p_status,p_scheduled_for,p_timezone,
    p_idempotency_key,NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.amg_crm_get_state()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result JSONB;
BEGIN
  PERFORM amg_private.require_crm_admin();
  SELECT jsonb_build_object(
    'contacts', COALESCE((SELECT jsonb_agg(to_jsonb(rows) ORDER BY rows.full_name) FROM (
      SELECT c.updated_at,c.id,c.full_name,c.phone,c.consent_status,c.consent_evidence,c.timezone,
        COALESCE(array_agg(g.id) FILTER (WHERE g.id IS NOT NULL), '{}') AS group_ids
      FROM amg_private.crm_contacts c
      LEFT JOIN amg_private.crm_group_members gm ON gm.contact_id=c.id
      LEFT JOIN amg_private.crm_groups g ON g.id=gm.group_id GROUP BY c.id
    ) rows), '[]'::jsonb),
    'groups', COALESCE((SELECT jsonb_agg(to_jsonb(rows) ORDER BY rows.name) FROM (
      SELECT g.id,g.name,count(gm.contact_id)::int AS member_count,
        count(gm.contact_id) FILTER (WHERE c.consent_status='opted_in')::int AS eligible_count
      FROM amg_private.crm_groups g
      LEFT JOIN amg_private.crm_group_members gm ON gm.group_id=g.id
      LEFT JOIN amg_private.crm_contacts c ON c.id=gm.contact_id GROUP BY g.id
    ) rows), '[]'::jsonb),
    'messages', COALESCE((SELECT jsonb_agg(to_jsonb(rows) ORDER BY COALESCE(rows.scheduled_for,rows.created_at) DESC) FROM (
      SELECT m.id,m.body,m.target_type,m.target_id,m.target_name,m.status,m.scheduled_for,
        m.timezone,m.failure_reason,m.created_at,m.updated_at,count(r.id)::int AS recipient_count
      FROM amg_private.crm_messages m
      LEFT JOIN amg_private.crm_message_recipients r ON r.message_id=m.id
      GROUP BY m.id ORDER BY COALESCE(m.scheduled_for,m.created_at) DESC LIMIT 500
    ) rows), '[]'::jsonb),
    'recurring_reminders', COALESCE((SELECT jsonb_agg(to_jsonb(rows) ORDER BY rows.name) FROM (
      SELECT rr.id,rr.name,rr.body,rr.target_group_id,g.name AS target_group_name,
        rr.zoom_url,rr.meeting_url_required,rr.timezone,rr.local_time,rr.weekdays,
        rr.start_date,rr.status,rr.idempotency_key,rr.created_at,rr.updated_at
      FROM amg_private.crm_recurring_reminders rr
      LEFT JOIN amg_private.crm_groups g ON g.id=rr.target_group_id
    ) rows), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;
