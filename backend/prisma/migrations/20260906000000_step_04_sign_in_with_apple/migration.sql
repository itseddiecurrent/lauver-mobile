ALTER TYPE "AuthProvider" ADD VALUE IF NOT EXISTS 'APPLE';

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

ALTER TABLE "apple_credentials"
ADD CONSTRAINT "apple_credentials_identity_id_fkey"
FOREIGN KEY ("identity_id") REFERENCES "auth_identities"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
