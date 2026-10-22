# Local development

## Choose the implementation

| Work | Entry point | Tools |
| --- | --- | --- |
| Native release app | `LauverNative/Lauver.xcodeproj` | macOS, full Xcode, iOS SDK/device or Simulator |
| REST API | `backend/` | Node.js 24 (supported range: >=24 <27), npm, PostgreSQL 17 |
| Legacy prototype | Root `package.json`, `src/` | npm, Expo; separate from native MVP |

The root npm scripts launch Expo. They do not build the SwiftUI app.

## Backend

From the repository root:

```sh
cd backend
cp .env.example .env
npm ci
docker compose up --detach postgres
npm run db:generate
npm run db:migrate:deploy
npm run dev
```

Use an ignored `.env` with a unique local `AUTH_ACCESS_TOKEN_SECRET` of at least 32
characters. The Compose defaults match the example's local database connection.
The PostgreSQL initializer creates development and disposable test databases on a
new volume. An existing volume may need its test database created separately;
do not delete a volume containing data you need.

```sh
curl http://localhost:3000/healthz
curl http://localhost:3000/readyz
```

Liveness and database readiness are separate. Optional Apple/Firebase authentication,
Strava, reset-email delivery and photo storage start disabled in the example.
Configure only what your task needs. Stream chat needs its server-side configuration;
see [backend notes](../backend/README.md) and the detailed
[README configuration boundaries](../README.md#configuration-boundaries).

The hosted native API uses Supabase PostgreSQL's `native` schema through Express.
Local development uses the Compose PostgreSQL instance. The legacy Expo Supabase
client and its public-schema migrations are a separate path.

## Native iOS

Open `LauverNative/Lauver.xcodeproj` in Xcode and choose `Lauver-Staging`.
The checked-in Staging and Production schemes currently both point to the hosted
staging API; launching either is not automatically a local-backend test.
Inspect `LauverNative/Config/` before selecting an environment. For local API work,
use an uncommitted configuration adjustment and a reachable URL; a physical iPhone
cannot reach your Mac's API through the phone's own `localhost`. Restore shared
configuration before submitting unless the change intentionally updates it.

Copy `LauverNative/Config/Local.xcconfig.example` to ignored `Local.xcconfig` when
local signing or public client identifiers are needed. That file is included before
scheme-specific values, so an `API_BASE_URL` placed there is overridden by the scheme.
Never place database credentials, OAuth client secrets or private keys in Xcode config.
Simulator tests do not need an Apple Developer Team ID. Real-device signing and
provider capabilities need the appropriate developer account and provisioning.

See [contribution verification](../CONTRIBUTING.md#verification) for test commands.
HealthKit permission/import behavior requires a real device. Provider acceptance
requires explicitly configured test accounts and cleanup.

## Legacy Expo prototype

Only use this path when intentionally working on the old prototype:

```sh
cp .env.example .env
npm ci
npm start
```

The root environment example contains public Firebase/Supabase client settings.
An `EXPO_PUBLIC_` value is bundled into the client and must never contain a secret.
The legacy backend/schema is not assumed operational; see the README's dated
Supabase status. HealthKit modules require a native development build rather than
ordinary Expo Go. Run legacy tests with `npm test -- --runInBand`.
