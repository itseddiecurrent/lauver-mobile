-- Lauver native API schema for the Render -> Supabase PostgreSQL cutover.
-- The legacy Expo schema remains in public. The native Express/Prisma API uses
-- the isolated `native` schema through PostgreSQL search_path.
-- Generated from backend/prisma/schema.prisma with Prisma 6.

CREATE SCHEMA IF NOT EXISTS native;
SET search_path = native, public;

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "AccountDeletionStatus" AS ENUM ('PENDING', 'PROCESSING', 'RETRY', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('EMAIL', 'APPLE', 'FIREBASE');

-- CreateEnum
CREATE TYPE "EmailTokenPurpose" AS ENUM ('PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('UPCOMING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SwipeDirection" AS ENUM ('PASS', 'LIKE');

-- CreateTable
CREATE TABLE "service_metadata" (
    "key" VARCHAR(100) NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_metadata_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'ADMIN',
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "csrf_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "target_type" VARCHAR(20) NOT NULL,
    "target_id" UUID,
    "reason" VARCHAR(2000) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "request_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "event_attendees" (
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_attendees_pkey" PRIMARY KEY ("event_id","user_id")
);

-- CreateTable
CREATE TABLE "strava_connections" (
    "user_id" UUID NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "athlete_id" VARCHAR(30) NOT NULL,
    "athlete_name" VARCHAR(201) NOT NULL,
    "scopes" VARCHAR(500) NOT NULL,
    "access_token_encrypted" TEXT NOT NULL,
    "refresh_token_encrypted" TEXT NOT NULL,
    "expires_at" BIGINT NOT NULL,
    "last_synced_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strava_connections_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "strava_oauth_states" (
    "state_hash" VARCHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strava_oauth_states_pkey" PRIMARY KEY ("state_hash")
);

-- CreateTable
CREATE TABLE "strava_activities" (
    "user_id" UUID NOT NULL,
    "provider_activity_id" VARCHAR(30) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "sport" VARCHAR(80) NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "distance_meters" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "strava_activities_pkey" PRIMARY KEY ("user_id","provider_activity_id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "reporter_id" UUID,
    "target_user_id" UUID,
    "target_type" VARCHAR(20) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "reason" VARCHAR(30) NOT NULL,
    "details" VARCHAR(2000),
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "snapshot" JSONB NOT NULL,
    "request_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_audit_events" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "target_id" UUID,
    "action" VARCHAR(30) NOT NULL,
    "report_id" UUID,
    "request_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "safety_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "user_id" UUID NOT NULL,
    "display_name" VARCHAR(80),
    "bio" VARCHAR(500),
    "photo_key" VARCHAR(512),
    "city_name" VARCHAR(120),
    "region_code" VARCHAR(16),
    "country_code" CHAR(2),
    "city_latitude" DECIMAL(9,6),
    "city_longitude" DECIMAL(9,6),
    "is_complete" BOOLEAN NOT NULL DEFAULT false,
    "visible_in_match" BOOLEAN NOT NULL DEFAULT false,
    "gender" VARCHAR(24),
    "match_pref_gender" VARCHAR(24) NOT NULL DEFAULT 'all',
    "match_pref_distance_km" INTEGER DEFAULT 25,
    "match_pref_sports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "swipes" (
    "actor_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "direction" "SwipeDirection" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "swipes_pkey" PRIMARY KEY ("actor_id","target_id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" UUID NOT NULL,
    "lower_user_id" UUID NOT NULL,
    "higher_user_id" UUID NOT NULL,
    "matched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unmatched_by" UUID,
    "unmatched_at" TIMESTAMPTZ(3),

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_photos" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "object_key" VARCHAR(512) NOT NULL,
    "sort_order" SMALLINT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profile_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sports" (
    "user_id" UUID NOT NULL,
    "sport" VARCHAR(32) NOT NULL,
    "pace_value" DECIMAL(9,6),
    "pace_unit" VARCHAR(20),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_sports_pkey" PRIMARY KEY ("user_id","sport")
);

-- CreateTable
CREATE TABLE "training_times" (
    "user_id" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "time_bucket" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_times_pkey" PRIMARY KEY ("user_id","weekday","time_bucket")
);

-- CreateTable
CREATE TABLE "photo_cleanup_jobs" (
    "object_key" VARCHAR(512) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photo_cleanup_jobs_pkey" PRIMARY KEY ("object_key")
);

-- CreateTable
CREATE TABLE "profile_photo_uploads" (
    "object_key" VARCHAR(512) NOT NULL,
    "user_id" UUID NOT NULL,
    "content_type" VARCHAR(32) NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_photo_uploads_pkey" PRIMARY KEY ("object_key")
);

-- CreateTable
CREATE TABLE "auth_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "provider_subject" VARCHAR(320) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apple_credentials" (
    "identity_id" UUID NOT NULL,
    "email" VARCHAR(320),
    "given_name" VARCHAR(100),
    "family_name" VARCHAR(100),
    "refresh_token_encrypted" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "apple_credentials_pkey" PRIMARY KEY ("identity_id")
);

-- CreateTable
CREATE TABLE "firebase_credentials" (
    "identity_id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "display_name" VARCHAR(160),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "firebase_credentials_pkey" PRIMARY KEY ("identity_id")
);

-- CreateTable
CREATE TABLE "password_credentials" (
    "identity_id" UUID NOT NULL,
    "password_hash" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_credentials_pkey" PRIMARY KEY ("identity_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "compromised_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "EmailTokenPurpose" NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocks" (
    "blocker_id" UUID NOT NULL,
    "blocked_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("blocker_id","blocked_id")
);

-- CreateTable
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

-- CreateIndex
CREATE INDEX "account_deletion_jobs_status_next_attempt_at_idx" ON "account_deletion_jobs"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "account_deletion_jobs_user_id_key" ON "account_deletion_jobs"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_token_hash_key" ON "admin_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "admin_sessions_admin_id_expires_at_idx" ON "admin_sessions"("admin_id", "expires_at");

-- CreateIndex
CREATE INDEX "admin_audit_logs_target_type_target_id_created_at_idx" ON "admin_audit_logs"("target_type", "target_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_audit_logs_admin_id_created_at_idx" ON "admin_audit_logs"("admin_id", "created_at");

-- CreateIndex
CREATE INDEX "events_status_starts_at_idx" ON "events"("status", "starts_at");

-- CreateIndex
CREATE INDEX "events_creator_id_starts_at_idx" ON "events"("creator_id", "starts_at");

-- CreateIndex
CREATE INDEX "event_attendees_user_id_joined_at_idx" ON "event_attendees"("user_id", "joined_at");

-- CreateIndex
CREATE INDEX "strava_connections_status_idx" ON "strava_connections"("status");

-- CreateIndex
CREATE UNIQUE INDEX "strava_oauth_states_user_id_key" ON "strava_oauth_states"("user_id");

-- CreateIndex
CREATE INDEX "strava_oauth_states_expires_at_idx" ON "strava_oauth_states"("expires_at");

-- CreateIndex
CREATE INDEX "strava_activities_user_id_started_at_idx" ON "strava_activities"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "reports_target_user_id_idx" ON "reports"("target_user_id");

-- CreateIndex
CREATE INDEX "safety_audit_events_actor_id_created_at_idx" ON "safety_audit_events"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "profiles_is_complete_idx" ON "profiles"("is_complete");

-- CreateIndex
CREATE INDEX "swipes_actor_id_direction_created_at_idx" ON "swipes"("actor_id", "direction", "created_at");

-- CreateIndex
CREATE INDEX "swipes_target_id_direction_idx" ON "swipes"("target_id", "direction");

-- CreateIndex
CREATE INDEX "matches_lower_user_id_unmatched_at_matched_at_idx" ON "matches"("lower_user_id", "unmatched_at", "matched_at");

-- CreateIndex
CREATE INDEX "matches_higher_user_id_unmatched_at_matched_at_idx" ON "matches"("higher_user_id", "unmatched_at", "matched_at");

-- CreateIndex
CREATE UNIQUE INDEX "matches_lower_user_id_higher_user_id_key" ON "matches"("lower_user_id", "higher_user_id");

-- CreateIndex
CREATE INDEX "profile_photos_user_id_sort_order_idx" ON "profile_photos"("user_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "profile_photos_user_id_object_key_key" ON "profile_photos"("user_id", "object_key");

-- CreateIndex
CREATE UNIQUE INDEX "profile_photos_user_id_sort_order_key" ON "profile_photos"("user_id", "sort_order");

-- CreateIndex
CREATE INDEX "user_sports_sport_pace_value_idx" ON "user_sports"("sport", "pace_value");

-- CreateIndex
CREATE INDEX "photo_cleanup_jobs_next_attempt_idx" ON "photo_cleanup_jobs"("next_attempt");

-- CreateIndex
CREATE INDEX "profile_photo_uploads_user_id_expires_at_idx" ON "profile_photo_uploads"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "auth_identities_user_id_idx" ON "auth_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identities_provider_provider_subject_key" ON "auth_identities"("provider", "provider_subject");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_tokens_token_hash_key" ON "email_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_tokens_user_id_purpose_idx" ON "email_tokens"("user_id", "purpose");

-- CreateIndex
CREATE INDEX "email_tokens_expires_at_idx" ON "email_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "blocks_blocked_id_blocker_id_idx" ON "blocks"("blocked_id", "blocker_id");

-- CreateIndex
CREATE INDEX "health_workouts_user_id_started_at_idx" ON "health_workouts"("user_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "health_workouts_user_id_workout_uuid_key" ON "health_workouts"("user_id", "workout_uuid");

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strava_connections" ADD CONSTRAINT "strava_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strava_oauth_states" ADD CONSTRAINT "strava_oauth_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strava_activities" ADD CONSTRAINT "strava_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "strava_connections"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_audit_events" ADD CONSTRAINT "safety_audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_audit_events" ADD CONSTRAINT "safety_audit_events_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swipes" ADD CONSTRAINT "swipes_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swipes" ADD CONSTRAINT "swipes_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_lower_user_id_fkey" FOREIGN KEY ("lower_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_higher_user_id_fkey" FOREIGN KEY ("higher_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_unmatched_by_fkey" FOREIGN KEY ("unmatched_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_photos" ADD CONSTRAINT "profile_photos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sports" ADD CONSTRAINT "user_sports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_times" ADD CONSTRAINT "training_times_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_photo_uploads" ADD CONSTRAINT "profile_photo_uploads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apple_credentials" ADD CONSTRAINT "apple_credentials_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "auth_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firebase_credentials" ADD CONSTRAINT "firebase_credentials_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "auth_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_credentials" ADD CONSTRAINT "password_credentials_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "auth_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_workouts" ADD CONSTRAINT "health_workouts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- The native API is the only production data boundary. Keep direct anonymous
-- access disabled; the Supabase postgres role used by Prisma bypasses RLS.

-- Prisma migration ledger: the schema above is the final state of all
-- backend migrations. This lets Render's Prisma client start without replaying
-- those migrations against already-created native tables.
CREATE TABLE "_prisma_migrations" (
    "id" VARCHAR(36) NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "_prisma_migrations_pkey" PRIMARY KEY ("id")
);
INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES ('ad8e6996-1a68-4403-9e85-8d4392df7def','f6b4da79fb8b19d2dd8c1548ffddf152cd25ab03514b763224a7767686dae525',CURRENT_TIMESTAMP,'20260901000000_step_01_foundation',CURRENT_TIMESTAMP,1);
INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES ('e7295045-1c5f-43c5-aa5f-16b31bf8778d','011c43beac6f374fb6051d4af25221d43e3172973c0d49786ba7188404f14de7',CURRENT_TIMESTAMP,'20260902000000_step_03_email_auth',CURRENT_TIMESTAMP,1);
INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES ('1a721366-caed-4af3-af16-e38e9084e8bb','e7e77d9abbe01d1a925e0170b7dd0a078f254bc0abd0f25dda400b07800e4436',CURRENT_TIMESTAMP,'20260906000000_step_04_sign_in_with_apple',CURRENT_TIMESTAMP,1);
INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES ('830d4f63-7d4e-4868-98b0-e9d086d4dafe','e5deb0797ef46a85658150f2ba78c7937315ae46f3971b1d6b9e8f6c4874db7e',CURRENT_TIMESTAMP,'20260910000000_step_05_workout_profiles',CURRENT_TIMESTAMP,1);
INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES ('e6ff4836-e986-409b-904d-a18340965b62','57d6eb0cd9310f1b325ce26ad475b593eecf2968ac0a0ceb5ed265e52be1d2b0',CURRENT_TIMESTAMP,'20260913000000_discover_block_policy',CURRENT_TIMESTAMP,1);
INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES ('eabd3ca8-6562-4913-ad2b-b0ca0f2e7814','80802978d9c2b80e70101f39beb40878335e656372445859bf25029c85064421',CURRENT_TIMESTAMP,'20260913010000_explicit_pace_ranges',CURRENT_TIMESTAMP,1);
INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES ('90f7bb04-fd20-4b8e-a23d-30da3338c3ef','17bf61f7cdf51af3bc149b7d45dadc0b56b2bf37a0358aa0db19230696b9afa6',CURRENT_TIMESTAMP,'20260913020000_profile_safety',CURRENT_TIMESTAMP,1);
INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES ('5d8e70d8-8542-4741-bfc1-0ced4e894649','89585c4976cbb3a47115d014c89d879ceab53fba04806ead335e46d6f3a8e00b',CURRENT_TIMESTAMP,'20260914000000_strava_readonly',CURRENT_TIMESTAMP,1);
INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES ('b798ad57-86cf-47e6-8574-febd2087675c','8ed78178b55f9c09a75b168d5e53500d506156bb7defeb69e423bd49032b1c02',CURRENT_TIMESTAMP,'20260915000000_chat_report_audit',CURRENT_TIMESTAMP,1);
INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES ('f8950e70-8e0a-47de-b197-796ea640a65c','bbc3f5e5f75f6af76d90e96c98b3511d18ac1b7785b480a4b2e0ae277918b175',CURRENT_TIMESTAMP,'20260915000000_healthkit_workouts',CURRENT_TIMESTAMP,1);
INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES ('0a3b740e-7ca2-4e0c-a5c3-dbebda28e09c','4d97f573c81c1dea9585b897b1a091a6b0052338cac40f2db0f3ce691142495b',CURRENT_TIMESTAMP,'20260916000000_step_11_events',CURRENT_TIMESTAMP,1);
INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES ('22fe3e1b-18b6-4a91-8707-fbf5647299f6','07a7068c4cfd8a94348bfa4c50ff7f0b48d22a8383bdafcb5c25b54401e7a1ef',CURRENT_TIMESTAMP,'20260917000000_step_13_admin',CURRENT_TIMESTAMP,1);
INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES ('036135d7-98d7-41d3-b91c-3acb0b9a388f','416c481993d7918436c371b1601fc0ce4857605d11fdd7635ae2c8d99f409544',CURRENT_TIMESTAMP,'20260917010000_step_14_account_deletion',CURRENT_TIMESTAMP,1);
INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES ('95a8507e-d984-45be-9a6f-eab942897daf','88aeae2b120ed56f222235d4a49b5f587de494af11af4bf0d425eb7b43d008f8',CURRENT_TIMESTAMP,'20260918000000_firebase_google_auth',CURRENT_TIMESTAMP,1);
INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES ('e0f994c9-39d2-4b01-8b48-798ba099e275','07990141dd2392369b285dc80657682ad943d8d44f20072f626506f53d6c45be',CURRENT_TIMESTAMP,'20260919000000_step_05_profile_photos',CURRENT_TIMESTAMP,1);
INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES ('dfdd09fd-67b3-4eb4-b1d0-cc4b28bbb962','94eb937e18c078c4b27c69ade52d47bc2a9f54c8bd6c583755b7afc1a366a48f',CURRENT_TIMESTAMP,'20260919010000_step_06a_match',CURRENT_TIMESTAMP,1);
INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES ('6be5c78e-5a57-409f-a592-cc77a698977d','e129cf30815f42877626643eee62c1b9dd0c507e5954fb2b141ad25c223dfaef',CURRENT_TIMESTAMP,'20260921000000_step_13_match_report_sources',CURRENT_TIMESTAMP,1);
