#!/usr/bin/env bash
#
# Build, lint, audit, then commit and deploy. In that order, and it stops.
#
# The reason this exists: the share-target change went to production with a
# lint error and an unchecked fetch in it. Both were caught - by the very
# commands that were running in the same shell line as the push. Their output
# arrived after the deploy had already happened, so "I ran the checks" and "the
# checks passed" looked identical in the transcript.
#
# A check whose result you read afterwards is not a gate. This one exits.
#
#   ./scripts/ship.sh "commit subject" [--prod]
#
# Without --prod it stops after pushing main, which only builds a preview.
set -euo pipefail
cd "$(dirname "$0")/.."

MESSAGE="${1:-}"
[ -n "$MESSAGE" ] || { echo "usage: ./scripts/ship.sh \"commit message\" [--prod]" >&2; exit 1; }
# A commit subject is not a file, so the audit cannot reach it - and the subject
# is frozen into changelog.json and rendered on /releases. Naming a real
# recruiter or employer here would publish it by a route the gate does not
# watch. Skipped when .private-names is absent, which is the case in any clone
# that has nothing to protect.
if [ -f .private-names ]; then
  NAMES="$(grep -vE '^\s*(#|$)' .private-names | paste -sd'|' -)"
  if printf '%s' "$1" | grep -qiE "\\b(${NAMES})\\b"; then
    echo "Commit subject names a real person or employer." >&2
    echo "It would be frozen into the changelog and rendered on /releases." >&2
    exit 1
  fi
fi

# Read from either slot, so --no-story and --prod can be given in any order.
# Pinning --prod to $2 meant "ship.sh msg --no-story --prod" silently shipped
# to preview only, which is the quiet kind of wrong this script exists to stop.
PROD=""
for arg in "${@:2}"; do [ "$arg" = "--prod" ] && PROD="--prod"; done

# A release history made of commit subjects is a record for whoever wrote them.
# Every ship carries a user-facing story in src/data/stories.ts, keyed on this
# exact message, and /releases reads it. Gated rather than remembered, for the
# same reason the lint and audit checks are gated: a habit that depends on
# remembering is not a habit.
#
# --no-story is the escape for genuinely user-invisible commits (documentation,
# a dependency bump). It has to be typed, so skipping is a decision.
if [ "${2:-}" != "--no-story" ] && [ "${3:-}" != "--no-story" ]; then
  if ! grep -qF "subject: \"$MESSAGE\"" src/data/stories.ts; then
    echo "No story in src/data/stories.ts for:" >&2
    echo "  $MESSAGE" >&2
    echo "" >&2
    echo "Add one - area, title, story, problem - or pass --no-story if this" >&2
    echo "genuinely changes nothing a user would notice." >&2
    exit 1
  fi
fi

echo "==> build"
npm run build >/tmp/ship-build.log 2>&1 || { tail -30 /tmp/ship-build.log; echo "BUILD FAILED" >&2; exit 1; }

echo "==> test"
npm test >/tmp/ship-test.log 2>&1 || { tail -40 /tmp/ship-test.log; echo "TESTS FAILED - not shipping" >&2; exit 1; }

echo "==> lint"
# Warnings are tolerated, errors are not.
#
# Captured to a variable rather than piped, because `set -o pipefail` inverted
# this gate completely. eslint exits 1 when it finds errors; grep then exits 0
# having matched; pipefail returns the pipeline's non-zero, so the `if` was
# FALSE precisely when there were errors to catch. The gate could only fire
# when eslint exited clean, which is when there is nothing to fire about.
#
# It had never once fired. A `set-state-in-effect` error - the rule CLAUDE.md
# calls out by name - shipped straight through it and was caught by CI on its
# first run, which is the entire argument for having CI.
LINT="$(npx eslint src 2>&1 || true)"
if printf '%s' "$LINT" | grep -qE "[1-9][0-9]* error"; then
  printf '%s\n' "$LINT" | grep -B 3 "error" | head -20
  echo "LINT ERRORS - not shipping" >&2
  exit 1
fi

echo "==> audit"
AUDIT="$(npx tsx --env-file=.env.local scripts/audit.ts 2>/dev/null || true)"
if ! printf '%s' "$AUDIT" | grep -q "0 to look at"; then
  printf '%s\n' "$AUDIT" | tail -25
  echo "AUDIT FINDINGS - not shipping" >&2
  exit 1
fi

echo "==> changelog"
npm run changelog >/dev/null 2>&1 || true

echo "==> commit"
git add -A
git commit -q -m "$MESSAGE" || echo "   (nothing to commit)"
git push -q origin main
echo "   pushed main"

if [ "$PROD" = "--prod" ]; then
  git checkout -q production
  git pull -q --rebase origin production 2>/dev/null || true
  git merge -q main -m "Merge: $MESSAGE"
  git push -q origin production
  git checkout -q main
  echo "   pushed production $(git rev-parse --short production)"
  echo "   confirm it moved: npx vercel inspect tracker.ecuris.com"
fi
