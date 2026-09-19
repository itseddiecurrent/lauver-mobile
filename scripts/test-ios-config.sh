#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
project="$repo_root/LauverNative/Lauver.xcodeproj"
derived_data=$(mktemp -d /tmp/lauver-ios-config.XXXXXX)
trap 'rm -rf "$derived_data"' EXIT

assert_app_configuration() {
  local scheme=$1
  local configuration=$2
  local expected_environment=$3
  local expected_url=$4
  local expected_bundle_id=$5
  local settings_log="$derived_data/$scheme-settings.log"

  # This check validates the values that Xcode will inject into Info.plist.
  # Building the whole app here needlessly compiles StreamChat from source on
  # every hosted runner and can make this lightweight scope check appear stuck.
  if ! xcodebuild -showBuildSettings \
    -project "$project" \
    -scheme "$scheme" \
    -configuration "$configuration" \
    -destination 'generic/platform=iOS Simulator' \
    >"$settings_log" 2>&1; then
    cat "$settings_log" >&2
    return 1
  fi

  local actual_environment
  local actual_url
  local actual_bundle_id
  actual_environment=$(sed -n 's/^    APP_ENVIRONMENT = //p' "$settings_log" | tail -1)
  actual_url=$(sed -n 's/^    API_BASE_URL = //p' "$settings_log" | tail -1)
  actual_bundle_id=$(sed -n 's/^    PRODUCT_BUNDLE_IDENTIFIER = //p' "$settings_log" | tail -1)

  if [ "$actual_environment" != "$expected_environment" ] \
    || [ "$actual_url" != "$expected_url" ] \
    || [ "$actual_bundle_id" != "$expected_bundle_id" ]; then
    echo "Built configuration mismatch for $scheme." >&2
    echo "Expected: $expected_environment | $expected_url | $expected_bundle_id" >&2
    echo "Actual:   $actual_environment | $actual_url | $actual_bundle_id" >&2
    exit 1
  fi
}

assert_app_configuration \
  Lauver-Staging Staging staging https://lauver-api-staging.onrender.com ai.lauver.app.staging
assert_app_configuration \
  Lauver-Production Production production https://api.lauver.ai ai.lauver.app

echo "iOS built configuration tests passed."
