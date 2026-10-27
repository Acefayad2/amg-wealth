-- Isolated AMG website CRM storage. Existing app tables, policies, roles, and
-- authentication settings are intentionally unchanged.
CREATE SCHEMA IF NOT EXISTS amg_private;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE amg_private.crm_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE amg_private.crm_contacts (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  full_name TEXT NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 160),
  phone TEXT NOT NULL UNIQUE CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  consent_status TEXT NOT NULL DEFAULT 'pending' CHECK (consent_status IN ('pending', 'opted_in', 'opted_out')),
  consent_evidence TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_by UUID NOT NULL REFERENCES auth.users(id),
  updated_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (consent_status <> 'opted_in' OR nullif(btrim(consent_evidence), '') IS NOT NULL)
);

CREATE TABLE amg_private.crm_groups (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (name IN ('Marketing Directors', 'AMG Hierarchy', 'AMG Baseshop'))
);

INSERT INTO amg_private.crm_groups (name) VALUES
  ('Marketing Directors'), ('AMG Hierarchy'), ('AMG Baseshop');

CREATE TABLE amg_private.crm_group_members (
  group_id UUID NOT NULL REFERENCES amg_private.crm_groups(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES amg_private.crm_contacts(id) ON DELETE CASCADE,
  added_by UUID NOT NULL REFERENCES auth.users(id),
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, contact_id)
);

CREATE TABLE amg_private.crm_messages (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1600),
  target_type TEXT NOT NULL CHECK (target_type IN ('individual', 'group')),
  target_id UUID NOT NULL,
  target_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed')),
  scheduled_for TIMESTAMPTZ,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  idempotency_key UUID NOT NULL UNIQUE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status <> 'scheduled' OR scheduled_for IS NOT NULL)
);

CREATE TABLE amg_private.crm_message_recipients (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES amg_private.crm_messages(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES amg_private.crm_contacts(id),
  phone_snapshot TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sending', 'sent', 'failed', 'skipped_opt_out')),
  quo_message_id TEXT,
  failure_reason TEXT,
  claimed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  UNIQUE (message_id, contact_id)
);

CREATE INDEX crm_messages_due_idx ON amg_private.crm_messages (scheduled_for) WHERE status = 'scheduled';
CREATE INDEX crm_recipients_message_idx ON amg_private.crm_message_recipients (message_id, status);

REVOKE ALL ON amg_private.crm_admins, amg_private.crm_contacts, amg_private.crm_groups,
  amg_private.crm_group_members, amg_private.crm_messages, amg_private.crm_message_recipients
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION amg_private.is_crm_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM amg_private.crm_admins WHERE user_id = (SELECT auth.uid()));
$$;

CREATE OR REPLACE FUNCTION amg_private.require_crm_admin()
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT amg_private.is_crm_admin() THEN
    RAISE EXCEPTION 'AMG CRM admin access required' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION amg_private.is_crm_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION amg_private.require_crm_admin() FROM PUBLIC, anon, authenticated;

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
    ) rows), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.amg_crm_save_contact(
  p_id UUID, p_full_name TEXT, p_phone TEXT, p_consent_status TEXT, p_consent_evidence TEXT, p_timezone TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result UUID;
BEGIN
  PERFORM amg_private.require_crm_admin();
  IF p_id IS NULL THEN
    INSERT INTO amg_private.crm_contacts
      (full_name, phone, consent_status, consent_evidence, timezone, created_by, updated_by)
    VALUES (p_full_name, p_phone, p_consent_status, nullif(btrim(p_consent_evidence), ''), p_timezone, auth.uid(), auth.uid())
    RETURNING id INTO result;
  ELSE
    UPDATE amg_private.crm_contacts SET full_name=p_full_name, phone=p_phone,
      consent_status=p_consent_status, consent_evidence=nullif(btrim(p_consent_evidence), ''),
      timezone=p_timezone, updated_by=auth.uid(), updated_at=NOW()
    WHERE id=p_id RETURNING id INTO result;
    IF result IS NULL THEN RAISE EXCEPTION 'Contact is invalid' USING ERRCODE='22023'; END IF;
  END IF;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.amg_crm_set_membership(p_contact_id UUID, p_group_id UUID, p_is_member BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM amg_private.require_crm_admin();
  IF p_is_member THEN
    INSERT INTO amg_private.crm_group_members (group_id, contact_id, added_by)
    VALUES (p_group_id, p_contact_id, auth.uid()) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM amg_private.crm_group_members WHERE group_id=p_group_id AND contact_id=p_contact_id;
  END IF;
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
    SELECT full_name INTO target_name FROM amg_private.crm_contacts WHERE id=p_target_id;
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

REVOKE ALL ON FUNCTION public.amg_crm_get_state() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.amg_crm_save_contact(UUID,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.amg_crm_set_membership(UUID,UUID,BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.amg_crm_save_message(UUID,TEXT,TEXT,UUID,TEXT,TIMESTAMPTZ,TEXT,UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.amg_crm_get_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.amg_crm_save_contact(UUID,TEXT,TEXT,TEXT,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.amg_crm_set_membership(UUID,UUID,BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.amg_crm_save_message(UUID,TEXT,TEXT,UUID,TEXT,TIMESTAMPTZ,TEXT,UUID) TO authenticated;

COMMENT ON TABLE amg_private.crm_contacts IS
  'AMG website communications directory. Records are manual; website and app contacts are not imported.';
COMMENT ON TABLE amg_private.crm_admins IS
  'Website CRM access list, separate from AMG app staff roles and signup settings.';
