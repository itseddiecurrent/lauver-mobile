#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
checker="$repo_root/scripts/check-secrets.sh"
fixture_dir=$(mktemp -d /tmp/lauver-secret-test.XXXXXX)
trap 'rm -rf "$fixture_dir"' EXIT

printf '%s\n' 'const publicValue = "safe";' > "$fixture_dir/clean.ts"
"$checker" "$fixture_dir" >/dev/null

printf '%s\n' 'STRAVA_CLIENT_SECRET=definitelynotarealsecretvalue' > "$fixture_dir/leaked.env.production"
if "$checker" "$fixture_dir" >/dev/null 2>&1; then
  echo "Expected secret checker to reject a populated secret." >&2
  exit 1
fi
rm "$fixture_dir/leaked.env.production"

printf '%s\n' '-----BEGIN PRIVATE KEY-----' > "$fixture_dir/leaked.pem.txt"
if "$checker" "$fixture_dir" >/dev/null 2>&1; then
  echo "Expected secret checker to reject a private key." >&2
  exit 1
fi
rm "$fixture_dir/leaked.pem.txt"

"$checker" "$fixture_dir" >/dev/null

echo "Secret checker tests passed."
