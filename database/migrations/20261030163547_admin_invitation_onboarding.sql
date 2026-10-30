-- Secure foundation for phone-bound AMG CRM admin invitations. This migration
-- is additive and must not be applied until phone verification is configured
-- and each intended recipient/admin grant is specifically approved.
CREATE TABLE amg_private.crm_admin_invitations (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'prepared'
    CHECK (status IN ('prepared', 'sent', 'phone_verified', 'accepted', 'failed', 'uncertain', 'revoked')),
  invited_by UUID NOT NULL REFERENCES auth.users(id),
  invited_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  provisioned_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  chosen_email TEXT,
  otp_request_count INTEGER NOT NULL DEFAULT 0 CHECK (otp_request_count BETWEEN 0 AND 5),
  last_otp_requested_at TIMESTAMPTZ,
  otp_hook_claimed_count INTEGER NOT NULL DEFAULT 0 CHECK (otp_hook_claimed_count BETWEEN 0 AND 5),
  accepted_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((status = 'accepted') = (verified_user_id IS NOT NULL AND chosen_email IS NOT NULL AND accepted_at IS NOT NULL))
);

ALTER TABLE amg_private.crm_admin_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON amg_private.crm_admin_invitations FROM PUBLIC, anon, authenticated;

-- Auth stores international phones without a leading plus; all comparisons use
-- one strict canonical representation, never a lossy punctuation-strip.
CREATE OR REPLACE FUNCTION amg_private.canonical_invite_phone(p_phone TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT CASE WHEN btrim(p_phone) ~ '^\+?[1-9][0-9]{7,14}$'
    THEN '+' || ltrim(btrim(p_phone), '+') ELSE NULL END;
$$;
REVOKE ALL ON FUNCTION amg_private.canonical_invite_phone(TEXT) FROM PUBLIC, anon, authenticated;

-- No code or credential is stored: only the signed event's identifier and outcome.
CREATE TABLE amg_private.crm_admin_otp_deliveries (
  webhook_id TEXT PRIMARY KEY CHECK (length(webhook_id) BETWEEN 1 AND 200),
  invitation_id UUID NOT NULL REFERENCES amg_private.crm_admin_invitations(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  request_number INTEGER NOT NULL CHECK (request_number BETWEEN 1 AND 5),
  status TEXT NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed', 'uncertain')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (invitation_id, request_number)
);
ALTER TABLE amg_private.crm_admin_otp_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON amg_private.crm_admin_otp_deliveries FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.amg_crm_get_admin_invitations()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result JSONB;
BEGIN
  PERFORM amg_private.require_crm_admin();
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', i.id, 'phone', i.phone,
    'status', CASE WHEN i.status IN ('prepared', 'sent', 'phone_verified') AND i.expires_at <= NOW() THEN 'expired' ELSE i.status END,
    'chosen_email', i.chosen_email, 'invited_at', i.invited_at,
    'expires_at', i.expires_at, 'accepted_at', i.accepted_at, 'created_at', i.created_at
  ) ORDER BY i.created_at DESC), '[]'::jsonb)
  INTO result FROM amg_private.crm_admin_invitations i;
  RETURN result;
END;
$$;

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
  VALUES (normalized_phone, normalized_hash, 'prepared', auth.uid(), NOW() + INTERVAL '1 hour', NULL, NULL, NULL, NULL, NOW())
  ON CONFLICT (phone) DO UPDATE SET token_hash = EXCLUDED.token_hash, status = 'prepared', invited_by = auth.uid(),
    invited_at = NULL, expires_at = NOW() + INTERVAL '1 hour', verified_user_id = NULL,
    chosen_email = NULL, last_otp_requested_at = NULL,
    accepted_at = NULL, failure_reason = NULL, updated_at = NOW()
  RETURNING * INTO invite;
  RETURN jsonb_build_object('id', invite.id, 'phone', invite.phone, 'should_send', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.amg_crm_record_phone_admin_invite_result(
  p_id UUID, p_outcome TEXT, p_failure_reason TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_outcome NOT IN ('sent', 'failed', 'uncertain') THEN
    RAISE EXCEPTION 'Invitation outcome is invalid' USING ERRCODE = '22023';
  END IF;
  UPDATE amg_private.crm_admin_invitations
  SET status = p_outcome,
      invited_at = CASE WHEN p_outcome = 'sent' THEN NOW() ELSE invited_at END,
      failure_reason = CASE WHEN p_outcome = 'sent' THEN NULL ELSE left(nullif(btrim(p_failure_reason), ''), 500) END,
      updated_at = NOW()
  WHERE id = p_id AND status = 'prepared';
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation is no longer pending' USING ERRCODE = '40001'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.amg_crm_find_auth_user_by_phone(p_phone TEXT)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT id FROM auth.users WHERE amg_private.canonical_invite_phone(phone) = amg_private.canonical_invite_phone(p_phone) LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.amg_crm_record_phone_admin_invite_user(p_id UUID, p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE amg_private.crm_admin_invitations i
  SET provisioned_user_id = p_user_id, updated_at = NOW()
  FROM auth.users u
  WHERE i.id = p_id AND i.status = 'prepared'
    AND (i.provisioned_user_id IS NULL OR i.provisioned_user_id = p_user_id)
    AND u.id = p_user_id AND amg_private.canonical_invite_phone(u.phone) = i.phone AND NULLIF(u.email, '') IS NULL AND u.phone_confirmed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The provisioned phone account does not match this invitation' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.amg_crm_invite_owns_auth_user(p_id UUID, p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM amg_private.crm_admin_invitations i
    JOIN auth.users u ON u.id = p_user_id AND amg_private.canonical_invite_phone(u.phone) = i.phone
    WHERE i.id = p_id AND i.provisioned_user_id = p_user_id
      AND i.status = 'prepared' AND NULLIF(u.email, '') IS NULL AND u.phone_confirmed_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.amg_crm_claim_phone_admin_otp(p_token TEXT, p_phone TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE claimed_id UUID;
BEGIN
  UPDATE amg_private.crm_admin_invitations
  SET otp_request_count = otp_request_count + 1, last_otp_requested_at = NOW(), updated_at = NOW()
  WHERE token_hash = encode(extensions.digest(COALESCE(p_token, ''), 'sha256'), 'hex')
    AND phone = amg_private.canonical_invite_phone(p_phone)
    AND status = 'sent' AND expires_at > NOW()
    AND otp_request_count < 5
    AND (last_otp_requested_at IS NULL OR last_otp_requested_at <= NOW() - INTERVAL '60 seconds')
  RETURNING id INTO claimed_id;
  RETURN claimed_id IS NOT NULL;
END;
$$;

-- Called only after the HTTP hook signature is verified. Consume one recent
-- private-token-authorized request under a row lock; direct Auth calls cannot
-- manufacture additional sends. Unknown outcomes are never retried automatically.
CREATE OR REPLACE FUNCTION public.amg_crm_claim_admin_otp_delivery(p_webhook_id TEXT, p_user_id UUID, p_phone TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE invite amg_private.crm_admin_invitations%ROWTYPE;
  prior amg_private.crm_admin_otp_deliveries%ROWTYPE;
BEGIN
  IF p_webhook_id IS NULL OR length(p_webhook_id) NOT BETWEEN 1 AND 200 THEN RETURN 'blocked'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_webhook_id, 1));
  SELECT * INTO prior FROM amg_private.crm_admin_otp_deliveries WHERE webhook_id = p_webhook_id;
  IF FOUND THEN
    IF prior.user_id = p_user_id AND prior.status = 'sent' THEN RETURN 'sent'; END IF;
    RETURN 'blocked';
  END IF;
  SELECT i.* INTO invite FROM amg_private.crm_admin_invitations i
  JOIN auth.users u ON u.id = p_user_id AND i.provisioned_user_id = u.id
    AND amg_private.canonical_invite_phone(u.phone) = i.phone
  WHERE i.phone = amg_private.canonical_invite_phone(p_phone)
    AND i.status = 'sent' AND i.expires_at > NOW()
  FOR UPDATE OF i;
  IF NOT FOUND OR invite.last_otp_requested_at IS NULL
    OR invite.last_otp_requested_at < NOW() - INTERVAL '30 seconds'
    OR invite.otp_request_count <= invite.otp_hook_claimed_count THEN RETURN 'blocked'; END IF;
  INSERT INTO amg_private.crm_admin_otp_deliveries (webhook_id, invitation_id, user_id, request_number)
  VALUES (p_webhook_id, invite.id, p_user_id, invite.otp_request_count);
  UPDATE amg_private.crm_admin_invitations SET otp_hook_claimed_count = otp_request_count WHERE id = invite.id;
  RETURN 'send';
END;
$$;

CREATE OR REPLACE FUNCTION public.amg_crm_record_admin_otp_delivery(p_webhook_id TEXT, p_outcome TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_outcome NOT IN ('sent', 'failed', 'uncertain') THEN RAISE EXCEPTION 'Invalid OTP outcome'; END IF;
  UPDATE amg_private.crm_admin_otp_deliveries SET status = p_outcome, updated_at = NOW()
  WHERE webhook_id = p_webhook_id AND status = 'sending';
  IF NOT FOUND THEN RAISE EXCEPTION 'OTP delivery is not pending'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.amg_crm_bind_verified_invite_phone(p_token TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE current_phone TEXT; confirmed_at TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE = '42501'; END IF;
  SELECT amg_private.canonical_invite_phone(phone), phone_confirmed_at INTO current_phone, confirmed_at FROM auth.users WHERE id = auth.uid();
  IF current_phone IS NULL OR confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Verified phone required' USING ERRCODE = '42501';
  END IF;
  UPDATE amg_private.crm_admin_invitations
  SET status = 'phone_verified', verified_user_id = auth.uid(), updated_at = NOW()
  WHERE token_hash = encode(extensions.digest(COALESCE(p_token, ''), 'sha256'), 'hex')
    AND phone = current_phone AND status IN ('sent', 'phone_verified')
    AND provisioned_user_id = auth.uid()
    AND (verified_user_id IS NULL OR verified_user_id = auth.uid()) AND expires_at > NOW();
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation does not match this verified phone' USING ERRCODE = '42501'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.amg_crm_accept_phone_admin_invite(p_token TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE current_phone TEXT; current_email TEXT; phone_confirmed TIMESTAMPTZ; email_confirmed TIMESTAMPTZ;
  invite amg_private.crm_admin_invitations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE = '42501'; END IF;
  SELECT amg_private.canonical_invite_phone(phone), NULLIF(lower(email), ''), phone_confirmed_at, email_confirmed_at
  INTO current_phone, current_email, phone_confirmed, email_confirmed
  FROM auth.users WHERE id = auth.uid();
  IF current_phone IS NULL OR phone_confirmed IS NULL OR current_email IS NULL OR email_confirmed IS NULL THEN
    RAISE EXCEPTION 'Verified phone and email required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO invite FROM amg_private.crm_admin_invitations
  WHERE token_hash = encode(extensions.digest(COALESCE(p_token, ''), 'sha256'), 'hex')
    AND phone = current_phone AND verified_user_id = auth.uid()
    AND status = 'phone_verified' AND expires_at > NOW() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation does not match this verified account' USING ERRCODE = '42501'; END IF;
  INSERT INTO amg_private.crm_admins (user_id, granted_by) VALUES (auth.uid(), invite.invited_by)
  ON CONFLICT (user_id) DO NOTHING;
  UPDATE amg_private.crm_admin_invitations SET status = 'accepted', chosen_email = current_email,
    accepted_at = NOW(), updated_at = NOW() WHERE id = invite.id;
END;
$$;

REVOKE ALL ON FUNCTION public.amg_crm_get_admin_invitations() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.amg_crm_prepare_phone_admin_invite(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.amg_crm_record_phone_admin_invite_result(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.amg_crm_find_auth_user_by_phone(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.amg_crm_record_phone_admin_invite_user(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.amg_crm_invite_owns_auth_user(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.amg_crm_claim_phone_admin_otp(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.amg_crm_bind_verified_invite_phone(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.amg_crm_accept_phone_admin_invite(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.amg_crm_get_admin_invitations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.amg_crm_prepare_phone_admin_invite(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.amg_crm_bind_verified_invite_phone(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.amg_crm_accept_phone_admin_invite(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.amg_crm_record_phone_admin_invite_result(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.amg_crm_find_auth_user_by_phone(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.amg_crm_record_phone_admin_invite_user(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.amg_crm_invite_owns_auth_user(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.amg_crm_claim_phone_admin_otp(TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.amg_crm_claim_admin_otp_delivery(TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.amg_crm_record_admin_otp_delivery(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.amg_crm_claim_admin_otp_delivery(TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.amg_crm_record_admin_otp_delivery(TEXT, TEXT) TO service_role;
