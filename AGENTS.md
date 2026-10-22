# Repository guidance for coding agents

Read [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md) and the
[issue workflow](docs/issue-workflow.md) before changing this repository.

- The active product is `LauverNative/` plus `backend/`. Root Expo scripts and
  `src/` are legacy. Identify the target before editing.
- Write new contributor documentation, issues, PRs and commit messages in English.
  Preserve the app's English and Simplified Chinese localization support.
- Respect `mvp.md` scope and update `openapi/mvp.yaml` for API contract changes.
- Use short-lived `codex/<issue>-<topic>` branches for new agent work. Do not discard
  existing user changes or change branches with uncommitted work without preserving it.
- Use the verification matrix in CONTRIBUTING.md. Report checks actually run,
  failures/skips and prerequisites; never present old acceptance counts as fresh results.
- Do not use staging/production for destructive integration tests. Read fixture
  cleanup instructions before running staging acceptance tools.
- Keep credentials, personal data, private journals and build artifacts out of commits.
- Review your diff and keep changes focused. Local implementation does not establish
  deployment, provider acceptance or TestFlight publication.

Historical planning files and acceptance reports are context, not a current task queue.
Prefer code, the API contract and dated evidence over stale completion claims.
