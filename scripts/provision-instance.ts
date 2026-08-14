/**
 * Creates a whole Counsel instance for somebody else, from the terminal.
 *
 *   VERCEL_TOKEN=... NEON_API_KEY=... npx tsx scripts/provision-instance.ts --name counsel-alex
 *
 * The same thing the Instances page does, and deliberately the same code: this
 * script used to carry its own copy of the four API calls, which is exactly the
 * setup for the fault this codebase keeps re-learning. A rule or a sequence
 * duplicated in two places is not duplicated for long, it diverges - the
 * single-page resume rule lived in four places and three of them disagreed.
 *
 * Everything real lives in `src/lib/provision.ts`. This file is argument
 * parsing and printing.
 */

import { platformKeys, provisionInstance, buildState, nameProblem, DEFAULT_REPO, DEFAULT_REF } from "@/lib/provision";
import { prisma } from "@/lib/prisma";
import { seal } from "@/lib/secrets";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const name = (arg("--name") ?? "").trim().toLowerCase();
  const problem = nameProblem(name);
  if (problem) throw new Error(`${problem}\n\nUsage: npx tsx scripts/provision-instance.ts --name counsel-alex`);

  const repo = arg("--repo") ?? DEFAULT_REPO;
  const ref = arg("--ref") ?? DEFAULT_REF;
  const withToken = !process.argv.includes("--no-token");

  const { keys, missing } = await platformKeys();
  if (!keys) {
    throw new Error(
      `Missing the ${missing.join(" and ")}.\n` +
        "Set VERCEL_TOKEN (vercel.com/account/tokens) and NEON_API_KEY\n" +
        "(console.neon.tech/app/settings/api-keys), or save them in Settings."
    );
  }

  console.log(`\nProvisioning "${name}" from ${repo}#${ref}\n`);
  const result = await provisionInstance({ name, repo, ref, withToken }, keys);

  // Recorded so the Instances page can show it and push updates to it later.
  // A CLI-created instance that the page does not know about would never be
  // told about a new version.
  await prisma.provisionedInstance.create({
    data: {
      name: result.name,
      url: result.url,
      vercelId: result.vercelId,
      deploymentId: result.deploymentId,
      sha: result.sha,
      // Sealed, exactly as the page does it. Printing it once and keeping no
      // copy would mean closing the terminal loses the invite.
      sealedToken: result.setupToken ? seal(result.setupToken) : null,
    },
  });

  console.log("Building. This takes a couple of minutes.\n");
  const deadline = Date.now() + 5 * 60 * 1000;
  let last = "";
  while (Date.now() < deadline) {
    const state = await buildState(result.deploymentId, keys);
    if (state !== last) {
      console.log(`  ${state}`);
      last = state;
    }
    if (state === "ready" || state === "failed") break;
    await new Promise((r) => setTimeout(r, 5000));
  }

  console.log("\n" + "=".repeat(60));
  console.log(`  Send them:   ${result.url}`);
  if (result.setupToken) console.log(`  Setup token: ${result.setupToken}   (send separately)`);
  if (last !== "ready") console.log(`\n  Not ready yet. Check the build log on Vercel.`);
  console.log("=".repeat(60) + "\n");

  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
