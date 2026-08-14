import Link from "next/link";
import { getLiveVersion, getReleases } from "@/lib/release";

/**
 * A quiet line at the foot of every page: what is running, and a way into the
 * history.
 *
 * Deliberately not a sixth nav item. The nav is a segmented control used mostly
 * from a phone, and this is reference rather than somewhere you go. It does
 * raise its voice in one case - when the deployed commit is behind the log -
 * because that is the fast-forward-merge failure where production sits stale
 * and nothing else on the screen looks wrong.
 */
export function VersionFooter() {
  const live = getLiveVersion();
  const newest = getReleases()[0];
  const stale = live.state === "behind";

  return (
    <footer className="mx-auto w-full max-w-[1240px] px-4 pb-6 text-[11.5px] text-[var(--tx-3)] sm:px-7">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-3">
        <Link href="/releases" className="hover:text-[var(--tx)] hover:underline">
          {live.shortSha ? `Version ${live.shortSha}` : "Version (local)"}
        </Link>
        {newest && (
          <span className="min-w-0 truncate text-[var(--tx-3)]" title={newest.subject}>
            · {newest.subject}
          </span>
        )}
        {stale && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
            {live.behindBy} behind
          </span>
        )}
      </div>
    </footer>
  );
}
