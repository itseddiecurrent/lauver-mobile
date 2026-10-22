# Raising and triaging issues

Use [GitHub issues](https://github.com/itseddiecurrent/lauver-mobile/issues) for
Lauver work. Search open and closed issues first. Add new evidence to an existing
report when it describes the same root behavior; link related but distinct issues.

## Choose a report

- **Bug:** current behavior differs from expected behavior. Include a minimal
  reproduction, expected/actual results, impact and regression information.
- **Feature:** explain the user problem, proposed behavior, alternatives and scope.
- **Task:** describe a documentation, testing, maintenance, refactor or CI outcome.

GitHub provides Markdown templates for all three. If issue types or labels are
available, apply the matching ones; this workflow does not depend on pre-created
labels, organization issue types or a project board.

## Make the report reproducible

Name the affected component: native iOS, API, database/migrations, provider integration,
legacy Expo or documentation. State local/staging/production, commit or build number,
iOS/device or Simulator, scheme, and relevant provider flags. Include a timestamp and
timezone for service failures and a sanitized request ID when available.

Use numbered reproduction steps and concrete results. Distinguish a local code
failure from missing credentials, stale deployment, unavailable provider or bad
fixture data. If the cause is unknown, say so. Logs and screenshots should show only
the minimum needed; redact identities, precise locations, health data and credentials.
For a suspected security vulnerability, contact the repository owner privately
through an available private channel rather than posting exploit details publicly.

Every issue needs observable acceptance criteria, for example:

- Joining an event with one remaining place admits at most one concurrent caller.
- The rejected caller sees a useful error and an accurate remaining-place count.
- A repeatable API integration test covers this race.

## Triage and ownership

1. Confirm scope and duplicates; ask for missing reproduction details.
2. Classify impact and urgency in the issue body. Suggested priorities: P0 for an
   active severe outage or data exposure; P1 for a core flow blocked without a
   workaround; P2 for normal bugs/features; P3 for polish. Maintainers decide order.
3. Assign an owner and agree acceptance criteria. Link dependencies and explain
   blocked work. Use comments when sidebar permissions are unavailable.
4. Implement through the [contribution workflow](../CONTRIBUTING.md), linking the
   issue in the PR. Keep progress and new findings in the same issue.
5. Close after the agreed criteria are met. Link verification evidence and identify
   remaining release/device checks. Close duplicates with a link to the canonical
   issue, or explain why work is not planned. Reopen with fresh evidence if it recurs.

Do not equate an implementation checkbox, green smoke CI or a successful archive
with a production release. Record code completion and external acceptance separately.
