-- Reject stale contact edits without changing admin access or consent policy.
-- Every contact mutation, including provider opt-outs, advances the edit token.
CREATE OR REPLACE FUNCTION amg_private.crm_contact_edit_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := GREATEST(clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION amg_private.crm_contact_edit_version() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER crm_contact_edit_version BEFORE UPDATE ON amg_private.crm_contacts
FOR EACH ROW EXECUTE FUNCTION amg_private.crm_contact_edit_version();
CREATE OR REPLACE FUNCTION public.amg_crm_save_contact_versioned(
  p_id UUID, p_full_name TEXT, p_phone TEXT, p_consent_status TEXT, p_consent_evidence TEXT, p_timezone TEXT, p_expected_updated_at TIMESTAMPTZ
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result UUID; normalized_name TEXT := nullif(btrim(p_full_name), '');
BEGIN
  PERFORM amg_private.require_crm_admin();
  IF normalized_name IS NOT NULL AND char_length(normalized_name) > 160 THEN
    RAISE EXCEPTION 'Contact name is too long' USING ERRCODE='22023';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO amg_private.crm_contacts
      (full_name, phone, consent_status, consent_evidence, timezone, created_by, updated_by)
    VALUES (normalized_name, p_phone, p_consent_status, nullif(btrim(p_consent_evidence), ''), p_timezone, auth.uid(), auth.uid())
    RETURNING id INTO result;
  ELSE
    UPDATE amg_private.crm_contacts SET full_name=normalized_name, phone=p_phone,
      consent_status=p_consent_status, consent_evidence=nullif(btrim(p_consent_evidence), ''),
      timezone=p_timezone, updated_by=auth.uid(), updated_at=NOW()
    WHERE id=p_id AND updated_at=p_expected_updated_at RETURNING id INTO result;
    IF result IS NULL THEN RAISE EXCEPTION 'Contact changed; refresh and try again' USING ERRCODE='40001'; END IF;
  END IF;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.amg_crm_save_contact(
  p_id UUID, p_full_name TEXT, p_phone TEXT, p_consent_status TEXT, p_consent_evidence TEXT, p_timezone TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result UUID; normalized_name TEXT := nullif(btrim(p_full_name), '');
BEGIN
  PERFORM amg_private.require_crm_admin();
  IF normalized_name IS NOT NULL AND char_length(normalized_name) > 160 THEN
    RAISE EXCEPTION 'Contact name is too long' USING ERRCODE='22023';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO amg_private.crm_contacts
      (full_name, phone, consent_status, consent_evidence, timezone, created_by, updated_by)
    VALUES (normalized_name, p_phone, p_consent_status, nullif(btrim(p_consent_evidence), ''), p_timezone, auth.uid(), auth.uid())
    RETURNING id INTO result;
  ELSE
    RAISE EXCEPTION 'Contact version is required; refresh and try again' USING ERRCODE='40001';

  END IF;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.amg_crm_save_contact_versioned(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.amg_crm_save_contact_versioned(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) TO authenticated;
CREATE OR REPLACE FUNCTION public.amg_crm_get_state()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result JSONB;
BEGIN
  PERFORM amg_private.require_crm_admin();
  SELECT jsonb_build_object(
    'contacts', COALESCE((SELECT jsonb_agg(to_jsonb(rows) ORDER BY rows.full_name) FROM (
      SELECT c.updated_at, c.id, c.full_name, c.phone, c.consent_status, c.consent_evidence, c.timezone,
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
