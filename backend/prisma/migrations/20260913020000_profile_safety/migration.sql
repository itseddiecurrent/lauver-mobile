CREATE TABLE "reports" (
  "id" UUID NOT NULL PRIMARY KEY,
  "reporter_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "target_user_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "target_type" VARCHAR(20) NOT NULL CHECK (target_type IN ('user','event','message')),
  "source" VARCHAR(20) NOT NULL,
  "reason" VARCHAR(30) NOT NULL CHECK (reason IN ('spam','harassment','hate_abuse','unsafe_event','impersonation','other')),
  "details" VARCHAR(2000),
  "status" VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','resolved','dismissed')),
  "snapshot" JSONB NOT NULL,
  "request_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (reporter_id IS NULL OR target_user_id IS NULL OR reporter_id <> target_user_id)
);
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status","created_at");
CREATE INDEX "reports_target_user_id_idx" ON "reports"("target_user_id");

-- Evidence cannot be rewritten when a profile or report workflow changes.
CREATE FUNCTION preserve_report_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.details IS DISTINCT FROM OLD.details OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.target_type IS DISTINCT FROM OLD.target_type OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.request_id IS DISTINCT FROM OLD.request_id THEN
    RAISE EXCEPTION 'Report evidence is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reports_preserve_evidence BEFORE UPDATE ON reports FOR EACH ROW EXECUTE FUNCTION preserve_report_evidence();

CREATE TABLE "safety_audit_events" (
  "id" UUID NOT NULL PRIMARY KEY,
  "actor_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "target_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "action" VARCHAR(30) NOT NULL CHECK (action IN ('block','unblock','report','report_and_block')),
  "report_id" UUID,
  "request_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "safety_audit_events_actor_id_created_at_idx" ON "safety_audit_events"("actor_id","created_at");
