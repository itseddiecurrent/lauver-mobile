ALTER TABLE "reports" DROP CONSTRAINT IF EXISTS "reports_target_type_check";

ALTER TABLE "reports"
  ADD CONSTRAINT "reports_target_type_check"
  CHECK ("target_type" IN ('user', 'event', 'message', 'match', 'like'));
