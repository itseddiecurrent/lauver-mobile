# Step 05 Acceptance Record

> Status: in progress — implementation and local automated verification complete; CI/staging/manual acceptance pending
>
> Last updated: 2026-09-10 (Asia/Shanghai)

## Implemented

- PostgreSQL `profiles`, `user_sports`, `training_times`, pending photo upload, and durable photo cleanup tables.
- Authenticated own/public Profile APIs with allowlist validation and token-derived ownership.
- Server-derived pace units and static brackets for all supported sports.
- Profile completeness based on display name, city, at least one sport, and at least one training time.
- Public Profile responses that omit city-center latitude/longitude and storage object keys.
- S3-compatible signed PUT flow with full image decode, type/size/dimension validation, and server-side JPEG re-encoding that strips EXIF/GPS metadata.
- Replacement/deletion cleanup jobs for old object keys.
- Native SwiftUI own/edit/other Profile views, `PhotosPicker` crop/compression, and user-initiated MapKit city search.

## Acceptance still required

- Run the new migration and PostgreSQL integration suite in CI.
- Configure a staging S3-compatible bucket/CDN and server-only Render environment values.
- Deploy the Step 05 API migration to Render and verify `/readyz`.
- On a real iPhone, edit and save a profile, upload/replace/delete a photo, force-quit/relaunch, and verify all fields persist.
- Verify a second test account's public Profile response/UI shows the city but never the city-center coordinates.

No storage credential, signed upload URL, user identifier, or test-account data should be recorded here.

## Local automated evidence

| Check | Result |
|---|---|
| Step 05 structure guard | Pass |
| MVP scope and working-tree secret guards | Pass |
| Backend lint and typecheck | Pass |
| Backend unit and boundary tests | Pass — 78/78 |
| Backend production build | Pass |
| Backend production dependency audit | Pass — 0 vulnerabilities |
| OpenAPI 3.1 contract validation | Pass |
| Staging and production built iOS configuration | Pass |
| Native XCTest | Pass — 48/48 |
| Native XCUITest | Pass — 10/10 |

The local PostgreSQL integration command cannot run because this workstation has
no `TEST_DATABASE_URL` and no Docker/PostgreSQL executable. The migration and
real persistence assertions are included in the integration suite for CI.
