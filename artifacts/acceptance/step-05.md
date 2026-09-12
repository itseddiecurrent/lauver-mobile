# Step 05 Acceptance Record

> Status: in progress — baseline CI/staging, real-iPhone save/upload, and cancellation-error fix confirmed; recovery deployment and remaining acceptance pending
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
- Time-based pace input/display uses `mm:ss`, converted to decimal minutes at
  the API boundary; cycling continues to use numeric `km/h`. Missing city
  region codes are explicitly encoded as `null` per the API contract.

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

- On a real iPhone, verify photo replacement/deletion and force-quit/relaunch persistence. One profile save and photo upload have now passed, with all photo stages returning successful HTTP statuses.
- Verify a second test account's public Profile response/UI shows the city but never the city-center coordinates.

The first real-device profile-save attempt on 2026-09-12 reported a transport
failure. An equivalent Apple URLSession PATCH and subsequent GET from this Mac
both returned HTTP 200. Real-device acceptance remains pending; network-error
codes are now displayed to diagnose a repeat failure without exposing tokens.

No storage credential, signed upload URL, user identifier, or test-account data should be recorded here.

## Profile photo connection-loss recovery (2026-09-12)

- `-1005` is URLSession's `networkConnectionLost`: a connection interruption
  during a request, per [Apple QA1941](https://developer.apple.com/library/archive/qa/qa1941/_index.html).
  The exact cause of the reported real-device interruption has not been traced.
  A diagnostic unauthenticated upload-URL POST also reported `-1005` on the
  iPhone; equivalent unauthenticated Mac probes over HTTP/1.1 and HTTP/2
  returned the expected HTTP 401.
- The existing working-tree signed PUT change uses `URLSession.upload` and
  retries the same URL and bytes. Uploads now also apply the server's required
  headers and the exact compressed byte count as `Content-Length`.
- Upload URL creation and photo completion explicitly opt into one connection
  retry for `networkConnectionLost` or timeout. Other POST requests retain
  their existing behavior; cancellation and HTTP failures are not retried.
  An unused upload-URL reservation is removed by the existing expiry cleanup.
- Completion preserves the upload UUID in the final JPEG object key. A retry
  after the successful response was lost returns the currently committed photo,
  even after temporary data was removed. Foreign keys and uploads whose photos
  have since been deleted or replaced remain invalid.
- Local regressions cover a connection loss at each of the three upload stages,
  required upload headers, retry limits, cancellation/HTTP boundaries, failure
  before completion, repeated completion after cleanup, and overlapping completion.
- Local validation passed: backend 80/80 tests; native XCTest and XCUITest
  71/71 tests with zero failures or skips; backend lint/typecheck/build;
  OpenAPI YAML parsing; Step 05 structure, MVP scope, and secret guards.
- The user confirmed that saving without a photo succeeds and adding a photo
  triggers `-1005`, narrowing the failure to the photo-specific flow.
- A diagnostic staging build was compiled and installed on the connected iPhone.
  Staging now enables `DEBUG`, so the existing opt-in diagnostics actually compile.
  Logs distinguish upload-URL creation, signed PUT, and completion, including
  attempt counts and underlying error codes without printing signed URLs or tokens.
- The subsequent authenticated real-iPhone upload succeeded on the installed
  staging build: profile PATCH 200, upload-URL POST 201, signed PUT 200,
  completion POST 200. This verifies one real-device upload; it does not prove
  the network interruption's underlying cause or exercise a real retry.
- The backend recovery change has not been deployed to Render. Photo
  replacement/deletion and force-quit/relaunch persistence acceptance remain pending.
  Deploy the backend before distributing the rebuilt App: completion retries
  rely on the backend change. No database migration or storage setting changes
  are required. Real-device upload/replace/delete acceptance remains pending.

## Profile cancellation error display (2026-09-12)

- After confirming successful photo upload, the user reported that the Profile
  still displayed a connection error with code `-999` below the saved avatar.
- Device logs show successful photo completion followed by cancelled Profile
  GET tasks with `swiftCancelled=true` and `URLError.cancelled`. The model
  previously captured these cancellations as user-visible network errors.
- Profile loading now ignores already-cancelled tasks, checks cancellation before
  applying responses, and treats `CancellationError`, `URLError.cancelled`, and
  the mapped `APIError.transport(.cancelled)` as silent cancellation. Genuine
  network and API errors still produce the existing error state.
- The own Profile task is attached to a stable `ZStack` container, avoiding
  task identity changes when the conditional loading/content view changes.
- Regressions cover cancellation after an uploaded photo, all cancellation
  representations, already-cancelled loads, cancellation of a stale response
  after a newer save, and genuine network failures. The Profile editor UI
  regression now checks that a successful save leaves no error state.
- Validation passed: all 66 native unit tests plus the Profile editor UI test
  (67/67); after the final test refinements, all five cancellation regressions
  and the updated Profile editor UI test passed again (6/6). The iPhone build,
  MVP scope, Step 05 structure, secret guard, and whitespace checks passed.
- The cancellation-display fix was installed and launched on the connected
  iPhone, and the user confirmed that the error display is resolved. This
  client-side fix does not depend on deployment of the backend enhancement.
- PostgreSQL integration coverage now exercises overlapping completions,
  replay after a lost success response, durable removal of pending uploads,
  and rejection of replay after deletion. External CI verification is pending.

## Local automated evidence

| Check | Result |
|---|---|
| Step 05 structure guard | Pass |
| MVP scope and working-tree secret guards | Pass |
| Backend lint and typecheck | Pass |
| Backend unit and boundary tests | Pass — 80/80 |
| Backend production build | Pass |
| Backend production dependency audit | Pass — 0 vulnerabilities |
| OpenAPI 3.1 contract validation | Pass |
| Staging and production built iOS configuration | Pass |
| Native XCTest and XCUITest | Pass — 71/71 |

The local PostgreSQL integration command cannot run because this workstation has
no `TEST_DATABASE_URL` and no Docker/PostgreSQL executable. The migration and
real persistence assertions are included in the integration suite for CI.
