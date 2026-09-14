#!/usr/bin/env bash
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
for relative_path in \
  backend/src/strava-provider.ts \
  backend/src/strava-repository.ts \
  backend/src/strava.ts \
  backend/scripts/verify-step-08-staging.ts \
  backend/prisma/migrations/20260914000000_strava_readonly/migration.sql \
  backend/tests/strava-provider.test.ts \
  backend/tests/strava-routes.test.ts \
  backend/tests/integration/strava.integration.test.ts \
  backend/tests/integration/step-08-acceptance.integration.test.ts \
  LauverNative/Lauver/App/StravaView.swift \
  LauverNative/LauverTests/StravaTests.swift \
  artifacts/acceptance/step-08.md; do
  test -f "$repo_root/$relative_path" || { echo "Missing $relative_path" >&2; exit 1; }
done
rg --quiet 'StravaView.swift in Sources' "$repo_root/LauverNative/Lauver.xcodeproj/project.pbxproj"
rg --quiet 'StravaTests.swift in Sources' "$repo_root/LauverNative/Lauver.xcodeproj/project.pbxproj"
rg --quiet 'oauth/revoke' "$repo_root/backend/src/strava-provider.ts"
echo "Step 08 repository structure tests passed."
