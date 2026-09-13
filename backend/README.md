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
