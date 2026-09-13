CREATE TABLE "blocks" (
  "blocker_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "blocked_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("blocker_id", "blocked_id"),
  CONSTRAINT "blocks_no_self" CHECK ("blocker_id" <> "blocked_id")
);
CREATE INDEX "blocks_blocked_id_blocker_id_idx" ON "blocks"("blocked_id", "blocker_id");
