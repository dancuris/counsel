import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import { getReleases, releaseCount, RECENT_RELEASES, getLiveVersion, changelogGeneratedAt, commitUrl, getDeployments } from "@/lib/release";
import { storyFor, storiesFor } from "@/data/stories";
import { PAGE_READING, PAGE_TITLE, PAGE_LEDE, SECTION_GAP } from "@/lib/type";

export const dynamic = "force-dynamic";

const STATE_NOTE: Record<string, { tone: string; text: string }> = {
  behind: {
    tone: "amber",
    text: "Production is running an older commit than the newest in this log. The deploy did not move - see the fast-forward note in CLAUDE.md.",
  },
  unlogged: {
    tone: "neutral",
    // Not a fault. The changelog is frozen before the commit exists, so the
    // commit being shipped is never in its own log. Saying "run npm run
    // changelog" was advice that could not be followed.
    text: "This build is newer than the frozen log, which is normal: the log is written just before the commit it ships with. It will appear in the next deploy.",
  },
}

export default async function ReleasesPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  // Behind the URL, and the data is gated too rather than only the markup:
  // slicing in the component would still have serialized every entry.
  const showAll = (await searchParams).all === "1";
  const total = releaseCount();
  const releases = getReleases(showAll ? undefined : RECENT_RELEASES);
  const deployments = await getDeployments();
  const live = getLiveVersion();
  const note = live.state ? STATE_NOTE[live.state] : null;

  return (
    <div className={PAGE_READING}>
      <h1 className={PAGE_TITLE}>Releases</h1>
      <p className={PAGE_LEDE}>
        Everything that has shipped, newest first, with the reasoning from each commit.
      </p>

      <section className={`${SECTION_GAP} panel p-4 shadow-sm`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--tx)]">Currently running</h2>
          <span className="font-mono text-xs text-[var(--tx-3)]">
            {live.shortSha ?? "local"}
            {live.branch ? ` · ${live.branch}` : ""}
            {live.environment ? ` · ${live.environment}` : ""}
          </span>
        </div>
        {/* When the running build is newer than the frozen log it is not in the
            list below, so it describes itself from what Vercel supplies. */}
        {live.subject && <p className="mt-1 text-[13px] text-[var(--tx-2)]">{live.subject}</p>}
        {note && (
          <p className={`mt-2 rounded-md px-3 py-2 text-xs ${note.tone}`}>
            {live.state === "behind" ? `${live.behindBy} commit${live.behindBy === 1 ? "" : "s"} behind. ` : ""}
            {note.text}
          </p>
        )}
        <p className="mt-2 text-xs text-[var(--tx-3)]">
          Log generated {formatDateTime(new Date(changelogGeneratedAt()))} · showing {releases.length} of {total}{" "}
          commits · {deployments.size} with a recorded deploy
        </p>
        <p className="mt-1 text-xs text-[var(--tx-3)]">
          Deploy times are stamped on the first request a build serves, so they start from the day this
          shipped. Anything older shows its commit date only.
        </p>
      </section>

      <ol className="mt-5 space-y-3">
        {releases.map((release, i) => (
          <li
            key={release.sha}
            className={`rounded-xl border bg-[var(--surface)] p-4 shadow-sm ${
              release.sha === live.sha ? "border-[var(--amber)]" : "border-line"
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium text-[var(--tx)]">
                {/* One story lends the release its title. Several means no
                    single title is honest, so the subject stands as the
                    heading and each capability is titled below. */}
                {storiesFor(release.subject).length === 1
                  ? storyFor(release.subject)?.title
                  : release.subject}
              </h3>
              <a
                href={commitUrl(release.sha)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-accent hover:underline"
              >
                {release.shortSha}
              </a>
            </div>
            <p className="mt-0.5 text-xs text-[var(--tx-3)]">
              Committed {formatDateTime(new Date(release.date))} · {release.author}
              {i === 0 ? " · newest" : ""}
              {release.sha === live.sha ? " · running now" : ""}
            </p>

            {/*
              The story, where one was written. `git log` says what changed in
              the code; this says what became possible, and the second is the
              only one worth reading back. The commit subject stays underneath
              rather than being replaced, so the two can always be lined up.
            */}
            {(() => {
              // Every story under this subject, not just the first. A release
              // that shipped four capabilities used to describe one and hide
              // three, which is the same fault as a changelog of commit
              // subjects, one level up.
              const stories = storiesFor(release.subject);
              if (stories.length === 0) return null;
              return (
                <div className="mt-3 space-y-3 border-l-2 border-[var(--line-2)] pl-3">
                  {stories.map((s) => (
                    <div key={s.title}>
                      <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--tx-3)]">{s.area}</p>
                      <p className="mt-1 text-[13px] font-medium leading-relaxed text-[var(--tx)]">{s.title}</p>
                      <p className="mt-1 text-[13px] leading-relaxed text-[var(--tx-2)]">{s.story}</p>
                      <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--tx-3)]">
                        <span className="font-medium">Before:</span> {s.problem}
                      </p>
                    </div>
                  ))}
                  <p className="font-mono text-[11px] text-[var(--tx-3)]">{release.subject}</p>
                </div>
              );
            })()}
            {/* Kept visually separate from the commit date, and worded
                differently, because they are different facts: one is when it was
                written, this is when it reached an environment. */}
            {(deployments.get(release.sha) ?? []).length > 0 && (
              <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                {(deployments.get(release.sha) ?? []).map((d) => (
                  <li key={`${d.environment}-${d.deployedAt.toISOString()}`} className="text-xs">
                    <span
                      className={`rounded-full px-1.5 py-0.5 font-medium ${
                        d.environment === "production"
                          ? "bg-emerald-50 text-emerald-800"
                          : "bg-[var(--surface-2)] text-[var(--tx-2)]"
                      }`}
                    >
                      {d.environment}
                    </span>{" "}
                    <span className="text-[var(--tx-3)]">live {formatDateTime(d.deployedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
            {/* The body is the reasoning, and in this repo it is long - most
                entries run several paragraphs. Expanded by default the page was
                a wall of prose you had to scroll past to find a version; folded
                away it is a list you can scan, with the why one click down. */}
            {release.body && (
              <details className="group/body mt-2">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-[var(--tx-3)] hover:text-accent">
                  <svg
                    className="h-2.5 w-2.5 text-[var(--tx-3)] transition-transform group-open/body:rotate-90"
                    viewBox="0 0 8 8"
                    fill="currentColor"
                  >
                    <path d="M1 0l6 4-6 4V0z" />
                  </svg>
                  Why
                </summary>
                <div className="mt-2 space-y-2 border-t border-line pt-2 text-[13px] leading-relaxed text-[var(--tx-2)]">
                  {release.body.split(/\n\s*\n/).map((para, j) => (
                    <p key={j} className="whitespace-pre-wrap">
                      {para}
                    </p>
                  ))}
                </div>
              </details>
            )}
          </li>
        ))}
      </ol>

      {!showAll && total > releases.length && (
        <Link
          href="/releases?all=1"
          className="mt-5 block border-t border-line pt-4 text-[13px] text-[var(--tx-3)] transition-colors hover:text-[var(--tx)]"
        >
          Show all {total} releases
        </Link>
      )}
    </div>
  );
}
