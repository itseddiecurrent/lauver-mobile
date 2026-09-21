#!/usr/bin/env bash
set -euo pipefail

# One-time cutover helper. It copies data only; schema is applied by
# `supabase db push` before this script is run. Both URLs are read from the
# environment so credentials never enter the repository or command history.
if [[ -z "${SOURCE_DATABASE_URL:-}" || -z "${SUPABASE_DATABASE_URL:-}" ]]; then
  echo "Set SOURCE_DATABASE_URL (Render) and SUPABASE_DATABASE_URL (Supabase)" >&2
  exit 2
fi

if [[ "$SOURCE_DATABASE_URL" != *render.com* && "$SOURCE_DATABASE_URL" != *render-postgres* ]]; then
  echo "SOURCE_DATABASE_URL must point at the Render PostgreSQL instance" >&2
  exit 2
fi

if [[ "$SUPABASE_DATABASE_URL" != *supabase.com* && "$SUPABASE_DATABASE_URL" != *supabase.co* ]]; then
  echo "SUPABASE_DATABASE_URL must point at Supabase PostgreSQL" >&2
  exit 2
fi

echo "Exporting Render public data without credentials or Prisma migration metadata..."
NATIVE_TABLES=(
  service_metadata users account_deletion_jobs admin_users admin_sessions
  admin_audit_logs events event_attendees strava_connections strava_oauth_states
  strava_activities reports safety_audit_events profiles swipes matches
  profile_photos user_sports training_times photo_cleanup_jobs
  profile_photo_uploads auth_identities apple_credentials firebase_credentials
  password_credentials sessions email_tokens blocks health_workouts
)
TABLE_ARGS=()
for table in "${NATIVE_TABLES[@]}"; do
  TABLE_ARGS+=(--table="public.$table")
done

pg_dump \
  --dbname="$SOURCE_DATABASE_URL" \
  --schema=public \
  --data-only \
  --column-inserts \
  --no-owner \
  --no-privileges \
  --disable-triggers \
  --exclude-table=public._prisma_migrations \
  "${TABLE_ARGS[@]}" \
| sed -E \
    -e 's/(INSERT INTO|SELECT pg_catalog\.setval\() public\./\1 native./g' \
    -e 's/(INSERT INTO|SELECT pg_catalog\.setval\() "public"\./\1 "native"./g' \
    -e "s/'public\\./'native./g" \
| psql "$SUPABASE_DATABASE_URL" -v ON_ERROR_STOP=1

echo "Data copy completed. Set SUPABASE_DATABASE_URL in Render and run the cutover checks."
