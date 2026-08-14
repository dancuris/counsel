#!/usr/bin/env node
/**
 * Applies pending migrations during a Vercel build, and nowhere else.
 *
 * ## The bug this fixes
 *
 * Nothing ran `prisma migrate deploy`. Ever. The schema on the live database
 * got there because migrations were run **by hand from a laptop**, which works
 * for exactly one person and hides the problem completely: a fresh deployment
 * against a new database builds successfully, starts successfully, and then
 * returns a 500 on every page, because there are no tables. The one person who
 * would never see it is the person who has been migrating by hand.
 *
 * That is the difference between "somebody else can deploy this" and "somebody
 * else can deploy this and it works".
 *
 * ## Why it is gated on Vercel rather than on DATABASE_URL
 *
 * The obvious gate is "migrate when a database is configured". That breaks CI,
 * which deliberately sets `DATABASE_URL` to `postgresql://ci:ci@localhost:5432/ci`
 * so the build can typecheck Prisma calls without a real database. Migrating
 * against that hangs or fails, and a green build would start failing for a
 * reason unrelated to the change that triggered it.
 *
 * `VERCEL` is set only by a Vercel build, which is the only place a deployment
 * actually happens, so it is the honest test.
 *
 * ## It fails the build rather than warning
 *
 * A deploy that half-migrates is worse than one that does not deploy: the app
 * comes up and writes into a schema that does not match the code. This app has
 * already learned that lesson expensively - a bulk repair where every step
 * succeeded and the result was destroyed data. So a failed migration stops the
 * build, loudly, and the previous deployment stays live.
 */

import { execFileSync } from "node:child_process";

if (!process.env.VERCEL) {
  console.log("[migrate] not a Vercel build, skipping. Migrations are applied on deploy only.");
  process.exit(0);
}

/**
 * Production deploys only, and this is not a detail.
 *
 * Preview shares the production database. Migrating on every Vercel build would
 * mean pushing a branch - from anywhere, including a phone - silently applied a
 * schema change to the live database before anybody had looked at the preview.
 * That is a worse failure than the one this script exists to fix, and it would
 * arrive by accident rather than by decision.
 *
 * A preview of a branch carrying a new migration therefore runs against a
 * schema that does not have it yet, and will fail on the new column. That is
 * the correct outcome: it fails on a preview nobody depends on, instead of
 * quietly changing the database Dan's real job search lives in.
 */
if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
  console.log(`[migrate] VERCEL_ENV is "${process.env.VERCEL_ENV}", skipping.`);
  console.log("[migrate] Preview shares the production database, so only a production deploy may migrate it.");
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error("[migrate] DATABASE_URL is not set on this deployment.");
  console.error("[migrate] Add it in the Vercel project's environment variables, then redeploy.");
  process.exit(1);
}

console.log("[migrate] applying pending migrations");
try {
  execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit" });
} catch {
  console.error("");
  console.error("[migrate] Migrations failed, so the build is stopping here.");
  console.error("[migrate] The previous deployment is still serving. Nothing was half-applied on purpose:");
  console.error("[migrate] an app running against a schema it does not match is worse than one that did not ship.");
  process.exit(1);
}
