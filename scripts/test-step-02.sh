#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

"$repo_root/scripts/tests/check-step-02-structure.test.sh"
"$repo_root/scripts/check-mvp-scope.sh"
"$repo_root/scripts/check-secrets.sh"
"$repo_root/scripts/test-ios-config.sh"
"$repo_root/scripts/test-ios.sh"
