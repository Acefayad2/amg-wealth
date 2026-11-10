ALTER TABLE amg_private.licensing_people
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
