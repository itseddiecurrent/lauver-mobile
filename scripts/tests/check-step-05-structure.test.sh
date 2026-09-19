#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

required_paths=(
  "$repo_root/artifacts/acceptance/step-05.md"
  "$repo_root/scripts/verify-step-05-staging.py"
  "$repo_root/backend/prisma/migrations/20260910000000_step_05_workout_profiles/migration.sql"
  "$repo_root/backend/src/profile.ts"
  "$repo_root/backend/src/profile-routes.ts"
  "$repo_root/backend/src/object-storage.ts"
  "$repo_root/backend/tests/profile.test.ts"
  "$repo_root/LauverNative/Lauver/Core/Profile/ProfileService.swift"
  "$repo_root/LauverNative/Lauver/App/ProfileView.swift"
  "$repo_root/LauverNative/LauverTests/ProfileServiceTests.swift"
)

for required_path in "${required_paths[@]}"; do
  if [ ! -f "$required_path" ]; then
    echo "Step 05 structure check failed: missing ${required_path#"$repo_root/"}" >&2
    exit 1
  fi
done

rg --quiet "'/v1/me'" "$repo_root/backend/src/profile-routes.ts"
rg --quiet "'/v1/me/preview'" "$repo_root/backend/src/profile-routes.ts"
rg --quiet "'/v1/users/:userId'" "$repo_root/backend/src/profile-routes.ts"
rg --quiet "'/v1/me/photo/upload-url'" "$repo_root/backend/src/profile-routes.ts"
rg --quiet 'cityLatitude' "$repo_root/backend/prisma/schema.prisma"
rg --quiet 'PhotosPicker' "$repo_root/LauverNative/Lauver/App/ProfileView.swift"
rg --quiet 'MKLocalSearchCompleter' "$repo_root/LauverNative/Lauver/Core/Profile/ProfileService.swift"

if rg --quiet 'OBJECT_STORAGE_(SECRET_ACCESS_KEY|ACCESS_KEY_ID)' "$repo_root/LauverNative"; then
  echo 'Step 05 structure check failed: object-storage credentials must not appear in iOS.' >&2
  exit 1
fi

echo "Step 05 repository structure tests passed."
