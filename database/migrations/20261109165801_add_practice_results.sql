-- Additive, private storage. Review and apply before deploying results intake.
-- No new accounts, credentials, policies granting client access, or admin grants.
CREATE TABLE amg_private.practice_results (
  id UUID PRIMARY KEY,
  full_name TEXT NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 160),
  email TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  exam_type TEXT NOT NULL CHECK (char_length(exam_type) BETWEEN 1 AND 120),
  score INTEGER NOT NULL CHECK (score >= 0),
  total INTEGER NOT NULL CHECK (total BETWEEN 1 AND 1000),
  wrong INTEGER NOT NULL CHECK (wrong >= 0),
  skipped INTEGER NOT NULL CHECK (skipped >= 0),
  early_fail BOOLEAN NOT NULL,
  percentage INTEGER NOT NULL CHECK (percentage BETWEEN 0 AND 100),
  passed BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (score + wrong + skipped = total)
);
CREATE INDEX practice_results_received_idx ON amg_private.practice_results (created_at DESC,id DESC);
ALTER TABLE amg_private.practice_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON amg_private.practice_results FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE amg_private.practice_results IS 'Self-reported practice scores, not licensing certification. Server writes; reads only after existing CRM admin verification. No email dispatch.';
