-- Fix SQLSTATE 42702 on draft edits by distinguishing the PL/pgSQL variable
-- from the target_name column. Existing ownership, eligibility and grants stay unchanged.
CREATE OR REPLACE FUNCTION public.amg_crm_save_message(
  p_message_id UUID, p_body TEXT, p_target_type TEXT, p_target_id UUID, p_status TEXT,
  p_scheduled_for TIMESTAMPTZ, p_timezone TEXT, p_idempotency_key UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result UUID; resolved_target_name TEXT; recipient_count INTEGER;
BEGIN
  PERFORM amg_private.require_crm_admin();
  IF p_target_type = 'individual' THEN
    SELECT COALESCE(full_name, phone) INTO resolved_target_name FROM amg_private.crm_contacts WHERE id=p_target_id;
  ELSIF p_target_type = 'group' THEN
    SELECT name INTO resolved_target_name FROM amg_private.crm_groups WHERE id=p_target_id;
  ELSE
    RAISE EXCEPTION 'Recipient type is invalid' USING ERRCODE='22023';
  END IF;
  IF resolved_target_name IS NULL THEN RAISE EXCEPTION 'Recipient is invalid' USING ERRCODE='22023'; END IF;

  IF p_message_id IS NULL THEN
    INSERT INTO amg_private.crm_messages
      (body,target_type,target_id,target_name,status,scheduled_for,timezone,idempotency_key,created_by)
    VALUES (p_body,p_target_type,p_target_id,resolved_target_name,p_status,p_scheduled_for,p_timezone,p_idempotency_key,auth.uid())
    ON CONFLICT (idempotency_key) DO NOTHING RETURNING id INTO result;
    IF result IS NULL THEN
      SELECT id INTO result FROM amg_private.crm_messages
      WHERE idempotency_key=p_idempotency_key AND created_by=auth.uid();
      IF result IS NULL THEN RAISE EXCEPTION 'Request key is already in use' USING ERRCODE='23505'; END IF;
      RETURN result;
    END IF;
  ELSE
    UPDATE amg_private.crm_messages SET body=p_body,target_type=p_target_type,target_id=p_target_id,
      target_name=resolved_target_name,status=p_status,scheduled_for=p_scheduled_for,timezone=p_timezone,
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
