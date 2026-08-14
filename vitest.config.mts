import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Tests for the pure modules, and only those.
 *
 * `CLAUDE.md` claimed several of these rules were "tested" long before any test
 * file existed - the boundary cases, the contact grouping, the composer audit.
 * Each of those was a script somebody ran once in a terminal and deleted, so
 * nothing would have caught a regression in any of them. This is that claim
 * made true.
 *
 * Deliberately no database and no environment: every module under test is a
 * pure function over plain data, which is why they were written that way. A
 * test that needs `.env.local` is a test that will not run in CI.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
