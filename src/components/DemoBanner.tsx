import { IS_DEMO } from "@/lib/demo";

/**
 * Says this is a demo, on every page.
 *
 * Not decoration. Somebody looking at a pipeline of recruiters and salary
 * ranges will assume it is real unless told otherwise, and the second thing
 * they will assume is that the mail features are live. Both are worth denying
 * up front rather than after they ask.
 */
export function DemoBanner() {
  if (!IS_DEMO) return null;

  return (
    <div className="border-b border-line bg-[var(--surface-2)] px-5 py-2 text-center text-[12.5px] text-[var(--tx-2)]">
      <span className="font-medium text-[var(--tx)]">Demo.</span> Everything here is invented sample data. Sending mail,
      Google Drive and mailbox sync are switched off.
    </div>
  );
}
