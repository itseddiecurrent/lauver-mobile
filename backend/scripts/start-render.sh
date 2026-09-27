#!/usr/bin/env bash
set -euo pipefail

# Supabase native is the only production datastore. Never silently fall back
# to a Render PostgreSQL binding: doing so would split profile/photo state.
if [[ -z "${SUPABASE_DATABASE_URL:-}" ]]; then
  echo 'SUPABASE_DATABASE_URL is required; refusing to start without Supabase.' >&2
  exit 1
fi

export DATABASE_URL="$(node --input-type=module -e '
  const url = new URL(process.env.SUPABASE_DATABASE_URL);
  if (!url.searchParams.has("sslmode")) url.searchParams.set("sslmode", "require");
  url.searchParams.set("options", "-c search_path=native,public");
  process.stdout.write(url.toString());
')"

npm run db:migrate:deploy
exec npm start
