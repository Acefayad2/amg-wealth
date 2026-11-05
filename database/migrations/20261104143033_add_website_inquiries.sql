CREATE TABLE amg_private.crm_inquiries (
  id UUID PRIMARY KEY,
  full_name TEXT NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 160),
  email TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254 AND position('@' IN email) > 1),
  phone TEXT NOT NULL DEFAULT '' CHECK (char_length(phone) <= 40),
  interest TEXT NOT NULL CHECK (interest IN ('Wealth Creation', 'Asset Protection', 'Retirement Planning', 'Financial Education', 'Generational Legacy', 'The Full Blueprint')),
  message TEXT NOT NULL DEFAULT '' CHECK (char_length(message) <= 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX crm_inquiries_received_idx ON amg_private.crm_inquiries (created_at DESC, id DESC);
ALTER TABLE amg_private.crm_inquiries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON amg_private.crm_inquiries FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE amg_private.crm_inquiries IS 'Website consultation inquiries. Server-only writes; reads require verified membership in crm_admins. Separate from SMS contacts and consent.';
