#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${SUPABASE_DATABASE_URL:-}" ]]; then
  echo "Set SUPABASE_DATABASE_URL to the Supabase pooler/direct connection string" >&2
  exit 2
fi

if [[ "$SUPABASE_DATABASE_URL" != *supabase.com* && "$SUPABASE_DATABASE_URL" != *supabase.co* ]]; then
  echo "SUPABASE_DATABASE_URL must point at Supabase PostgreSQL" >&2
  exit 2
fi

psql "$SUPABASE_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SET search_path = native, public;
SELECT 'native schema' AS check, to_regnamespace('native') IS NOT NULL AS passed;
SELECT 'users table' AS check, to_regclass('native.users') IS NOT NULL AS passed;
SELECT 'profiles table' AS check, to_regclass('native.profiles') IS NOT NULL AS passed;
SELECT 'matches table' AS check, to_regclass('native.matches') IS NOT NULL AS passed;
SELECT 'events table' AS check, to_regclass('native.events') IS NOT NULL AS passed;
SELECT 'native prisma migrations' AS check, to_regclass('native._prisma_migrations') IS NOT NULL AS passed;
SQL

echo "Supabase native schema checks passed."
