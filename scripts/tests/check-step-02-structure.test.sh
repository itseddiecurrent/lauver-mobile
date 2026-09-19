#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

required_paths=(
  "$repo_root/artifacts/acceptance/step-02.md"
  "$repo_root/LauverNative/Lauver/App/AppContainer.swift"
  "$repo_root/LauverNative/Lauver/Core/Networking/APIClient.swift"
  "$repo_root/LauverNative/Lauver/Core/Security/KeychainStore.swift"
  "$repo_root/LauverNative/Lauver/Core/Storage/UIStateStore.swift"
  "$repo_root/LauverNative/Lauver/DesignSystem/DesignSystem.swift"
  "$repo_root/LauverNative/LauverTests/APIClientTests.swift"
  "$repo_root/LauverNative/LauverTests/KeychainStoreTests.swift"
  "$repo_root/LauverNative/LauverTests/UIStateStoreTests.swift"
  "$repo_root/LauverNative/LauverTests/DesignSystemTests.swift"
  "$repo_root/LauverNative/LauverUITests/LauverUITests.swift"
)

for required_path in "${required_paths[@]}"; do
  if [ ! -f "$required_path" ]; then
    echo "Step 02 structure check failed: missing ${required_path#"$repo_root/"}" >&2
    exit 1
  fi
done

for executable_script in \
  "$repo_root/scripts/test-step-02.sh" \
  "$repo_root/scripts/tests/check-step-02-structure.test.sh"; do
  if [ ! -x "$executable_script" ]; then
    echo "Step 02 structure check failed: ${executable_script#"$repo_root/"} is not executable" >&2
    exit 1
  fi
done

rg --quiet 'API_BASE_URL = https:/\$\(\)/lauver-api-staging\.onrender\.com' \
  "$repo_root/LauverNative/Config/Staging.xcconfig"
rg --quiet 'session\.data\(for: urlRequest\)' \
  "$repo_root/LauverNative/Lauver/Core/Networking/APIClient.swift"
rg --quiet 'SecItem(Add|Update|CopyMatching|Delete)' \
  "$repo_root/LauverNative/Lauver/Core/Security/KeychainStore.swift"
rg --quiet 'case discover' "$repo_root/LauverNative/Lauver/Core/Storage/UIStateStore.swift"
rg --quiet 'case events' "$repo_root/LauverNative/Lauver/Core/Storage/UIStateStore.swift"
rg --quiet 'case messages' "$repo_root/LauverNative/Lauver/Core/Storage/UIStateStore.swift"
rg --quiet 'case profile' "$repo_root/LauverNative/Lauver/Core/Storage/UIStateStore.swift"

user_defaults_files=$(rg --files-with-matches 'UserDefaults' \
  "$repo_root/LauverNative/Lauver" --glob '*.swift' || true)
expected_user_defaults_file="$repo_root/LauverNative/Lauver/Core/Storage/UIStateStore.swift"
if [ "$user_defaults_files" != "$expected_user_defaults_file" ]; then
  echo "Step 02 structure check failed: UserDefaults must only be used by UIStateStore.swift" >&2
  exit 1
fi

if rg --quiet 'case swipe' "$repo_root/LauverNative/Lauver" --glob '*.swift'; then
  echo "Step 02 structure check failed: Swipe tab is outside MVP scope" >&2
  exit 1
fi

rg --quiet 'case match' "$repo_root/LauverNative/Lauver/Core/Storage/UIStateStore.swift"
rg --quiet 'match-review-settings' "$repo_root/LauverNative/Lauver/App/ContentView.swift"
rg --quiet 'screen-match' "$repo_root/LauverNative/LauverUITests/LauverUITests.swift"

if rg --quiet 'print\(|NSLog\(' \
  "$repo_root/LauverNative/Lauver/Core/Networking/APIClient.swift" \
  "$repo_root/LauverNative/Lauver/Core/Security/KeychainStore.swift"; then
  echo "Step 02 structure check failed: API or Keychain data must not be printed" >&2
  exit 1
fi

for expected_case in 'statusCode: 200' 'statusCode: 401' 'statusCode: 422' 'statusCode: 500' \
  '\.timedOut' '\.notConnectedToInternet'; do
  rg --quiet "$expected_case" "$repo_root/LauverNative/LauverTests/APIClientTests.swift"
done

echo "Step 02 repository structure tests passed."
