CREATE TYPE "AccountDeletionStatus" AS ENUM ('PENDING', 'PROCESSING', 'RETRY', 'COMPLETED');

CREATE TABLE "account_deletion_jobs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "AccountDeletionStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    CONSTRAINT "account_deletion_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "account_deletion_jobs_user_id_key" ON "account_deletion_jobs"("user_id");
CREATE INDEX "account_deletion_jobs_status_next_attempt_at_idx" ON "account_deletion_jobs"("status", "next_attempt_at");
