#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
project="$repo_root/LauverNative/Lauver.xcodeproj"
selector="$repo_root/scripts/select-ios-simulator.rb"

if ! xcodebuild -version >/dev/null 2>&1; then
  echo "Full Xcode is required. Install Xcode, then run:" >&2
  echo "sudo xcode-select -s /Applications/Xcode.app/Contents/Developer" >&2
  exit 2
fi

if [ -z "${SIMULATOR_UDID:-}" ]; then
  SIMULATOR_UDID=$(xcrun simctl list devices available -j | ruby "$selector")
fi

ios_test_timeout_seconds=${IOS_TEST_TIMEOUT_SECONDS:-900}
if ! [[ "$ios_test_timeout_seconds" =~ ^[1-9][0-9]*$ ]]; then
  echo "IOS_TEST_TIMEOUT_SECONDS must be a positive integer." >&2
  exit 2
fi

echo "Testing Lauver-Staging on iOS Simulator $SIMULATOR_UDID"

xcodebuild test \
  -project "$project" \
  -scheme Lauver-Staging \
  -destination "platform=iOS Simulator,id=$SIMULATOR_UDID" \
  -destination-timeout 60 \
  -test-timeouts-enabled YES \
  -default-test-execution-time-allowance 180 \
  -maximum-test-execution-time-allowance 300 &
test_pid=$!

watchdog_pid=''
cleanup_watchdog() {
  if [ -n "$watchdog_pid" ]; then
    kill "$watchdog_pid" >/dev/null 2>&1 || true
    wait "$watchdog_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup_watchdog EXIT

(
  sleep "$ios_test_timeout_seconds"
  if kill -0 "$test_pid" >/dev/null 2>&1; then
    echo "iOS tests exceeded ${ios_test_timeout_seconds}s; terminating xcodebuild." >&2
    kill -TERM "$test_pid" >/dev/null 2>&1 || true
  fi
) &
watchdog_pid=$!

wait "$test_pid"
