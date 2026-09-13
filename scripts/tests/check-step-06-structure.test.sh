#!/usr/bin/env bash
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
for relative_path in \
  backend/src/discover.ts \
  backend/scripts/verify-step-06-staging.ts \
  backend/.env.staging.example \
  backend/tests/step-06-acceptance.test.ts \
  backend/tests/integration/step-06-acceptance.integration.test.ts \
  backend/tests/discover.test.ts \
  backend/tests/integration/discover.integration.test.ts \
  backend/prisma/migrations/20260913000000_discover_block_policy/migration.sql \
  backend/prisma/migrations/20260913010000_explicit_pace_ranges/migration.sql \
  backend/tests/integration/pace-migration.integration.test.ts \
  LauverNative/Lauver/App/DiscoverView.swift \
  LauverNative/LauverTests/DiscoverTests.swift \
  artifacts/acceptance/step-06.md; do
  test -f "$repo_root/$relative_path" || { echo "Missing $relative_path" >&2; exit 1; }
done
rg --quiet "'/v1/discover'" "$repo_root/backend/src/discover.ts"
rg --quiet 'ORDER BY distance ASC, updated_at DESC, id ASC' "$repo_root/backend/src/discover.ts"
rg --quiet 'refreshable' "$repo_root/LauverNative/Lauver/App/DiscoverView.swift"
rg --quiet 'DiscoverTests.swift in Sources' "$repo_root/LauverNative/Lauver.xcodeproj/project.pbxproj"
echo "Step 06 repository structure tests passed."
