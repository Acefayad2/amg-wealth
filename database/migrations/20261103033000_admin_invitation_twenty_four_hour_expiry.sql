-- Extend newly prepared/reissued private invitation links to twenty-four hours.
-- Existing invitations, OTP limits, single-use gates and function grants remain unchanged.
CREATE OR REPLACE FUNCTION public.amg_crm_prepare_phone_admin_invite(p_phone TEXT, p_token_hash TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  normalized_phone TEXT := btrim(COALESCE(p_phone, ''));
  normalized_hash TEXT := lower(btrim(COALESCE(p_token_hash, '')));
  invite amg_private.crm_admin_invitations%ROWTYPE;
BEGIN
  PERFORM amg_private.require_crm_admin();
  IF normalized_phone !~ '^\+[1-9][0-9]{7,14}$' OR normalized_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invitation phone or token is invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(normalized_phone, 0));
  SELECT * INTO invite FROM amg_private.crm_admin_invitations WHERE phone = normalized_phone FOR UPDATE;
  IF FOUND AND invite.status = 'accepted' THEN
    RAISE EXCEPTION 'This phone already completed an AMG CRM invitation' USING ERRCODE = '23505';
  END IF;
  -- A prepared operation may already have reached the provider if its outcome
  -- recording failed. Never reset it or an uncertain operation, even after expiry.
  IF FOUND AND (invite.status IN ('prepared', 'uncertain') OR
    (invite.status IN ('sent', 'phone_verified') AND invite.expires_at > NOW())) THEN
    RETURN jsonb_build_object('id', invite.id, 'phone', invite.phone, 'should_send', false);
  END IF;
  INSERT INTO amg_private.crm_admin_invitations
    (phone, token_hash, status, invited_by, expires_at, verified_user_id, chosen_email, accepted_at, failure_reason, updated_at)
  VALUES (normalized_phone, normalized_hash, 'prepared', auth.uid(), NOW() + INTERVAL '24 hours', NULL, NULL, NULL, NULL, NOW())
  ON CONFLICT (phone) DO UPDATE SET token_hash = EXCLUDED.token_hash, status = 'prepared', invited_by = auth.uid(),
    invited_at = NULL, expires_at = NOW() + INTERVAL '24 hours', verified_user_id = NULL,
    chosen_email = NULL, last_otp_requested_at = NULL,
    accepted_at = NULL, failure_reason = NULL, updated_at = NOW()
  RETURNING * INTO invite;
  RETURN jsonb_build_object('id', invite.id, 'phone', invite.phone, 'should_send', true);
END;
$$;
