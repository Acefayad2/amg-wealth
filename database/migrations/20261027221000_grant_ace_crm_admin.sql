-- Grant website CRM access to the existing approved AMG Supabase account.
-- This does not change its password, app role, account type, or signup settings.
INSERT INTO amg_private.crm_admins (user_id)
SELECT id FROM auth.users WHERE lower(email) = lower('acefayad@gmail.com')
ON CONFLICT (user_id) DO NOTHING;
