ALTER TABLE amg_private.licensing_people
  ADD COLUMN recruiter_phone TEXT CHECK (recruiter_phone IS NULL OR recruiter_phone ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$');
