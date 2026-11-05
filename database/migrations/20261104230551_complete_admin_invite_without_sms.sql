-- Existing private invitation URLs remain usable, including those bound to
-- the phone-only Auth placeholders created by the previous issuer.
CREATE FUNCTION public.amg_crm_admin_invite_available(p_token_hash text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM amg_private.crm_admin_invitations i
    WHERE i.token_hash = p_token_hash
      AND i.status IN ('sent', 'phone_verified') AND i.expires_at > clock_timestamp()
      AND EXISTS (SELECT 1 FROM amg_private.crm_admins a WHERE a.user_id = i.invited_by)
      AND (i.provisioned_user_id IS NULL OR EXISTS (
        SELECT 1 FROM auth.users u WHERE u.id = i.provisioned_user_id
          AND amg_private.canonical_invite_phone(u.phone) = i.phone
      ))
  );
$$;
REVOKE ALL ON FUNCTION public.amg_crm_admin_invite_available(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.amg_crm_admin_invite_available(text) TO service_role;

-- A recipient who previously verified their phone and email can finish
-- the original flow with their own existing password and verified identity.
CREATE FUNCTION public.amg_crm_admin_invite_legacy_user(p_token_hash text, p_email text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT u.id FROM amg_private.crm_admin_invitations i
  JOIN auth.users u ON u.id = i.verified_user_id AND u.id = i.provisioned_user_id
  WHERE i.token_hash = p_token_hash AND i.status = 'phone_verified'
    AND public.amg_crm_admin_invite_available(p_token_hash)
    AND u.phone_confirmed_at IS NOT NULL AND u.email_confirmed_at IS NOT NULL
    AND lower(u.email) = lower(btrim(p_email));
$$;
REVOKE ALL ON FUNCTION public.amg_crm_admin_invite_legacy_user(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.amg_crm_admin_invite_legacy_user(text,text) TO service_role;

-- GoTrue creates the user, email identity, app metadata and confirmed email
-- within one transaction. A marker supplied exclusively by the Admin API
-- defers this work until those fields exist. Rejection rolls back the entire
-- creation, including on concurrent attempts to redeem the same link.
CREATE FUNCTION amg_private.complete_admin_invite_on_auth_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  claim_hash text := NEW.raw_app_meta_data->>'amg_crm_invite_hash';
  invite amg_private.crm_admin_invitations%ROWTYPE;
  account_email text;
  completed_at timestamptz;
BEGIN
  SELECT * INTO invite FROM amg_private.crm_admin_invitations
    WHERE token_hash = claim_hash FOR UPDATE;
  IF NOT FOUND OR NOT public.amg_crm_admin_invite_available(claim_hash) THEN
    RAISE EXCEPTION 'This invitation has expired or has already been used' USING ERRCODE = '42501';
  END IF;
  SELECT lower(u.email) INTO account_email FROM auth.users u
    WHERE u.id = NEW.id AND u.email_confirmed_at IS NOT NULL AND nullif(u.email, '') IS NOT NULL
      AND nullif(u.encrypted_password, '') IS NOT NULL AND nullif(u.phone, '') IS NULL
      AND u.raw_app_meta_data->>'amg_crm_invite_hash' = claim_hash;
  IF account_email IS NULL THEN
    RAISE EXCEPTION 'The invited email account could not be created' USING ERRCODE = '42501';
  END IF;

  INSERT INTO amg_private.crm_admins (user_id, granted_by) VALUES (NEW.id, invite.invited_by);
  completed_at := clock_timestamp();
  UPDATE amg_private.crm_admin_invitations
    SET status = 'accepted', chosen_email = account_email, verified_user_id = NEW.id,
        accepted_at = completed_at, expires_at = completed_at, updated_at = completed_at
    WHERE id = invite.id;
  UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data - 'amg_crm_invite_hash' WHERE id = NEW.id;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION amg_private.complete_admin_invite_on_auth_write() FROM PUBLIC, anon, authenticated;

CREATE CONSTRAINT TRIGGER amg_crm_invite_account_insert
AFTER INSERT ON auth.users DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (NEW.raw_app_meta_data ? 'amg_crm_invite_hash')
EXECUTE FUNCTION amg_private.complete_admin_invite_on_auth_write();

CREATE CONSTRAINT TRIGGER amg_crm_invite_account_marker
AFTER UPDATE ON auth.users DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (NEW.raw_app_meta_data ? 'amg_crm_invite_hash'
  AND (NEW.raw_app_meta_data->>'amg_crm_invite_hash') IS DISTINCT FROM (OLD.raw_app_meta_data->>'amg_crm_invite_hash'))
EXECUTE FUNCTION amg_private.complete_admin_invite_on_auth_write();
