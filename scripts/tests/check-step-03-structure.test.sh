#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

required_paths=(
  "$repo_root/artifacts/acceptance/step-03.md"
  "$repo_root/backend/prisma/migrations/20260902000000_step_03_email_auth/migration.sql"
  "$repo_root/backend/src/auth-repository.ts"
  "$repo_root/backend/src/auth-routes.ts"
  "$repo_root/backend/src/auth.ts"
  "$repo_root/backend/src/password-reset-delivery.ts"
  "$repo_root/backend/src/rate-limiter.ts"
  "$repo_root/backend/tests/auth-routes.test.ts"
  "$repo_root/backend/tests/auth.test.ts"
  "$repo_root/backend/tests/password-reset-delivery.test.ts"
  "$repo_root/LauverNative/Lauver/Core/Authentication/AuthService.swift"
  "$repo_root/LauverNative/Lauver/Core/Authentication/AuthSessionStore.swift"
  "$repo_root/LauverNative/LauverTests/AuthServiceTests.swift"
  "$repo_root/LauverNative/LauverTests/AuthSessionStoreTests.swift"
)

for required_path in "${required_paths[@]}"; do
  if [ ! -f "$required_path" ]; then
    echo "Step 03 structure check failed: missing ${required_path#"$repo_root/"}" >&2
    exit 1
  fi
done

for executable_script in \
  "$repo_root/scripts/test-step-03.sh" \
  "$repo_root/scripts/tests/check-step-03-structure.test.sh"; do
  if [ ! -x "$executable_script" ]; then
    echo "Step 03 structure check failed: ${executable_script#"$repo_root/"} is not executable" >&2
    exit 1
  fi
done

rg --quiet 'argon2\.argon2id' "$repo_root/backend/src/auth.ts"
rg --quiet 'refreshTokenHash' "$repo_root/backend/prisma/schema.prisma"
rg --quiet "'/v1/auth/password/forgot'" "$repo_root/backend/src/auth-routes.ts"
rg --quiet "'/v1/auth/password/reset'" "$repo_root/backend/src/auth-routes.ts"
rg --quiet 'ResendPasswordResetDelivery' "$repo_root/backend/src/password-reset-delivery.ts"
rg --quiet 'auth\.access-token' "$repo_root/LauverNative/Lauver/Core/Authentication/AuthSessionStore.swift"
rg --quiet 'auth\.refresh-token' "$repo_root/LauverNative/Lauver/Core/Authentication/AuthSessionStore.swift"

if rg --quiet 'UserDefaults' "$repo_root/LauverNative/Lauver/Core/Authentication" --glob '*.swift'; then
  echo "Step 03 structure check failed: auth tokens must not use UserDefaults" >&2
  exit 1
fi

echo "Step 03 repository structure tests passed."
