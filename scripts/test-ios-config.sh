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
  local app_plist="$derived_data/Build/Products/${configuration}-iphonesimulator/Lauver.app/Info.plist"

  xcodebuild build \
    -project "$project" \
    -scheme "$scheme" \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$derived_data" \
    CODE_SIGNING_ALLOWED=NO \
    ONLY_ACTIVE_ARCH=YES \
    >/dev/null

  if [ ! -f "$app_plist" ]; then
    echo "Missing built Info.plist for $scheme." >&2
    exit 1
  fi

  local actual_environment
  local actual_url
  local actual_bundle_id
  actual_environment=$(plutil -extract APP_ENVIRONMENT raw "$app_plist")
  actual_url=$(plutil -extract API_BASE_URL raw "$app_plist")
  actual_bundle_id=$(plutil -extract CFBundleIdentifier raw "$app_plist")

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
  Lauver-Staging Staging staging https://api-staging.lauver.ai ai.lauver.app.staging
assert_app_configuration \
  Lauver-Production Production production https://api.lauver.ai ai.lauver.app

echo "iOS built configuration tests passed."
