CREATE TABLE "health_workouts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "workout_uuid" UUID NOT NULL,
    "sport" VARCHAR(80) NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "distance_meters" DOUBLE PRECISION,
    "imported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "health_workouts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "health_workouts_user_id_workout_uuid_key" ON "health_workouts"("user_id", "workout_uuid");
CREATE INDEX "health_workouts_user_id_started_at_idx" ON "health_workouts"("user_id", "started_at");
ALTER TABLE "health_workouts" ADD CONSTRAINT "health_workouts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
