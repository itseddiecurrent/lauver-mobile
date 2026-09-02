#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

"$repo_root/scripts/tests/check-step-03-structure.test.sh"
"$repo_root/scripts/check-mvp-scope.sh"
"$repo_root/scripts/check-secrets.sh"

(
  cd "$repo_root/backend"
  npm run db:generate
  npm run lint
  npm run typecheck
  npm test
  npm run test:integration
  npm run build
  npm audit --omit=dev
)

"$repo_root/scripts/test-ios-config.sh"
"$repo_root/scripts/test-ios.sh"
