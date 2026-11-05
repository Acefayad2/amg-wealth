-- Server-only role for website inquiry storage. Configure its login credential
-- separately; never commit a database password or connection URL.
CREATE ROLE amg_inquiries NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE postgres TO amg_inquiries;
GRANT USAGE ON SCHEMA amg_private TO amg_inquiries;
GRANT SELECT, INSERT ON amg_private.crm_inquiries TO amg_inquiries;
GRANT UPDATE (id) ON amg_private.crm_inquiries TO amg_inquiries;
GRANT SELECT (user_id) ON amg_private.crm_admins TO amg_inquiries;
CREATE POLICY inquiry_service_read ON amg_private.crm_inquiries FOR SELECT TO amg_inquiries USING (true);
CREATE POLICY inquiry_service_insert ON amg_private.crm_inquiries FOR INSERT TO amg_inquiries WITH CHECK (true);
CREATE POLICY inquiry_service_retry ON amg_private.crm_inquiries FOR UPDATE TO amg_inquiries USING (true) WITH CHECK (true);
COMMENT ON ROLE amg_inquiries IS 'Server-only AMG inquiry storage and admin-membership lookup. No SMS or contact access.';
