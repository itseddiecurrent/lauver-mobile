ALTER TABLE "profiles"
  ADD COLUMN "visible_in_match" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "gender" VARCHAR(24),
  ADD COLUMN "match_pref_gender" VARCHAR(24) NOT NULL DEFAULT 'all',
  ADD COLUMN "match_pref_distance_km" INTEGER DEFAULT 25,
  ADD COLUMN "match_pref_sports" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_match_pref_gender_check" CHECK ("match_pref_gender" IN ('all', 'male', 'female', 'other')),
  ADD CONSTRAINT "profiles_match_pref_distance_check" CHECK ("match_pref_distance_km" IN (5, 10, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100) OR "match_pref_distance_km" IS NULL),
  ADD CONSTRAINT "profiles_gender_check" CHECK ("gender" IS NULL OR "gender" IN ('male', 'female', 'other', 'prefer_not_to_say'));

CREATE TYPE "SwipeDirection" AS ENUM ('PASS', 'LIKE');

CREATE TABLE "swipes" (
  "actor_id" UUID NOT NULL,
  "target_id" UUID NOT NULL,
  "direction" "SwipeDirection" NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "swipes_pkey" PRIMARY KEY ("actor_id", "target_id"),
  CONSTRAINT "swipes_no_self" CHECK ("actor_id" <> "target_id"),
  CONSTRAINT "swipes_actor_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "swipes_target_fkey" FOREIGN KEY ("target_id") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE INDEX "swipes_actor_direction_created_at_idx" ON "swipes"("actor_id", "direction", "created_at");
CREATE INDEX "swipes_target_direction_idx" ON "swipes"("target_id", "direction");

CREATE TABLE "matches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "lower_user_id" UUID NOT NULL,
  "higher_user_id" UUID NOT NULL,
  "matched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "unmatched_by" UUID,
  "unmatched_at" TIMESTAMPTZ(3),
  CONSTRAINT "matches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "matches_canonical_order" CHECK ("lower_user_id" < "higher_user_id"),
  CONSTRAINT "matches_lower_fkey" FOREIGN KEY ("lower_user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "matches_higher_fkey" FOREIGN KEY ("higher_user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "matches_unmatched_by_fkey" FOREIGN KEY ("unmatched_by") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "matches_unmatched_pair_check" CHECK ("unmatched_by" IS NULL OR "unmatched_by" = "lower_user_id" OR "unmatched_by" = "higher_user_id")
);
CREATE UNIQUE INDEX "matches_lower_higher_key" ON "matches"("lower_user_id", "higher_user_id");
CREATE INDEX "matches_lower_active_idx" ON "matches"("lower_user_id", "unmatched_at", "matched_at");
CREATE INDEX "matches_higher_active_idx" ON "matches"("higher_user_id", "unmatched_at", "matched_at");
