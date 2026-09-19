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

skip_external_ui=()
if [ "${IOS_SKIP_EXTERNAL_UI:-false}" = "true" ]; then
  skip_external_ui=(
    -skip-testing:LauverUITests/LauverUITests/testLiveStreamChatConnectsOnDevice
    -skip-testing:LauverUITests/LauverUITests/testProfileReportAndBlockCanBeUnblockedFromSettings
    -skip-testing:LauverUITests/LauverUITests/testConnectedAppsShowsStravaSummariesAndConfirmsDisconnect
  )
  echo "Skipping staging-dependent external UI tests"
fi

only_testing=()
if [ "${IOS_STEP_00:-false}" = "true" ]; then
  only_testing=(
    -only-testing:LauverTests
    -only-testing:LauverUITests/LauverUITests/testAppLaunchesWithStagingConfigurationAndAuthEntry
  )
  echo "Running Step 00 native smoke tests only"
fi

test_args=(
  test
  -project "$project"
  -scheme Lauver-Staging
  -destination "platform=iOS Simulator,id=$SIMULATOR_UDID"
  -destination-timeout 60
  -parallel-testing-enabled NO
  -test-timeouts-enabled YES
  -default-test-execution-time-allowance 180
  -maximum-test-execution-time-allowance 300
  ONLY_ACTIVE_ARCH=YES
)

if [ "${#only_testing[@]}" -gt 0 ]; then
  test_args+=("${only_testing[@]}")
fi
if [ "${#skip_external_ui[@]}" -gt 0 ]; then
  test_args+=("${skip_external_ui[@]}")
fi

xcodebuild "${test_args[@]}" \
  &
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
