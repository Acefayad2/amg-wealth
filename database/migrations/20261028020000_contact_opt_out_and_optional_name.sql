-- Website CRM contact safety: names are optional, first-contact opt-out notices
-- are tracked only after provider acceptance, and provider STOP replies are
-- recorded without changing AMG app data or authentication settings.
ALTER TABLE amg_private.crm_contacts
  ALTER COLUMN full_name DROP NOT NULL,
  ADD COLUMN first_outbound_accepted_at TIMESTAMPTZ,
  ADD COLUMN opted_out_at TIMESTAMPTZ,
  ADD COLUMN opt_out_source TEXT,
  ADD COLUMN opt_out_event_id TEXT;

CREATE UNIQUE INDEX crm_contacts_opt_out_event_idx
  ON amg_private.crm_contacts (opt_out_event_id)
  WHERE opt_out_event_id IS NOT NULL;

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
    UPDATE amg_private.crm_contacts SET full_name=normalized_name, phone=p_phone,
      consent_status=p_consent_status, consent_evidence=nullif(btrim(p_consent_evidence), ''),
      timezone=p_timezone, updated_by=auth.uid(), updated_at=NOW()
    WHERE id=p_id RETURNING id INTO result;
    IF result IS NULL THEN RAISE EXCEPTION 'Contact is invalid' USING ERRCODE='22023'; END IF;
  END IF;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.amg_crm_save_message(
  p_message_id UUID, p_body TEXT, p_target_type TEXT, p_target_id UUID, p_status TEXT,
  p_scheduled_for TIMESTAMPTZ, p_timezone TEXT, p_idempotency_key UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result UUID; target_name TEXT; recipient_count INTEGER;
BEGIN
  PERFORM amg_private.require_crm_admin();
  IF p_target_type = 'individual' THEN
    SELECT COALESCE(full_name, phone) INTO target_name FROM amg_private.crm_contacts WHERE id=p_target_id;
  ELSIF p_target_type = 'group' THEN
    SELECT name INTO target_name FROM amg_private.crm_groups WHERE id=p_target_id;
  ELSE
    RAISE EXCEPTION 'Recipient type is invalid' USING ERRCODE='22023';
  END IF;
  IF target_name IS NULL THEN RAISE EXCEPTION 'Recipient is invalid' USING ERRCODE='22023'; END IF;

  IF p_message_id IS NULL THEN
    INSERT INTO amg_private.crm_messages
      (body,target_type,target_id,target_name,status,scheduled_for,timezone,idempotency_key,created_by)
    VALUES (p_body,p_target_type,p_target_id,target_name,p_status,p_scheduled_for,p_timezone,p_idempotency_key,auth.uid())
    ON CONFLICT (idempotency_key) DO NOTHING RETURNING id INTO result;
    IF result IS NULL THEN
      SELECT id INTO result FROM amg_private.crm_messages
      WHERE idempotency_key=p_idempotency_key AND created_by=auth.uid();
      IF result IS NULL THEN RAISE EXCEPTION 'Request key is already in use' USING ERRCODE='23505'; END IF;
      RETURN result;
    END IF;
  ELSE
    UPDATE amg_private.crm_messages SET body=p_body,target_type=p_target_type,target_id=p_target_id,
      target_name=target_name,status=p_status,scheduled_for=p_scheduled_for,timezone=p_timezone,
      idempotency_key=p_idempotency_key,updated_at=NOW()
    WHERE id=p_message_id AND created_by=auth.uid() AND status='draft' RETURNING id INTO result;
    IF result IS NULL THEN RAISE EXCEPTION 'Only your draft messages can be edited' USING ERRCODE='22023'; END IF;
    DELETE FROM amg_private.crm_message_recipients WHERE message_id=result;
  END IF;

  IF p_status = 'scheduled' THEN
    IF p_target_type = 'individual' THEN
      INSERT INTO amg_private.crm_message_recipients (message_id,contact_id,phone_snapshot)
      SELECT result,id,phone FROM amg_private.crm_contacts WHERE id=p_target_id AND consent_status='opted_in';
    ELSE
      INSERT INTO amg_private.crm_message_recipients (message_id,contact_id,phone_snapshot)
      SELECT result,c.id,c.phone FROM amg_private.crm_contacts c
      JOIN amg_private.crm_group_members gm ON gm.contact_id=c.id
      WHERE gm.group_id=p_target_id AND c.consent_status='opted_in';
    END IF;
    SELECT count(*)::int INTO recipient_count FROM amg_private.crm_message_recipients WHERE message_id=result;
    IF recipient_count = 0 THEN RAISE EXCEPTION 'No opted-in recipients are eligible for this schedule' USING ERRCODE='22023'; END IF;
    IF recipient_count > 100 THEN RAISE EXCEPTION 'A scheduled group is limited to 100 opted-in recipients' USING ERRCODE='22023'; END IF;
  END IF;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.amg_crm_save_contact(UUID,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.amg_crm_save_message(UUID,TEXT,TEXT,UUID,TEXT,TIMESTAMPTZ,TEXT,UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.amg_crm_save_contact(UUID,TEXT,TEXT,TEXT,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.amg_crm_save_message(UUID,TEXT,TEXT,UUID,TEXT,TIMESTAMPTZ,TEXT,UUID) TO authenticated;

COMMENT ON COLUMN amg_private.crm_contacts.first_outbound_accepted_at IS
  'Set only after Quo accepts the first outbound message; controls first-contact STOP notice inclusion.';
COMMENT ON COLUMN amg_private.crm_contacts.opt_out_source IS
  'Records how CRM suppression was learned; provider history is rechecked before every recipient.';
