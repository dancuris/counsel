#!/usr/bin/env bash
# Sets up the demo database from a connection string on the clipboard.
#
# The URL never goes through chat or a command argument: copy it from Neon,
# run this, and it lands in .env.demo, which .gitignore already covers.
#
#   1. Create a database (or a branch) in the Neon console
#   2. Copy its pooled connection string
#   3. ./scripts/demo-setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

URL="$(pbpaste)"
case "$URL" in
  postgres://*|postgresql://*) ;;
  *) echo "Clipboard does not hold a Postgres URL. Copy the connection string from Neon first." >&2; exit 1 ;;
esac

# Refuse the production database outright, whatever else happens below.
if [ -f .env.local ] && grep -qF "$URL" .env.local; then
  echo "That is the production connection string. Create a separate database for the demo." >&2
  exit 1
fi

# Single-quoted, because a Neon URL carries "&channel_binding=require" and an
# unquoted ampersand makes the shell background the assignment when this file
# is sourced - the variable then never gets set, with no error until something
# reads it.
printf "DATABASE_URL='%s'\nDEMO_MODE=1\n" "$URL" > .env.demo
echo "Wrote .env.demo (gitignored). Host: $(echo "$URL" | sed -E 's|.*@([^/?]+).*|\1|')"

echo "Applying migrations..."
# Read .env.demo into the environment rather than adding a dotenv CLI just for
# this. Prisma reads DATABASE_URL straight off the environment.
set -a
. ./.env.demo
set +a
npx prisma migrate deploy

echo "Seeding..."
npm run demo:seed

echo
echo "Done. Run the demo locally with:"
echo "  DEMO_MODE=1 npx next dev --port 3100   # after pointing DATABASE_URL at .env.demo"
