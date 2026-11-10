-- AMG licensing pipeline. Private schema; only server-side functions use this table.
CREATE TABLE amg_private.licensing_people (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  full_name TEXT NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 160),
  email TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  phone TEXT,
  recruiter TEXT,
  state TEXT,
  track TEXT NOT NULL DEFAULT 'both' CHECK (track IN ('life', 'health', 'both')),
  exam_date DATE,
  exam_status TEXT NOT NULL DEFAULT 'studying' CHECK (exam_status IN ('studying', 'scheduled', 'rescheduled', 'failed', 'passed')),
  blocker TEXT,
  next_action TEXT,
  follow_up_date DATE,
  first_check_date DATE,
  tasks JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(tasks) = 'object'),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'course')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX licensing_people_email_key ON amg_private.licensing_people (lower(email));
CREATE INDEX licensing_people_follow_up_idx ON amg_private.licensing_people (follow_up_date) WHERE follow_up_date IS NOT NULL;
CREATE INDEX licensing_people_exam_status_idx ON amg_private.licensing_people (exam_status);
REVOKE ALL ON amg_private.licensing_people FROM PUBLIC, anon, authenticated;
