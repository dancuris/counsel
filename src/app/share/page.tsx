import { redirect } from "next/navigation";
import { ShareIntake } from "@/components/ShareIntake";
import { PAGE_TITLE_COMPACT } from "@/lib/type";

/**
 * One landing place for a job link arriving from outside the app.
 *
 * Three different front doors need the same thing to happen, and only one of
 * them is a web standard:
 *
 * - **The PWA share target** (`share_target` in the manifest), which puts
 *   Counsel in the OS share sheet on Android and on desktop Chrome where it is
 *   supported. **Not iOS**: Safari does not implement it, so the app can never
 *   appear in an iPhone share sheet however the manifest is written.
 * - **An iOS Shortcut**, which is the answer on the phone precisely because
 *   the standard is unavailable there. A share-sheet shortcut that opens
 *   `/share?url=` reaches this same page.
 * - **A bookmarklet**, which is the answer on desktop, where LinkedIn offers
 *   no share-by-email at all.
 *
 * All three end here, so the intake is written once.
 *
 * A GET rather than a POST target on purpose: it is an ordinary navigation, so
 * the session cookie comes along and the auth gate behaves normally. A POST
 * share target would arrive without one and bounce to the login page, losing
 * the link.
 */
export const dynamic = "force-dynamic";

/**
 * Share sheets are inconsistent about which field holds the link. Android
 * often puts it in `text` alongside the title, LinkedIn sometimes sends the
 * whole thing as one string, and `url` is frequently empty. Take the first
 * genuine URL from whichever field has one.
 */
function firstUrl(...candidates: (string | undefined)[]): string | null {
  for (const c of candidates) {
    if (!c) continue;
    const match = c.match(/https?:\/\/[^\s<>"']+/);
    if (match) return match[0];
  }
  return null;
}

export default async function SharePage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string; text?: string; title?: string }>;
}) {
  const { url, text, title } = await searchParams;
  const shared = firstUrl(url, text, title);

  // Nothing usable. Send them to the paste box rather than showing an error
  // about a link they cannot see.
  if (!shared) redirect("/");

  return (
    <div className="mx-auto max-w-xl py-10">
      <h1 className={PAGE_TITLE_COMPACT}>Tracking this role</h1>
      <p className="mt-1.5 text-[13px] text-[var(--tx-3)]">Shared from somewhere else. Nothing to type.</p>
      <div className="panel mt-5 p-5">
        <ShareIntake url={shared} />
      </div>
    </div>
  );
}
