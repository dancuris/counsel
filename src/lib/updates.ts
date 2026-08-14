import { getReleases } from "@/lib/release";

/**
 * Whether a newer version of Counsel exists, and whether it matters.
 *
 * One instance per person is what makes the data isolation real, and its price
 * is that nobody can push a fix to somebody else's deployment. The honest
 * answer is not to pretend otherwise: an instance asks a known-good one what
 * the newest release is and tells its owner, who decides.
 *
 * Three properties this has to keep.
 *
 * **It must never block a page.** The check is a network call to another
 * deployment, which may be slow, down, or absent entirely. Short timeout,
 * cached, and every failure resolves to "no update known" rather than an error.
 * Nobody's dashboard should be worse because an upstream instance is asleep.
 *
 * **It must not become noise.** A "new features available" note that appears
 * every few days trains people to ignore the banner that says a security fix
 * landed. Only a release marked `critical` in the story data raises its voice.
 *
 * **It must be optional.** `UPSTREAM_VERSION_URL` unset means no check at all,
 * which is the right default for an instance that does not want to phone
 * anywhere. Setting it is a choice to be told.
 */

export type UpdateState =
  | { status: "unknown" }
  | { status: "current" }
  | { status: "behind"; title: string; date: string; critical: boolean };

const TTL_MS = 30 * 60 * 1000;
let cached: { at: number; value: UpdateState } | null = null;

export async function checkForUpdate(): Promise<UpdateState> {
  const upstream = process.env.UPSTREAM_VERSION_URL?.trim();
  if (!upstream) return { status: "unknown" };

  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

  const value = await fetchUpstream(upstream);
  cached = { at: Date.now(), value };
  return value;
}

async function fetchUpstream(url: string): Promise<UpdateState> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { status: "unknown" };

    const latest = (await res.json()) as { sha?: string; date?: string; title?: string; critical?: boolean };
    if (!latest?.sha || !latest?.date) return { status: "unknown" };

    const [mine] = getReleases(1);
    if (!mine) return { status: "unknown" };
    if (mine.sha === latest.sha) return { status: "current" };

    // Compare dates rather than shas: a sha tells you two builds differ and not
    // which is newer, and an instance running something *ahead* of upstream
    // (the person who ships) must not be told to update to its own past.
    if (new Date(latest.date).getTime() <= new Date(mine.date).getTime()) return { status: "current" };

    return {
      status: "behind",
      title: latest.title ?? "A newer version is available",
      date: latest.date,
      critical: latest.critical === true,
    };
  } catch {
    // Unreachable, slow, or not returning JSON. Not knowing is fine.
    return { status: "unknown" };
  }
}
