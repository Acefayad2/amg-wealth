ALTER TABLE amg_private.licensing_people ADD COLUMN exam_time TIME(0);
CREATE TABLE amg_private.licensing_calendar_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  pin_hash TEXT NOT NULL,
  feed_token TEXT NOT NULL DEFAULT replace(extensions.gen_random_uuid()::text || extensions.gen_random_uuid()::text, '-', ''),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE amg_private.licensing_calendar_access (
  admin_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unlock_hash TEXT,
  unlock_expires_at TIMESTAMPTZ
);
ALTER TABLE amg_private.licensing_calendar_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE amg_private.licensing_calendar_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON amg_private.licensing_calendar_settings, amg_private.licensing_calendar_access FROM PUBLIC, anon, authenticated;
