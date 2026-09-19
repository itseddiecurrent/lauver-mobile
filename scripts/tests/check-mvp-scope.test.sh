#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
checker="$repo_root/scripts/check-mvp-scope.sh"
fixture_dir=$(mktemp -d /tmp/lauver-scope-test.XXXXXX)
trap 'rm -rf "$fixture_dir"' EXIT

printf '%s\n' 'struct DiscoverList {}' > "$fixture_dir/Clean.swift"
printf '%s\n' "let approvedMatchCopy = \"It's a Match\"; let approvedActions = [\"Swipe\", \"Like\", \"Pass\", \"Match\"]" > "$fixture_dir/ApprovedMatch.swift"
"$checker" "$fixture_dir" >/dev/null

assert_rejected() {
  local fixture=$1
  local expected_description=$2

  printf '%s\n' "$fixture" > "$fixture_dir/Forbidden.swift"
  if "$checker" "$fixture_dir" >/dev/null 2>&1; then
    echo "Expected scope checker to reject $expected_description." >&2
    exit 1
  fi
}

assert_rejected 'import StoreKit' 'an in-app-purchase dependency'
assert_rejected 'import GarminConnectSDK' 'a Garmin SDK dependency'
assert_rejected 'import GoogleGenerativeAI' 'an AI SDK dependency'
assert_rejected 'let copy = "AI Matching"' 'prohibited user-facing copy'
assert_rejected 'let brand = "Tinder"' 'Tinder brand usage'

rm "$fixture_dir/Forbidden.swift"
"$checker" "$fixture_dir" >/dev/null

echo "MVP scope checker tests passed."
