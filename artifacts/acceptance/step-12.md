# Step 12 acceptance — Event Attendee Group Chat

Date: 2026-09-17

## Implemented

- Each event uses the deterministic private Stream channel `event-<event UUID without hyphens>`.
- The backend derives access from the current `event_attendees` rows and requires `UPCOMING` status for open/send/report operations.
- Create and Join compensate a failed Stream membership write by removing the DB event/member; Leave restores the DB membership if Stream removal fails; Cancel restores the event status if bulk removal fails.
- Event message evidence is preserved through the existing safety report pipeline and identifies the event, channel, and message sender.
- `npm run reconcile:stream-memberships -- --dry-run` reports missing/unexpected members; `--apply` repairs them.
- iOS Event Detail exposes Open Group Chat only to current attendees.

## Automated evidence

- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm test -- --pool=forks --poolOptions.forks.singleFork=true` — 158 tests passed, including 2 Step 12 Stream tests.
- `xcodebuild build -project LauverNative/Lauver.xcodeproj -scheme Lauver-Staging -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO` — BUILD SUCCEEDED.

## Remaining real-environment checks

Run against Stream staging with four identities: attendee, non-attendee, left attendee, and suspended attendee. Verify query/watch/send access, immediate access revocation after Leave/Cancel/Suspend, real-time exchange from two devices, report evidence after message deletion, and a manually introduced membership difference repaired by dry-run/apply reconciliation.

## 2026-09-17 continuation

- Real staging `reconcile:stream-memberships --dry-run` passed with `differences: []`.
- The first real staging API E2E exposed a send failure: event members could query the channel but received `403 event_chat_forbidden` when sending. The cause was the deployed Stream channel permission set missing `send-message` for `channel_member`.
- Fixed locally and committed as `1528b52` (`channel_member` now includes `send-message`); backend lint, typecheck, and 158 tests pass.
- The fix was pushed to `main`, but the public staging API still returns the pre-fix 403, so Render deployment has not yet switched to `1528b52` (or is not exposing deployment status). Temporary acceptance accounts created during the probes were cleaned up.
- A real-device Xcode build/install completed on `Edi’s Little Secret`, but the initial XCTest filter selected zero tests. No real-device Step12 pass is claimed from that run.

### Current sign-off

Not signed off. Re-run the four-identity staging E2E and two-device UI flow after Render is confirmed on `1528b52`; then record the actual watch/send, leave/cancel/suspend revocation, message-report evidence, and reconciliation apply results here.

## 2026-09-17 re-test

- Re-ran the full disposable-identity staging E2E after pushing `8db2cb3`.
- Authentication, event creation, joins, attendee query, non-attendee denial, Leave, and left-attendee denial passed.
- Attendee send still returned `403 event_chat_forbidden`; message report and subsequent cancellation checks were therefore not reached.
- All temporary accounts were verified removed (`remaining step12 temp accounts: 0`).
- The deployed staging revision still needs to be confirmed/advanced to `8db2cb3` before another acceptance run.
