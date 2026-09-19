CREATE TABLE "profile_photos" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "object_key" VARCHAR(512) NOT NULL,
    "sort_order" SMALLINT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "profile_photos_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "profile_photos_user_id_object_key_key" UNIQUE ("user_id", "object_key"),
    CONSTRAINT "profile_photos_user_id_sort_order_key" UNIQUE ("user_id", "sort_order"),
    CONSTRAINT "profile_photos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "profile_photos_user_id_sort_order_idx" ON "profile_photos"("user_id", "sort_order");
INSERT INTO "profile_photos" ("id", "user_id", "object_key", "sort_order", "is_primary", "updated_at")
SELECT md5(random()::text || clock_timestamp()::text)::uuid, "user_id", "photo_key", 0, true, CURRENT_TIMESTAMP
FROM "profiles" WHERE "photo_key" IS NOT NULL;
