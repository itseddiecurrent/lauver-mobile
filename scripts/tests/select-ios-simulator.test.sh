#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
selector="$repo_root/scripts/select-ios-simulator.rb"

assert_selection() {
  local fixture=$1
  local expected_udid=$2
  local actual_udid

  actual_udid=$(printf '%s' "$fixture" | ruby "$selector")
  if [ "$actual_udid" != "$expected_udid" ]; then
    echo "Expected simulator $expected_udid, selected $actual_udid." >&2
    exit 1
  fi
}

assert_selection '{
  "devices": {
    "runtime-a": [
      {"name":"iPhone 16","udid":"shutdown-phone","state":"Shutdown","isAvailable":true},
      {"name":"iPad Pro","udid":"booted-tablet","state":"Booted","isAvailable":true}
    ],
    "runtime-b": [
      {"name":"iPhone 17 Pro","udid":"booted-phone","state":"Booted","isAvailable":true}
    ]
  }
}' 'booted-phone'

assert_selection '{
  "devices": {
    "runtime-a": [
      {"name":"iPhone unavailable","udid":"unavailable-phone","state":"Booted","isAvailable":false},
      {"name":"iPhone available","udid":"available-phone","state":"Shutdown","isAvailable":true}
    ]
  }
}' 'available-phone'

if printf '%s' '{"devices":{"runtime-a":[{"name":"iPad Pro","udid":"tablet","state":"Booted","isAvailable":true}]}}' \
  | ruby "$selector" >/dev/null 2>&1; then
  echo "Expected simulator selector to fail when no available iPhone exists." >&2
  exit 1
fi

echo "iOS simulator selector tests passed."
