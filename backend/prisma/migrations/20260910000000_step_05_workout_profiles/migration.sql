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
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "profiles_city_coordinates_pair" CHECK (
      ("city_latitude" IS NULL AND "city_longitude" IS NULL) OR
      ("city_latitude" IS NOT NULL AND "city_longitude" IS NOT NULL AND
       "city_latitude" BETWEEN -90 AND 90 AND "city_longitude" BETWEEN -180 AND 180)
    )
);

CREATE TABLE "user_sports" (
    "user_id" UUID NOT NULL,
    "sport" VARCHAR(32) NOT NULL,
    "pace_value" DECIMAL(7,2),
    "pace_unit" VARCHAR(20),
    "pace_bracket" VARCHAR(20),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "user_sports_pkey" PRIMARY KEY ("user_id", "sport"),
    CONSTRAINT "user_sports_pace_fields" CHECK (
      ("pace_value" IS NULL AND "pace_unit" IS NULL AND "pace_bracket" IS NULL) OR
      ("pace_value" > 0 AND "pace_unit" IS NOT NULL AND "pace_bracket" IS NOT NULL)
    )
);

CREATE TABLE "training_times" (
    "user_id" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "time_bucket" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "training_times_pkey" PRIMARY KEY ("user_id", "weekday", "time_bucket"),
    CONSTRAINT "training_times_weekday" CHECK ("weekday" BETWEEN 1 AND 7),
    CONSTRAINT "training_times_bucket" CHECK ("time_bucket" IN ('morning', 'midday', 'evening'))
);

CREATE TABLE "photo_cleanup_jobs" (
    "object_key" VARCHAR(512) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "photo_cleanup_jobs_pkey" PRIMARY KEY ("object_key")
);

CREATE TABLE "profile_photo_uploads" (
    "object_key" VARCHAR(512) NOT NULL,
    "user_id" UUID NOT NULL,
    "content_type" VARCHAR(32) NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "profile_photo_uploads_pkey" PRIMARY KEY ("object_key"),
    CONSTRAINT "profile_photo_uploads_byte_size" CHECK ("byte_size" BETWEEN 1 AND 5242880)
);

CREATE INDEX "profiles_is_complete_idx" ON "profiles"("is_complete");
CREATE INDEX "user_sports_sport_pace_bracket_idx" ON "user_sports"("sport", "pace_bracket");
CREATE INDEX "photo_cleanup_jobs_next_attempt_idx" ON "photo_cleanup_jobs"("next_attempt");
CREATE INDEX "profile_photo_uploads_user_id_expires_at_idx" ON "profile_photo_uploads"("user_id", "expires_at");

ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_sports" ADD CONSTRAINT "user_sports_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_times" ADD CONSTRAINT "training_times_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "profile_photo_uploads" ADD CONSTRAINT "profile_photo_uploads_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
