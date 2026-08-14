import { NextResponse } from "next/server";
import { getReleases } from "@/lib/release";
import { storyFor } from "@/data/stories";

export const dynamic = "force-dynamic";

/**
 * What version this deployment is, for other deployments to compare against.
 *
 * Counsel runs one instance per person, which is what makes the data isolation
 * real, and the cost of that is there is no central server to push an update
 * from. So instead each instance can ask a known-good one what the newest
 * release is, and tell its owner.
 *
 * **Public, and deliberately so.** It exposes a commit sha, a date and a
 * release title, which is the same information the repository carries. It never
 * touches the database and never reads anything about the person using it - it
 * is a statement about the code, not about them.
 */
export async function GET() {
  const [newest] = getReleases(1);
  if (!newest) return NextResponse.json({ error: "No changelog." }, { status: 503 });

  const story = storyFor(newest.subject);
  return NextResponse.json(
    {
      sha: newest.sha,
      shortSha: newest.shortSha,
      date: newest.date,
      subject: newest.subject,
      title: story?.title ?? newest.subject,
      critical: story?.critical === true,
    },
    // Cheap to serve and fine to be a few minutes stale; instances poll it.
    { headers: { "Cache-Control": "public, max-age=300" } }
  );
}
