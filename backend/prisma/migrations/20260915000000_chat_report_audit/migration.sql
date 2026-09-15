BEGIN;
ALTER TABLE safety_audit_events DROP CONSTRAINT safety_audit_events_action_check;
ALTER TABLE safety_audit_events ADD CONSTRAINT safety_audit_events_action_check
  CHECK (action IN ('block','unblock','report','report_and_block','report_message'));
COMMIT;
