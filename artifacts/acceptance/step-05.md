# Step 05 Acceptance Record

> Status: complete — implementation, real-iPhone acceptance, final recovery CI, and all 33 deployed staging assertions passed
>
> Last updated: 2026-09-13 (Asia/Shanghai)

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

## Acceptance completion

- No Step 05 acceptance remains pending. Commit `10c8168` was deployed to Render staging and `python3 scripts/verify-step-05-staging.py` passed all 33 assertions, including completion replay and the full deployed photo lifecycle. Final deployment evidence is recorded below.

The first real-device profile-save attempt on 2026-09-12 reported a transport
failure. An equivalent Apple URLSession PATCH and subsequent GET from this Mac
both returned HTTP 200. Subsequent real-device acceptance passed as recorded below.

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
  Diagnostics distinguish upload-URL creation, signed PUT, and completion,
  including attempt counts and underlying error codes. The final implementation
  uses system Logger rather than printing from the API client; signed URLs,
  tokens, user identifiers, and API response bodies are excluded.
- The subsequent authenticated real-iPhone upload succeeded on the installed
  staging build: profile PATCH 200, upload-URL POST 201, signed PUT 200,
  completion POST 200. This verifies one real-device upload; it does not prove
  the network interruption's underlying cause or exercise a real retry.
- The user explicitly confirmed the real-iPhone sequence: replace the existing
  avatar, delete it, re-upload, force-quit/relaunch, and verify the avatar and all
  workout-profile fields persist. The cancellation-error display fix was also
  confirmed. No user identifiers, actual profile data, or screenshots are retained here.
- Completion retries require the backend recovery change. Its final CI and
  staging deployment are now verified below. No database migration or storage
  setting changes were required.

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
  and rejection of replay after deletion. Final external CI verification passed
  in run `34681468605`.

## Public Profile UI privacy regression

- A debug-only launch fixture displays the existing public Profile view without
  requiring a session or network. It deliberately includes city coordinates in
  its input, ensuring the UI never renders them even if an own-profile model
  is accidentally supplied.
- XCUITest confirms that the public Profile displays the city and sport while
  latitude/longitude are absent. This and the API client regressions passed
  locally (16/16); all Step 00–05 structural and secret guards passed.

## Final CI and staging verification (2026-09-13)

- GitHub Actions [run `34681468605`](https://github.com/itseddiecurrent/lauver-mobile/actions/runs/34681468605) for commit `10c8168cc3bd169d7f69a7328c01b1ef08f9bb51` completed successfully. The `guardrails`, `backend`, and `ios` jobs all passed, including PostgreSQL migrations and the concurrent/lost-response completion integration regression.
- Before the final deployment, GitHub's latest Render deployment record was `6406391643` for older commit `98967a1`; the initial live verification passed 11 assertions but failed `recovery-revision-deployed` because the photo filename did not preserve the pending upload UUID.
- The user deployed the latest commit. GitHub's deployment record `6418567072` confirms commit `10c8168cc3bd169d7f69a7328c01b1ef08f9bb51`, with successful Render status at 14:43:46 Asia/Shanghai on 2026-09-13. [Render deployment](https://dashboard.render.com/web/srv-dabaeeojo6nc739kpspg/deploys/dep-daj4bplg1s2s739cg71g).
- The post-deployment attempt passed the recovery filename and repeated-completion assertions, but Cloudflare returned HTTP 403 with `error code: 1010` for urllib's default CDN request. An equivalent image request with standard headers reached the CDN. The staging script now sends an explicit User-Agent identifying the acceptance client and `Accept: image/jpeg` for CDN reads; no application or Cloudflare configuration was changed.
- The final complete staging run exited successfully with **33/33 assertions passed**: database readiness; two account registrations; complete profile save/reread; second-account public Profile privacy; signed PUT and server-normalized JPEG CDN retrieval; completion replay after temporary-upload cleanup; foreign upload rejection; avatar replacement with the old object absent from the CDN origin; rejection of replay after replacement; new-session profile/photo persistence; avatar deletion with the object absent and profile reference cleared; rejection of replay after deletion; disguised extensions, oversized uploads, and non-image content rejected.
- Cleanup succeeded: generated test profiles were emptied, their photos deleted, and all generated sessions revoked. Empty test accounts remain because permanent account deletion is implemented in a later MVP step.
- Added `scripts/verify-step-05-staging.py` to repeat the deployed acceptance path without third-party credentials. It checks repeated completion after cleanup, cross-account rejection, JPEG CDN retrieval, replacement/deletion cleanup, fresh-session persistence, and invalid file rejection. It prints assertion labels only; failed cleanup preserves generated credentials in a private recovery file.
- Local backend lint/typecheck/build, all 80 tests, production dependency audit (zero vulnerabilities), Step 05 structure, MVP scope, secret guards, and staging/production built iOS configuration passed again.
- The local full native run passed all 66 unit tests and 10 of 11 UI tests, including Profile edit/save and public coordinate privacy. `testForgotPasswordToResetResultFlow` failed when its initial navigation tap did not open the reset form; an unchanged, isolated rerun passed (1/1). All 77 unique native tests have passed, with this one initial UI failure recorded rather than treating the first run as clean.

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
| Native XCTest and XCUITest | 77 unique tests passed; one initial auth UI failure passed on isolated rerun |
| Final Render staging deployment and live acceptance | Pass — commit `10c8168`, 33/33 assertions, cleanup successful |

The local PostgreSQL integration command cannot run because this workstation has
no `TEST_DATABASE_URL` and no Docker/PostgreSQL executable. The migration and
real persistence assertions are included in the integration suite for CI.
