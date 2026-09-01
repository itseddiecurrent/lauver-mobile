#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

"$repo_root/scripts/tests/check-step-01-structure.test.sh"

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
