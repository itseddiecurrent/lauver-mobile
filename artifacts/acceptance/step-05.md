# Step 05 Acceptance Record

> Status: in progress — implementation, CI, migration, and staging object-storage acceptance complete; real-iPhone manual acceptance pending
>
> Last updated: 2026-09-12 (Asia/Shanghai)

## Implemented

- PostgreSQL `profiles`, `user_sports`, `training_times`, pending photo upload, and durable photo cleanup tables.
- Authenticated own/public Profile APIs with allowlist validation and token-derived ownership.
- Server-derived pace units and static brackets for all supported sports.
- Profile completeness based on display name, city, at least one sport, and at least one training time.
- Public Profile responses that omit city-center latitude/longitude and storage object keys.
- S3-compatible signed PUT flow with full image decode, type/size/dimension validation, and server-side JPEG re-encoding that strips EXIF/GPS metadata.
- Replacement/deletion cleanup jobs for old object keys.
- Native SwiftUI own/edit/other Profile views, `PhotosPicker` crop/compression, and user-initiated MapKit city search.

## External CI and Render staging evidence

- Commit `db2d615` was pushed to `main` on 2026-09-12.
- GitHub Actions run `34669355447` completed successfully. Its `backend` job
  deployed every migration into PostgreSQL 17 and passed the integration suite;
  the guardrail and native iOS jobs also passed.
- Render deployment `6405339797` completed successfully at 11:14 Asia/Shanghai.
  After the deployment, `GET /readyz` returned HTTP 200 with `database: ok`.
- The deployed `GET /v1/me` endpoint returned the expected authenticated-route
  HTTP 401 contract without a session, confirming that the Step 05 API is live.
- A private Cloudflare R2 bucket was configured with a dedicated, bucket-scoped
  read/write credential and the custom CDN domain `photos-staging.lauver.ai`.
  Public `r2.dev` access remains disabled. A Cloudflare WAF rule returned HTTP
  403 for the bucket root and `profile-photo-uploads/`, while an absent object
  under the allowed `profile-photos/` prefix returned the expected HTTP 404.
- Render deployment `6405896392` completed successfully after the server-only
  object-storage values were configured. A generated staging account then
  passed profile write/reread, public coordinate omission, signed PNG upload,
  server-side image validation and JPEG normalization, CDN retrieval, photo
  deletion, and profile-reference cleanup. Both storage prefixes contained zero
  test objects after cleanup.

## Acceptance still required

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
