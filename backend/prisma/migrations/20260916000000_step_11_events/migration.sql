CREATE TYPE "EventStatus" AS ENUM ('UPCOMING', 'CANCELLED');

CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "creator_id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(2000),
    "sport" VARCHAR(32) NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "venue_name" VARCHAR(200) NOT NULL,
    "venue_address" VARCHAR(500),
    "venue_latitude" DECIMAL(9,6) NOT NULL,
    "venue_longitude" DECIMAL(9,6) NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'UPCOMING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "event_attendees" (
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_attendees_pkey" PRIMARY KEY ("event_id", "user_id")
);

CREATE INDEX "events_status_starts_at_idx" ON "events"("status", "starts_at");
CREATE INDEX "events_creator_id_starts_at_idx" ON "events"("creator_id", "starts_at");
CREATE INDEX "event_attendees_user_id_joined_at_idx" ON "event_attendees"("user_id", "joined_at");

ALTER TABLE "events" ADD CONSTRAINT "events_creator_id_fkey"
  FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
