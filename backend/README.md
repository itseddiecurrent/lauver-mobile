# Lauver API

The native MVP API uses TypeScript, Express, PostgreSQL and Prisma. See the
[repository README](../README.md) for local setup, secrets, signing and API contracts.

## Staging deployment

Render deploys `main` with `backend/` as its root directory and waits for CI checks.
The build command is `./scripts/build-deploy.sh`; startup runs
`npm run db:migrate:deploy && npm start` so the deployed code and schema are updated together.

Render only starts automatic deployments for changes inside the root directory.
If a backend commit fails CI and a later fix only changes iOS tests or files outside
`backend/`, passing CI on that fix does not itself trigger a backend deployment.
Use **Manual Deploy > Deploy latest commit**, or a subsequent change inside `backend/`,
to deploy the tested revision. Do not apply a schema migration separately while old code is live.
See [Render monorepo rules](https://render.com/docs/monorepo-support) and
[CI deployment rules](https://render.com/docs/deploys#integrating-with-ci).

## Step 06 acceptance

After deployment, run `npm run verify:step-06:staging` from this directory.
Configure the same staging database's external connection URL in the ignored
`.env.staging` file, using `.env.staging.example` as a template.
The verifier checks numeric pace ranges, radius options, Unlimited, deterministic
pagination, account exclusions and location privacy, then deletes its 34 test accounts.
See [Step 06 evidence](../artifacts/acceptance/step-06.md) for results and cleanup recovery.

## Step 07 acceptance

Deploy code and `20260913020000_profile_safety` together, then run `npm run verify:step-07:staging`
using the same ignored `.env.staging` configuration. The verifier checks Profile / Discover block
isolation, Profile evidence and Report and Block, then removes its three disposable accounts,
reports and safety audit data. Recover interrupted cleanup with `--cleanup-state` and the exact
private journal printed by the script. No new provider account or secret is required.
The verifier requires a healthy API, an authenticated `/v1/blocks` route and the reports
schema before creating any test accounts. Its automatic run deletes every fixture;
iPhone acceptance uses a separate disposable run and retains its exact cleanup journal
until manual testing ends. Local UI tests and successful installation do not establish
that the deployed API passed acceptance.
See [Step 07 evidence](../artifacts/acceptance/step-07.md) and the repository README for the contract.

## Step 08 acceptance

The staging Strava application is created with public Client ID `229012` and callback
domain `lauver-api-staging.onrender.com`. Store its client secret and dedicated token
encryption key directly in the Render service's Environment settings. Add the fixed
`STRAVA_CALLBACK_URL` and set `STRAVA_ENABLED=true` only with all required settings.
The Blueprint leaves the enabled flag under manual control (`sync: false`) so later
Blueprint updates preserve the selected value; a missing flag defaults to disabled
in the backend. Deploy the code and migration together after CI passes.

Run `npm run verify:step-08:staging -- --action prepare` only after the new authenticated
Strava status route is live. The staged verifier creates one private disposable Lauver
account; the owner authorizes their own Strava athlete on iPhone. See
[Step 08 evidence](../artifacts/acceptance/step-08.md) for the connect/expire/refresh/revoke
commands and exact fixture cleanup. An unsigned archive or fake provider does not
establish real OAuth or provider revocation acceptance.

## Step 11 acceptance

After deploying the Events fixes, use the existing private `.env.staging` configuration:

```sh
npx tsx scripts/verify-step-11-staging.ts prepare
npx tsx scripts/verify-step-11-staging.ts verify
npx tsx scripts/verify-step-11-staging.ts cleanup
```

The private journal defaults to `/tmp/lauver-step11-acceptance.json`; an explicit path
can be passed as the second argument. Preparation creates four disposable accounts
and 21 earlier events to reproduce a newly created event falling outside page one.
Run `prepare` again to refresh fixture times before a delayed device/API run.
`verify` measures create/immediate read, traverses pagination, races three distinct
users for one remaining place, checks permissions, idempotency, edit, reporting and
cancellation, then verifies report snapshots and audit rows in PostgreSQL.
If only database connectivity failed, `evidence` resumes using saved report receipts.
Keep the private journal until `cleanup` successfully removes the exact fixture accounts.
Never commit it or use these credentials outside staging. See
[Step 11 evidence](../artifacts/acceptance/step-11.md) for the device results and current
staging status; a local pass does not establish deployment acceptance.
