#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
scan_root=${1:-$repo_root}

if ! command -v rg >/dev/null 2>&1; then
  echo "Secret scan requires ripgrep (rg)." >&2
  exit 2
fi

common_globs=(
  --glob '!node_modules/**'
  --glob '!.git/**'
  --glob '!.expo/**'
  --glob '!dist/**'
  --glob '!build/**'
  --glob '!*.lock'
  --glob '!.env'
  --glob '!.env.*'
  --glob '!*.example'
  --glob '!scripts/check-secrets.sh'
  --glob '!scripts/tests/**'
)

failed=0

scan_pattern() {
  local label=$1
  local pattern=$2
  local matches

  matches=$(rg --files-with-matches --hidden --ignore-case "${common_globs[@]}" -- "$pattern" "$scan_root" || true)
  if [ -n "$matches" ]; then
    echo "Secret scan found $label in:" >&2
    echo "$matches" >&2
    failed=1
  fi
}

scan_pattern "a private key block" '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'
scan_pattern "a high-confidence access token" '(AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|sk-(proj-)?[A-Za-z0-9_-]{20,})'
scan_pattern "a populated sensitive environment assignment" '(STRAVA_CLIENT_SECRET|STRAVA_TOKEN_ENCRYPTION_KEY|STREAM_API_SECRET|APPLE_PRIVATE_KEY|APPLE_TOKEN_ENCRYPTION_KEY|JWT_SECRET)[[:space:]]*=[[:space:]]*[A-Za-z0-9_+/.=-]{12,}'

if [ "$failed" -ne 0 ]; then
  echo "Secret scan failed. Only file names are shown; secret values are intentionally suppressed." >&2
  exit 1
fi

echo "Secret scan passed."
