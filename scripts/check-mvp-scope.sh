#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

if [ "$#" -gt 0 ]; then
  scan_roots=("$@")
else
  scan_roots=(
    "$repo_root/LauverNative/Lauver"
    "$repo_root/backend/src"
    "$repo_root/backend/package.json"
  )
fi

existing_roots=()
for scan_root in "${scan_roots[@]}"; do
  if [ -e "$scan_root" ]; then
    existing_roots+=("$scan_root")
  fi
done

if [ "${#existing_roots[@]}" -eq 0 ]; then
  echo "MVP scope check failed: no product source paths were found." >&2
  exit 1
fi

forbidden_pattern='OpenAI|Anthropic|GoogleGenerativeAI|GeminiAPI|LangChain|CoreML|Garmin|StoreKit|InAppPurchase|Tinder|AI[ _-]?(Matching|Coach|Assistant)|Premium[ _-]?(Plan|Subscription|Feature)'

if command -v rg >/dev/null 2>&1; then
  if rg --line-number --ignore-case \
    --glob '*.{swift,ts,tsx,js,jsx,json,plist,strings}' \
    "$forbidden_pattern" "${existing_roots[@]}"; then
    echo "MVP scope check failed: prohibited product code or user-facing copy found." >&2
    exit 1
  fi
else
  if grep -REni \
    --include='*.swift' --include='*.ts' --include='*.tsx' --include='*.js' \
    --include='*.jsx' --include='*.json' --include='*.plist' --include='*.strings' \
    "$forbidden_pattern" "${existing_roots[@]}"; then
    echo "MVP scope check failed: prohibited product code or user-facing copy found." >&2
    exit 1
  fi
fi

echo "MVP scope check passed."
