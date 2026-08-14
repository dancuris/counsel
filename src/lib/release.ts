import changelog from "@/generated/changelog.json";
import { prisma } from "@/lib/prisma";
import { recordFailure } from "@/lib/failures";

/**
 * What is running, and what shipped before it.
 *
 * Two different sources, deliberately, because they answer different questions
 * and disagreeing is the interesting case:
 *
 * - `VERCEL_GIT_COMMIT_SHA` is what is *actually deployed*, read from the
 *   running environment.
 * - `changelog.json` is what was *in the repository* when `npm run changelog`
 *   last ran.
 *
 * Comparing them is worth doing here specifically. A fast-forward merge leaves
 * `main` and `production` on the same commit, Vercel builds it once and
 * attributes it to whichever branch it saw first, and production can sit stale
 * with nothing on the dashboard looking wrong. This turns that silent failure
 * into a line on a page.
 */

export type ReleaseEntry = {
  sha: string;
  shortSha: string;
  author: string;
  date: string;
  subject: string;
  body: string;
};

const data = changelog as { generatedAt: string; entries: ReleaseEntry[] };

/**
 * The newest releases, capped by default.
 *
 * All 200 entries were rendered on every visit, which made `/releases` a 945 KB
 * page - five times the next heaviest in the app. Most of that is the commit
 * bodies: 143 KB of reasoning across 114 entries, folded into `<details>` and
 * therefore invisible but fully built, serialized and sent.
 *
 * This is the third time that exact fault has been found here, after the
 * dashboard's collapsed pipeline and the inbox's filed history. Hidden is not
 * unrendered, and a `<details>` is a visual affordance rather than a
 * performance one.
 */
export function getReleases(limit?: number): ReleaseEntry[] {
  return typeof limit === "number" ? data.entries.slice(0, limit) : data.entries;
}

/** How many exist in total, so a "show all" link can say what is behind it. */
export function releaseCount(): number {
  return data.entries.length;
}

/** The default page: enough to cover recent work without shipping the archive. */
export const RECENT_RELEASES = 30;

export function changelogGeneratedAt(): string {
  return data.generatedAt;
}

export type LiveVersion = {
  /** Short sha of what is deployed, or null when running outside Vercel. */
  shortSha: string | null;
  sha: string | null;
  branch: string | null;
  environment: string | null;
  /** How the deployed commit relates to the log; null when it cannot be told. */
  state: "current" | "behind" | "unlogged" | "local" | null;
  /** Commits between the deployed one and the newest in the log. */
  behindBy: number;
  /** Set when the running build is newer than the frozen log. */
  subject?: string | null;
};

export function getLiveVersion(): LiveVersion {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? null;
  const branch = process.env.VERCEL_GIT_COMMIT_REF ?? null;
  const environment = process.env.VERCEL_ENV ?? null;

  if (!sha) {
    // Running locally, where there is no deployment to be behind.
    return { shortSha: null, sha: null, branch, environment, state: "local", behindBy: 0 };
  }

  const index = data.entries.findIndex((e) => e.sha === sha);
  return {
    sha,
    shortSha: sha.slice(0, 7),
    branch,
    environment,
    // Not in the log means the log is older than the deploy, not that anything
    // is wrong. It is in fact the normal case: the generator freezes git
    // history before `git commit` creates the commit, so the commit being
    // shipped can never appear in its own changelog. Vercel supplies the
    // message, so the running build can describe itself rather than the page
    // reporting a fault that is really an off-by-one.
    state: index === -1 ? "unlogged" : index === 0 ? "current" : "behind",
    behindBy: index > 0 ? index : 0,
    subject: index === -1 ? (process.env.VERCEL_GIT_COMMIT_MESSAGE?.split("\n")[0] ?? null) : null,
  };
}

export const REPO_URL = "https://github.com/dancuris/job-search-tracker";

export function commitUrl(sha: string): string {
  return `${REPO_URL}/commit/${sha}`;
}

/**
 * Records that this build is serving traffic.
 *
 * Once per serverless instance, not once per request: the flag below is module
 * scope, so a warm instance does no work at all and a cold start does one
 * upsert. Many instances waking at once all write the same row, which is why
 * the table is unique on (sha, environment) and a duplicate is swallowed rather
 * than treated as an error.
 *
 * Quiet on failure, like the activity log and the Drive sync. Nobody's page
 * should fail because a deploy marker could not be written.
 */
let recordedThisInstance = false;

export async function recordDeployment(): Promise<void> {
  if (recordedThisInstance) return;
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  // Nothing to record outside Vercel: local dev is not a deploy.
  if (!sha) {
    recordedThisInstance = true;
    return;
  }
  // Set before awaiting, so concurrent requests on a cold instance do not all
  // queue up their own write.
  recordedThisInstance = true;

  try {
    const environment = process.env.VERCEL_ENV ?? "unknown";
    await prisma.release.upsert({
      where: { sha_environment: { sha, environment } },
      // Deliberately no update: deployedAt is when this commit FIRST reached
      // this environment, and a later instance waking up must not move it.
      update: {},
      create: {
        sha,
        environment,
        branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
        deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      },
    });
  } catch (error) {
    // Two instances racing the same unique row is normal rather than an error,
    // so this is recorded and not raised. It is still worth having: a deploy
    // marker that never lands makes /releases quietly wrong about what is live.
    await recordFailure("recordDeployment", error);
  }
}

export type DeploymentRecord = {
  sha: string;
  branch: string | null;
  environment: string;
  deploymentId: string | null;
  deployedAt: Date;
};

/** Deploy events keyed by sha, newest environment first for each. */
export async function getDeployments(): Promise<Map<string, DeploymentRecord[]>> {
  const rows = await prisma.release.findMany({ orderBy: { deployedAt: "desc" } });
  const bySha = new Map<string, DeploymentRecord[]>();
  for (const row of rows) {
    bySha.set(row.sha, [...(bySha.get(row.sha) ?? []), row]);
  }
  return bySha;
}
