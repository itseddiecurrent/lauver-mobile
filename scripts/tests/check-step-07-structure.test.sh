#!/usr/bin/env bash
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
for relative_path in \
  backend/src/block-policy.ts \
  backend/src/safety.ts \
  backend/prisma/migrations/20260913020000_profile_safety/migration.sql \
  backend/scripts/verify-step-07-staging.ts \
  backend/tests/safety.test.ts \
  backend/tests/integration/safety.integration.test.ts \
  backend/tests/integration/step-07-acceptance.integration.test.ts \
  LauverNative/Lauver/App/SafetyView.swift \
  artifacts/acceptance/step-07.md; do
  test -f "$repo_root/$relative_path" || { echo "Missing $relative_path" >&2; exit 1; }
done
rg --quiet 'reports_preserve_evidence' "$repo_root/backend/prisma/migrations/20260913020000_profile_safety/migration.sql"
rg --quiet 'visibleUserWhere' "$repo_root/backend/src/profile-repository.ts"
rg --quiet 'noBlockSQL' "$repo_root/backend/src/discover.ts"
rg --quiet 'SafetyView.swift in Sources' "$repo_root/LauverNative/Lauver.xcodeproj/project.pbxproj"
echo "Step 07 repository structure tests passed."
