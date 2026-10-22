# Contributing to Lauver

Use this workflow for code, documentation, tests and infrastructure changes.
Write new issues, pull requests, commit messages and contributor documentation in English.

## Workflow

1. Search existing issues, then claim or open a Bug, Feature or Task using the
   [issue guide](docs/issue-workflow.md). Agree acceptance criteria before implementation.
   If assignment permissions are unavailable, comment that you are taking the work.
2. Start a short-lived branch from current `main`: `<name>/<issue>-<topic>` for
   contributors, or `codex/<issue>-<topic>` for coding agents. Use a descriptive
   topic when an issue number is not yet available.
3. Make one coherent change. For bugs, reproduce first and add a regression test
   when it can meaningfully protect the behavior. Keep unrelated cleanup separate.
4. Run the relevant checks below, exercise the changed flow and review every line
   of your diff, including generated or agent-written code.
5. Open a PR targeting `main`, link its issue with `Closes #123`, explain the
   behavior change, and provide exact verification results and remaining limits.
   Use `Related to #123` if the change only addresses part of an issue.
6. Address review feedback and rerun affected checks. Obtain maintainer review,
   then squash merge and remove the branch when approved.

Prefer small PRs that can be reviewed in one sitting. Split work with independent
acceptance criteria into separate issues. Draft PRs may be used for early feedback;
clearly identify missing checks before requesting final review.

These are contributor conventions. The checked-in CI currently runs guardrails,
backend checks and native iOS tests; it does not enforce issue links, branch names,
human approval or an automated AI review. Repository branch protection and remote
service settings must be configured separately by a maintainer.

## Scope and architecture

The release app is `LauverNative/`; its backend is `backend/`. `src/` and the root
Expo package are legacy/reference code. Identify which implementation an issue
concerns before changing it. Do not implement a native fix only in Expo.

Follow [mvp.md](mvp.md) and [openapi/mvp.yaml](openapi/mvp.yaml). The native MVP
excludes AI features, Garmin integration, paid subscriptions and in-app purchases.
Matching is deterministic. Preserve city-level location privacy, authenticated
ownership checks, block isolation and opt-in, read-only HealthKit data boundaries.
Keep secrets on the backend; never place private keys or provider tokens in app config.

## Verification

Set up dependencies using [local development](docs/local-development.md).
Run these repository guards for every change:

```sh
./scripts/check-mvp-scope.sh
./scripts/check-secrets.sh
git diff --check
```

For backend changes, run from `backend/`:

```sh
npm run db:generate
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
```

The integration runner resets its target schema. Use only a disposable local
database with a name ending in `_test`; inspect `TEST_DATABASE_LOCAL` and
`TEST_DATABASE_URL` before running it. Never point it at staging or production.
Add a Prisma migration for schema changes, check migration-from-zero behavior,
and update the API contract when request or response behavior changes.

For native changes, run from the repository root:

```sh
./scripts/test-ios-config.sh
IOS_SKIP_EXTERNAL_UI=true ./scripts/test-ios.sh
```

This skips three external-service UI cases, not every possible staging dependency.
Record skips, failures, destination, scheme and configuration. CI additionally sets
`IOS_STEP_00=true`, narrowing UI coverage to the launch smoke test; a green iOS CI
job does not establish full device acceptance. HealthKit, Apple/Strava authorization,
notifications and real Stream sessions require appropriate device/provider checks.
Use [release instructions](docs/testflight-release.md) for release acceptance.

For legacy Expo changes, install root dependencies and run `npm test -- --runInBand`.
For documentation-only changes, validate links, referenced paths/commands and diff
hygiene; full application builds are unnecessary unless behavior also changes.
If a check cannot run, state why and what remains unverified. Never report it as passed.

## Commits and review

Use a short imperative subject such as `fix: preserve event capacity on concurrent joins`
or `docs: explain native development setup`. Common prefixes are `feat`, `fix`,
`docs`, `test`, `refactor`, `ci` and `chore`.

Fetch and rebase onto `origin/main` when needed; do not rewrite another contributor's
branch. Use `--force-with-lease` only for your own published branch when necessary.
Do not push directly to `main`. A push to `main` can trigger deployment under the
Render configuration, so release-impacting changes need explicit review of migrations,
configuration and rollback/recovery implications.

The author owns the change even when an assistant wrote it. Inspect generated
changes, explain validation and resolve review findings with a fix or rationale.
Do not dismiss feedback solely because a tool produced it.

## Data and external acceptance

Use disposable test accounts. Redact logs and screenshots; never attach access or
refresh tokens, database URLs, private keys, health records or private conversations.
Staging acceptance scripts may create accounts, write data or revoke provider grants;
read their documented prepare/verify/cleanup flow before use and retain private cleanup
journals until fixtures are removed. Never commit those journals or credentials.
Deployment, provider configuration, TestFlight publication and database cutovers are
separate operational actions; a local test pass is not evidence they happened.
