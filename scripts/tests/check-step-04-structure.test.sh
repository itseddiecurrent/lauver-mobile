#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

required_paths=(
  "$repo_root/artifacts/acceptance/step-04.md"
  "$repo_root/backend/prisma/migrations/20260906000000_step_04_sign_in_with_apple/migration.sql"
  "$repo_root/backend/src/apple-auth.ts"
  "$repo_root/backend/tests/apple-auth.test.ts"
  "$repo_root/LauverNative/Lauver/Core/Authentication/AppleSignIn.swift"
  "$repo_root/LauverNative/Lauver/Lauver.entitlements"
  "$repo_root/LauverNative/LauverTests/AppleSignInTests.swift"
)

for required_path in "${required_paths[@]}"; do
  if [ ! -f "$required_path" ]; then
    echo "Step 04 structure check failed: missing ${required_path#"$repo_root/"}" >&2
    exit 1
  fi
done

for executable_script in \
  "$repo_root/scripts/test-step-04.sh" \
  "$repo_root/scripts/tests/check-step-04-structure.test.sh"; do
  if [ ! -x "$executable_script" ]; then
    echo "Step 04 structure check failed: ${executable_script#"$repo_root/"} is not executable" >&2
    exit 1
  fi
done

rg --quiet 'createRemoteJWKSet' "$repo_root/backend/src/apple-auth.ts"
rg --quiet "algorithms: \['RS256'\]" "$repo_root/backend/src/apple-auth.ts"
rg --quiet 'payload\.nonce !== expectedNonce' "$repo_root/backend/src/apple-auth.ts"
rg --quiet "'/v1/auth/apple'" "$repo_root/backend/src/auth-routes.ts"
rg --quiet 'refreshTokenEncrypted' "$repo_root/backend/prisma/schema.prisma"
rg --quiet 'aes-256-gcm' "$repo_root/backend/src/apple-auth.ts"
rg --quiet 'SignInWithAppleButton' "$repo_root/LauverNative/Lauver/App/ContentView.swift"
rg --quiet 'requestedScopes = \[\.fullName, \.email\]' "$repo_root/LauverNative/Lauver/App/ContentView.swift"
rg --quiet 'credentialRevokedNotification' "$repo_root/LauverNative/Lauver/App/ContentView.swift"
rg --quiet 'credentialState\(forUserID:' "$repo_root/LauverNative/Lauver/Core/Authentication/AppleSignIn.swift"
rg --quiet 'com.apple.developer.applesignin' "$repo_root/LauverNative/Lauver/Lauver.entitlements"

if rg --files "$repo_root" --glob '*.p8' --glob '!node_modules/**' | rg --quiet '.'; then
  echo 'Step 04 structure check failed: Apple p8 files must not be committed.' >&2
  exit 1
fi

if rg --quiet 'APPLE_(PRIVATE_KEY|TOKEN_ENCRYPTION_KEY)' "$repo_root/LauverNative"; then
  echo 'Step 04 structure check failed: server-side Apple secrets must not appear in the iOS project.' >&2
  exit 1
fi

echo "Step 04 repository structure tests passed."
