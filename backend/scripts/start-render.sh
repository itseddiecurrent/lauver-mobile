#!/usr/bin/env bash
set -euo pipefail

# Keep the Render PostgreSQL binding as a rollback fallback until the Supabase
# cutover has been verified. Once SUPABASE_DATABASE_URL is configured in Render,
# it becomes the sole Prisma database and is isolated in the native schema.
if [[ -n "${SUPABASE_DATABASE_URL:-}" ]]; then
  export DATABASE_URL="$(node --input-type=module -e '
    const url = new URL(process.env.SUPABASE_DATABASE_URL);
    if (!url.searchParams.has("sslmode")) url.searchParams.set("sslmode", "require");
    url.searchParams.set("options", "-c search_path=native,public");
    process.stdout.write(url.toString());
  ')"
fi

npm run db:migrate:deploy
exec npm start
