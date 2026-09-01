#!/usr/bin/env bash
set -euo pipefail

npm ci
npm run db:generate
npm run build
