CREATE INDEX crm_recurring_reminders_target_group_idx
  ON amg_private.crm_recurring_reminders (target_group_id)
  WHERE target_group_id IS NOT NULL;
CREATE INDEX crm_recurring_reminders_created_by_idx
  ON amg_private.crm_recurring_reminders (created_by);
CREATE INDEX crm_recurring_reminders_updated_by_idx
  ON amg_private.crm_recurring_reminders (updated_by);
CREATE INDEX crm_recurring_occurrences_message_idx
  ON amg_private.crm_recurring_occurrences (message_id)
  WHERE message_id IS NOT NULL;
