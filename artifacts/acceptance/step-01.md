# Step 01 Acceptance Record

> Status: implementation and CI complete; Render staging acceptance pending
>
> Last updated: 2026-09-01 (Asia/Shanghai)

## Scope

Step 01 establishes the deployable Express/PostgreSQL foundation: validated configuration, structured and redacted logging, security headers, a CORS allowlist, server-generated request IDs, Prisma migrations, separate liveness/readiness checks, graceful shutdown, Docker packaging, and a Render Blueprint.

## Verification environment

- Repository: `lauver-mobile`
- Branch: `main`
- Node.js: `v26.7.0` (allowed by `>=24 <27`)
- npm: `11.19.0`
- Local PostgreSQL/Docker: not installed; real database and image checks delegated to GitHub Actions
- Third-party credentials used locally: none

## Local automated results

| Check | Result | Evidence |
|---|---|---|
| Prisma Client generation | Pass | Prisma 6.12 client generated from `prisma/schema.prisma` |
| Backend lint | Pass | ESLint 10 with typed rules |
| Backend typecheck | Pass | `tsc --noEmit` |
| Backend unit and boundary tests | Pass | 27/27 tests across config, liveness/readiness, CORS, logging redaction, test-database reset safety, graceful shutdown, and the database-independent Step 00 health path |
| Backend production build | Pass | `npm run build` |
| Production dependency audit | Pass | `npm audit --omit=dev` reported 0 vulnerabilities |
| Scope and secret guards | Pass | Product scope and working-tree secret scans passed |
| Runtime without PostgreSQL | Pass | `/healthz` returned 200; `/readyz` returned the public 503 error contract without internal details |
| SIGINT shutdown | Pass | HTTP server closed and Prisma disconnected cleanly |

## CI verification

[`guardrails`, `backend`, and `ios` completed successfully](https://github.com/itseddiecurrent/lauver-mobile/actions/runs/33492402851). The Backend job:

1. started PostgreSQL 17;
2. reset the isolated `lauver_test` schema;
3. ran `prisma migrate deploy` from an empty schema;
4. passed both real Prisma/PostgreSQL integration tests for `/readyz` and the migrated table;
5. passed lint, typecheck, 27 unit tests, production build, Docker build, and dependency audit.

Guardrails and the complete native iOS regression suite also passed in the same run.

## Render staging acceptance

Pending creation of the Render Blueprint resources from `render.yaml`. Completion requires recording:

- the Render staging API URL;
- successful pre-deploy migration output;
- `GET /healthz` returning 200;
- `GET /readyz` returning 200;
- persistence after a Render restart or redeploy.

The Step 01 implementation and automated verification are complete. The overall step remains pending only on the external Render staging acceptance above.
