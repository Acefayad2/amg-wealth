-- Some existing spreadsheet rows have no email yet. Keep them visible to admins;
-- the learner checklist connects once an email is added.
ALTER TABLE amg_private.licensing_people ALTER COLUMN email DROP NOT NULL;
