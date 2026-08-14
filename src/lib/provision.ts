import { randomBytes } from "node:crypto";
import { getCredential } from "@/lib/credentials";

/**
 * Creating a whole Counsel instance for somebody else.
 *
 * The same four calls the CLI script makes, moved here so the page and the
 * script cannot drift. That mattered immediately: the manual web route has
 * four traps in it and the reason the API has none of them is a single detail
 * (environment variables can be set in the call that creates the project), and
 * a detail like that survives exactly as long as it lives in one place.
 *
 * ## Everything here runs on the operator's accounts
 *
 * Each instance is a real Vercel project and a real Neon database billed to
 * whoever's tokens these are. That is fine for handing copies to a few people
 * and is not a distribution model: Vercel's Hobby plan is non-commercial and
 * Neon's free tier caps projects. The honest version of "anyone can use this"
 * is them deploying on their own account, which needs a public repository.
 */

const VERCEL_API = "https://api.vercel.com";
const NEON_API = "https://console.neon.tech/api/v2";

export const DEFAULT_REPO = "dancuris/job-search-tracker";
/** The vetted branch. `main` is where things land first. */
export const DEFAULT_REF = "production";

export type ProvisionRequest = {
  name: string;
  recipient?: string;
  repo?: string;
  ref?: string;
  /** A setup token closes the race where the first visitor owns the instance. */
  withToken?: boolean;
};

export type ProvisionResult = {
  name: string;
  url: string;
  setupToken: string | null;
  vercelId: string;
  deploymentId: string;
  /** The commit it was pinned to. */
  sha: string;
};

/** Vercel project names become subdomains, so the rules are theirs. */
export function nameProblem(name: string): string | null {
  if (!name.trim()) return "Give the instance a name.";
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(name)) {
    return "Use lowercase letters, numbers and hyphens only, starting with a letter or number.";
  }
  return null;
}

/**
 * Checked, always. A create that reads as a success when it failed leaves
 * somebody holding a URL that never comes up, which is precisely the failure
 * the manual route already produces.
 */
async function post(url: string, token: string, body: unknown, what: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${what} failed (${res.status}). ${firstMessage(text)}`);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`${what} returned something that was not JSON.`);
  }
}

/** The provider's own error sentence, rather than a wall of JSON on the page. */
function firstMessage(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: { message?: string }; message?: string };
    return body.error?.message ?? body.message ?? text.slice(0, 200);
  } catch {
    return text.slice(0, 200);
  }
}

/**
 * This deployment's own public address, for telling provisioned instances where
 * to report. `REQUEST_UPSTREAM_URL` overrides it, because the Vercel-assigned
 * domain is rarely the one somebody actually uses.
 */
export function ownUrl(): string | null {
  const explicit = process.env.REQUEST_UPSTREAM_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return vercel ? `https://${vercel}` : null;
}

export type PlatformKeys = { vercel: string; neon: string; teamId: string | null };

/** Null when the tokens are not configured, so the page can say which is missing. */
export async function platformKeys(): Promise<{ keys: PlatformKeys | null; missing: string[] }> {
  const [vercel, neon] = await Promise.all([getCredential("vercel"), getCredential("neon")]);
  const missing: string[] = [];
  if (!vercel) missing.push("Vercel token");
  if (!neon) missing.push("Neon API key");
  if (!vercel || !neon) return { keys: null, missing };
  return { keys: { vercel, neon, teamId: process.env.VERCEL_TEAM_ID?.trim() || null }, missing: [] };
}

/**
 * Creates the database, the project and the deployment.
 *
 * Deliberately returns as soon as the build is *queued* rather than waiting for
 * it to finish. The three creates take a couple of seconds between them; the
 * build takes minutes, and a server action that sat there for minutes would
 * time out on Vercel and leave the caller unable to tell a slow build from a
 * failed one. The deployment id comes back so the page can poll.
 */
export async function provisionInstance(request: ProvisionRequest, keys: PlatformKeys): Promise<ProvisionResult> {
  const problem = nameProblem(request.name);
  if (problem) throw new Error(problem);

  const repo = request.repo ?? DEFAULT_REPO;
  const ref = request.ref ?? DEFAULT_REF;
  const [org, repoName] = repo.split("/");
  const teamQuery = keys.teamId ? `?teamId=${encodeURIComponent(keys.teamId)}` : "";

  // 1. The database first: its connection string is an input to everything else.
  const neon = await post(`${NEON_API}/projects`, keys.neon, { project: { name: request.name } }, "Creating the database");
  const uris = (neon.connection_uris ?? []) as { connection_uri?: string }[];
  const databaseUrl = uris[0]?.connection_uri;
  if (!databaseUrl) throw new Error("The database was created but returned no connection string.");

  const sessionSecret = randomBytes(32).toString("base64");
  const setupToken = request.withToken === false ? null : randomBytes(18).toString("base64url");

  const target = ["production", "preview", "development"];
  const env = (key: string, value: string) => ({ key, value, target, type: "encrypted" });

  // ALLOWED_EMAIL is deliberately absent: setting it locks the instance to a
  // Google account and makes it permanently unclaimable.
  const environmentVariables = [
    env("DATABASE_URL", databaseUrl),
    env("SESSION_SECRET", sessionSecret),
    ...(setupToken ? [env("SETUP_TOKEN", setupToken)] : []),
    // Where this instance sends feature requests, and what it calls itself when
    // it does. Set here so the loop is wired with no configuration by anyone:
    // an instance nobody provisioned has neither, and correctly offers no way
    // to ask anybody for anything.
    ...(ownUrl() ? [env("UPSTREAM_URL", ownUrl() as string)] : []),
    env("COUNSEL_INSTANCE_NAME", request.name),
  ];

  // 2. The project, with the variables already on it. This is the whole reason
  //    the API route has none of the web route's traps.
  //
  //    Deliberately NO `gitRepository`. A git-linked project redeploys on every
  //    push to its production branch, so one push would rebuild every instance
  //    ever handed out: thirty of the hundred daily deployments gone without a
  //    decision, one bad commit breaking everybody at once, and the app's own
  //    promise that "an instance does not update by itself" made false. Each
  //    instance is pinned to a commit and moves only when told.
  const project = await post(
    `${VERCEL_API}/v11/projects${teamQuery}`,
    keys.vercel,
    { name: request.name, framework: "nextjs", environmentVariables },
    "Creating the project"
  );

  // 3. The deployment names the commit, since the project has no git link to
  //    infer one from.
  const deployment = await deployCommit(String(project.id), request.name, org, repoName, ref, keys);

  return {
    name: request.name,
    url: `https://${request.name}.vercel.app`,
    setupToken,
    vercelId: String(project.id ?? ""),
    deploymentId: deployment.id,
    sha: deployment.sha,
  };
}

/**
 * Deploys one commit to one project.
 *
 * Shared by provisioning and updating, because "bring this instance up on this
 * commit" is the same operation whether the instance is one second old or three
 * months old.
 */
export async function deployCommit(
  projectId: string,
  name: string,
  org: string,
  repoName: string,
  ref: string,
  keys: PlatformKeys
): Promise<{ id: string; sha: string }> {
  const teamQuery = keys.teamId ? `?teamId=${encodeURIComponent(keys.teamId)}` : "";
  const deployment = await post(
    `${VERCEL_API}/v13/deployments${teamQuery}`,
    keys.vercel,
    {
      name,
      project: projectId,
      target: "production",
      gitSource: { type: "github", org, repo: repoName, ref },
    },
    "Starting the deployment"
  );
  return { id: String(deployment.id ?? ""), sha: ref };
}

/**
 * Brings an existing instance up on a new commit.
 *
 * The commit is whatever the operator's own deployment is running, which is the
 * only version that has actually been used rather than merely built.
 */
export async function updateInstance(
  instance: { name: string; vercelId: string | null },
  sha: string,
  keys: PlatformKeys,
  repo: string = DEFAULT_REPO
): Promise<{ id: string; sha: string }> {
  if (!instance.vercelId) throw new Error(`${instance.name} has no Vercel project id recorded.`);
  const [org, repoName] = repo.split("/");
  return deployCommit(instance.vercelId, instance.name, org, repoName, sha, keys);
}

export type BuildState = "building" | "ready" | "failed" | "unknown";

/** Where a build has got to. Never throws: this only drives a status line. */
export async function buildState(deploymentId: string, keys: PlatformKeys): Promise<BuildState> {
  try {
    const teamQuery = keys.teamId ? `?teamId=${encodeURIComponent(keys.teamId)}` : "";
    const res = await fetch(`${VERCEL_API}/v13/deployments/${deploymentId}${teamQuery}`, {
      headers: { authorization: `Bearer ${keys.vercel}` },
    });
    if (!res.ok) return "unknown";
    const body = (await res.json()) as { readyState?: string };
    switch (body.readyState) {
      case "READY":
        return "ready";
      case "ERROR":
      case "CANCELED":
        return "failed";
      case "QUEUED":
      case "INITIALIZING":
      case "BUILDING":
        return "building";
      default:
        return "unknown";
    }
  } catch {
    return "unknown";
  }
}
