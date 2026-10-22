# Claude Code guidance

Follow [AGENTS.md](AGENTS.md) for repository-wide guidance and
[CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow.
See [local development](docs/local-development.md) for commands and environment setup.

The active release product is the SwiftUI app in `LauverNative/` with the API in
`backend/`. `src/` is the legacy Expo prototype. Do not apply the prototype's
Firebase/Supabase architecture to the native app, or assume root npm commands build iOS.
