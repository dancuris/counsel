#!/usr/bin/env bash
# Runs the app against the DEMO database on port 3100.
#
# `next dev` loads .env.local by itself, and .env.local is PRODUCTION. Shell
# variables take precedence over .env files in Next.js, so the demo values have
# to be exported here rather than left to file ordering - otherwise you get the
# demo banner over Dan's real pipeline, which is the exact thing this whole
# mode exists to prevent.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env.demo ] || { echo "No .env.demo. Run ./scripts/demo-setup.sh first." >&2; exit 1; }

set -a
. ./.env.demo
set +a

# Refuse if the demo URL somehow matches production.
if [ -f .env.local ] && grep -qF "$DATABASE_URL" .env.local; then
  echo "Refusing: .env.demo points at the production database." >&2
  exit 1
fi

echo "Demo on http://localhost:3100"
echo "  database: $(echo "$DATABASE_URL" | sed -E 's|.*@([^/?]+).*|\1|')"
exec npx next dev --port 3100
