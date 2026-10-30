-- Cover CRM foreign keys used for account cleanup, audit lookups, and membership joins.
CREATE INDEX crm_admins_granted_by_idx ON amg_private.crm_admins (granted_by)
  WHERE granted_by IS NOT NULL;
CREATE INDEX crm_contacts_created_by_idx ON amg_private.crm_contacts (created_by);
CREATE INDEX crm_contacts_updated_by_idx ON amg_private.crm_contacts (updated_by);
CREATE INDEX crm_group_members_contact_idx ON amg_private.crm_group_members (contact_id);
CREATE INDEX crm_group_members_added_by_idx ON amg_private.crm_group_members (added_by);
CREATE INDEX crm_recipients_contact_idx ON amg_private.crm_message_recipients (contact_id);
CREATE INDEX crm_messages_created_by_idx ON amg_private.crm_messages (created_by);
