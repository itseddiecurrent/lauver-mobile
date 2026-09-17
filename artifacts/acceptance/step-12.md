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
