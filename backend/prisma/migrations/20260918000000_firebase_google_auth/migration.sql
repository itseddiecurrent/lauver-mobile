ALTER TYPE "AuthProvider" ADD VALUE IF NOT EXISTS 'FIREBASE';

CREATE TABLE "firebase_credentials" (
    "identity_id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "display_name" VARCHAR(160),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "firebase_credentials_pkey" PRIMARY KEY ("identity_id")
);

ALTER TABLE "firebase_credentials"
ADD CONSTRAINT "firebase_credentials_identity_id_fkey"
FOREIGN KEY ("identity_id") REFERENCES "auth_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
