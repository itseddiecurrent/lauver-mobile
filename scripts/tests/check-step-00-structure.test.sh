#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

required_paths=(
  "$repo_root/README.md"
  "$repo_root/artifacts/acceptance/step-00.md"
  "$repo_root/backend/.env.example"
  "$repo_root/backend/package-lock.json"
  "$repo_root/backend/src/app.ts"
  "$repo_root/LauverNative/Config/Local.xcconfig.example"
  "$repo_root/LauverNative/Config/Shared.xcconfig"
  "$repo_root/LauverNative/Config/Staging.xcconfig"
  "$repo_root/LauverNative/Config/Production.xcconfig"
  "$repo_root/LauverNative/Lauver/Resources/Info.plist"
  "$repo_root/LauverNative/Lauver.xcodeproj/project.pbxproj"
  "$repo_root/LauverNative/Lauver.xcodeproj/xcshareddata/xcschemes/Lauver-Staging.xcscheme"
  "$repo_root/LauverNative/Lauver.xcodeproj/xcshareddata/xcschemes/Lauver-Production.xcscheme"
  "$repo_root/openapi/mvp.yaml"
)

for required_path in "${required_paths[@]}"; do
  if [ ! -f "$required_path" ]; then
    echo "Step 00 structure check failed: missing ${required_path#"$repo_root"/}" >&2
    exit 1
  fi
done

for executable_script in \
  "$repo_root/scripts/check-mvp-scope.sh" \
  "$repo_root/scripts/check-secrets.sh" \
  "$repo_root/scripts/select-ios-simulator.rb" \
  "$repo_root/scripts/test-ios-config.sh" \
  "$repo_root/scripts/test-ios.sh" \
  "$repo_root/scripts/test-step-00.sh" \
  "$repo_root/scripts/tests/select-ios-simulator.test.sh"; do
  if [ ! -x "$executable_script" ]; then
    echo "Step 00 structure check failed: ${executable_script#"$repo_root"/} is not executable" >&2
    exit 1
  fi
done

if ! git -C "$repo_root" check-ignore --quiet backend/.env; then
  echo "Step 00 structure check failed: backend/.env must be ignored" >&2
  exit 1
fi

if ! git -C "$repo_root" check-ignore --quiet backend/.env.production; then
  echo "Step 00 structure check failed: environment-specific secret files must be ignored" >&2
  exit 1
fi

if git -C "$repo_root" check-ignore --quiet backend/.env.example; then
  echo "Step 00 structure check failed: backend/.env.example must remain trackable" >&2
  exit 1
fi

if ! git -C "$repo_root" check-ignore --quiet LauverNative/Config/Local.xcconfig; then
  echo "Step 00 structure check failed: Local.xcconfig must be ignored" >&2
  exit 1
fi

for tracked_xcode_path in \
  LauverNative/Lauver.xcodeproj/project.pbxproj \
  LauverNative/Lauver.xcodeproj/xcshareddata/xcschemes/Lauver-Staging.xcscheme \
  LauverNative/Lauver.xcodeproj/xcshareddata/xcschemes/Lauver-Production.xcscheme; do
  if git -C "$repo_root" check-ignore --quiet "$tracked_xcode_path"; then
    echo "Step 00 structure check failed: $tracked_xcode_path must remain trackable" >&2
    exit 1
  fi
done

rg --quiet 'buildConfiguration="Staging"' \
  "$repo_root/LauverNative/Lauver.xcodeproj/xcshareddata/xcschemes/Lauver-Staging.xcscheme"
rg --quiet 'buildConfiguration="Production"' \
  "$repo_root/LauverNative/Lauver.xcodeproj/xcshareddata/xcschemes/Lauver-Production.xcscheme"
rg --quiet 'required: \[code, message, requestId\]' "$repo_root/openapi/mvp.yaml"
rg --quiet 'requestId: string' "$repo_root/backend/src/app.ts"

echo "Step 00 repository structure tests passed."
