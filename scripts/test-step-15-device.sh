#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
project="$repo_root/LauverNative/Lauver.xcodeproj"
device_id="${IPHONE17E_UDID:-00008150-00010C6E22C0C01C}"
log_path="${STEP15_DEVICE_LOG:-$repo_root/artifacts/acceptance/step-15-iphone17e-unit-current.log}"

# Step 15 is intentionally physical-device-only. Do not replace this with a
# simulator destination: HealthKit, Apple Sign In, entitlements and network
# acceptance are release checks for the connected iPhone.
if ! xcrun xctrace list devices 2>/dev/null | rg -F "$device_id" >/dev/null; then
  echo "Physical iPhone 17e $device_id is not connected or trusted." >&2
  exit 1
fi

mkdir -p "$(dirname "$log_path")"
set -o pipefail
xcodebuild \
  -project "$project" \
  -scheme Lauver-Staging \
  -configuration Staging \
  -destination "id=$device_id" \
  -only-testing:LauverTests \
  test 2>&1 | tee "$log_path"
