# Step 01 Acceptance Record

> Status: implementation verification in progress; Render staging acceptance pending
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

Pending the first push containing Step 01. GitHub Actions is configured to:

1. start PostgreSQL 17;
2. reset the isolated `lauver_test` schema;
3. run `prisma migrate deploy` from an empty schema;
4. verify the real Prisma/PostgreSQL `/readyz` path and migrated table;
5. run lint, typecheck, 27 unit tests, integration tests, production build, Docker build, dependency audit, and repository guardrails.

## Render staging acceptance

Pending creation of the Render Blueprint resources from `render.yaml`. Completion requires recording:

- the Render staging API URL;
- successful pre-deploy migration output;
- `GET /healthz` returning 200;
- `GET /readyz` returning 200;
- persistence after a Render restart or redeploy.

Step 01 must not be marked complete until both CI and Render staging acceptance pass.
