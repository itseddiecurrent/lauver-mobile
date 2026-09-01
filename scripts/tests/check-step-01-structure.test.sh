#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

required_paths=(
  "$repo_root/artifacts/acceptance/step-01.md"
  "$repo_root/backend/Dockerfile"
  "$repo_root/backend/compose.yaml"
  "$repo_root/backend/docker/postgres/init/001-create-test-db.sql"
  "$repo_root/backend/prisma.config.ts"
  "$repo_root/backend/prisma/schema.prisma"
  "$repo_root/backend/prisma/migrations/migration_lock.toml"
  "$repo_root/backend/prisma/migrations/20260901000000_step_01_foundation/migration.sql"
  "$repo_root/backend/scripts/test-integration.ts"
  "$repo_root/backend/src/database.ts"
  "$repo_root/backend/src/logger.ts"
  "$repo_root/backend/src/server-lifecycle.ts"
  "$repo_root/backend/tests/integration/postgres.integration.test.ts"
  "$repo_root/backend/vitest.integration.config.ts"
  "$repo_root/render.yaml"
)

for required_path in "${required_paths[@]}"; do
  if [ ! -f "$required_path" ]; then
    echo "Step 01 structure check failed: missing ${required_path#"$repo_root/"}" >&2
    exit 1
  fi
done

for executable_script in \
  "$repo_root/backend/scripts/build-deploy.sh" \
  "$repo_root/scripts/test-step-01.sh" \
  "$repo_root/scripts/tests/check-step-01-structure.test.sh"; do
  if [ ! -x "$executable_script" ]; then
    echo "Step 01 structure check failed: ${executable_script#"$repo_root/"} is not executable" >&2
    exit 1
  fi
done

rg --quiet 'provider = "postgresql"' "$repo_root/backend/prisma/schema.prisma"
rg --quiet 'preDeployCommand: npm run db:migrate:deploy' "$repo_root/render.yaml"
rg --quiet 'autoDeployTrigger: checksPass' "$repo_root/render.yaml"
rg --quiet 'healthCheckPath: /healthz' "$repo_root/render.yaml"
rg --quiet 'USER node' "$repo_root/backend/Dockerfile"
rg --quiet 'TEST_DATABASE_URL=.*_test' "$repo_root/backend/.env.example"

echo "Step 01 repository structure tests passed."
