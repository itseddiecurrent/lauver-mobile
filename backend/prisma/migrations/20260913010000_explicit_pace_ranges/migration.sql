-- Retain each user's actual pace and increase precision for mm:ss input.
ALTER TABLE "user_sports" ALTER COLUMN "pace_value" TYPE DECIMAL(9,6);
-- Old two-decimal minute values displayed as whole seconds. Canonicalize those
-- displayed seconds so an exact mm:ss range still includes existing profiles.
UPDATE "user_sports"
SET "pace_value" = ROUND(ROUND("pace_value" * 60) / 60, 6)
WHERE "pace_unit" IN ('min/km', 'min/100m', 'min/500m') AND "pace_value" IS NOT NULL;
DROP INDEX "user_sports_sport_pace_bracket_idx";
ALTER TABLE "user_sports" DROP CONSTRAINT "user_sports_pace_fields";
ALTER TABLE "user_sports" DROP COLUMN "pace_bracket";
ALTER TABLE "user_sports" ADD CONSTRAINT "user_sports_pace_fields" CHECK (
  ("pace_value" IS NULL AND "pace_unit" IS NULL) OR
  ("pace_value" IS NOT NULL AND "pace_value" > 0 AND "pace_unit" IS NOT NULL)
);
CREATE INDEX "user_sports_sport_pace_value_idx" ON "user_sports"("sport", "pace_value");
