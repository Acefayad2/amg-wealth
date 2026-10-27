-- Prepared migration. Apply to the approved AMG CRM Postgres database before
-- setting AMG_CRM_DATABASE_URL; it is not applied by this deployment.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE amg_crm_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 160),
  phone TEXT NOT NULL UNIQUE CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  consent_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (consent_status IN ('pending', 'opted_in', 'opted_out')),
  consent_evidence TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (consent_status <> 'opted_in' OR nullif(btrim(consent_evidence), '') IS NOT NULL)
);

CREATE TABLE amg_crm_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (name IN ('Marketing Directors', 'AMG Hierarchy', 'AMG Baseshop'))
);

INSERT INTO amg_crm_groups (name) VALUES
  ('Marketing Directors'),
  ('AMG Hierarchy'),
  ('AMG Baseshop');

CREATE TABLE amg_crm_group_members (
  group_id UUID NOT NULL REFERENCES amg_crm_groups(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES amg_crm_contacts(id) ON DELETE CASCADE,
  added_by TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, contact_id)
);

CREATE TABLE amg_crm_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1600),
  target_type TEXT NOT NULL CHECK (target_type IN ('individual', 'group')),
  target_id UUID NOT NULL,
  target_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed')),
  scheduled_for TIMESTAMPTZ,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  idempotency_key UUID NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status <> 'scheduled' OR scheduled_for IS NOT NULL)
);

CREATE TABLE amg_crm_message_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES amg_crm_messages(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES amg_crm_contacts(id),
  phone_snapshot TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'sending', 'sent', 'failed', 'skipped_opt_out')),
  quo_message_id TEXT,
  failure_reason TEXT,
  claimed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  UNIQUE (message_id, contact_id)
);

CREATE INDEX amg_crm_messages_due_idx
  ON amg_crm_messages (scheduled_for)
  WHERE status = 'scheduled';
CREATE INDEX amg_crm_recipients_message_idx
  ON amg_crm_message_recipients (message_id, status);

COMMENT ON TABLE amg_crm_contacts IS
  'AMG communication directory. Records are created manually; no website submissions are imported automatically.';
COMMENT ON COLUMN amg_crm_contacts.consent_evidence IS
  'Human-readable evidence supporting an opted-in status. Opt-out always overrides group membership.';
COMMENT ON TABLE amg_crm_message_recipients IS
  'Recipient snapshots used for atomic dispatch claiming and duplicate-send prevention.';
