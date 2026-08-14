/**
 * Reading one message out of a forwarded chain.
 *
 * Dan forwards ecuris threads to Gmail as he goes, and each forward carries the
 * whole prior conversation quoted beneath it. One AT&T thread arrived as five
 * messages of 976, 1851, 2705, 2904 and 4204 characters - the last containing
 * all of the others - so the conversation showed the same sentences up to five
 * times and the newest reply was buried at the top of a wall of history.
 *
 * Quote depth is what distinguishes them. In the raw body the message being
 * forwarded sits at one level of `>`, the message it answers at two, and so on:
 *
 *     > Great thanks! Talk to you then.              <- this forward's content
 *     >> Good morning Dan, that still works for me   <- Jennifer, already stored
 *     >>> Hi Jennifer, I am just confirming...       <- Dan, already stored
 *
 * So the new content of any message is whatever sits at the **shallowest**
 * depth, and everything below it is history that exists as its own row. A
 * message that was never forwarded has depth zero throughout and is returned
 * unchanged.
 */
const SEPARATOR = /^\s*-{3,}\s*(?:Forwarded|Original)\s+Message\s*-{3,}\s*$/i;
const HEADER = /^\s*(?:From|Date|To|Subject|Sent|Cc):/i;

/** How many `>` a line is prefixed with, ignoring the spaces between them. */
export function quoteDepth(line: string): number {
  const m = line.match(/^[\s>]*/);
  return m ? (m[0].match(/>/g) ?? []).length : 0;
}

/**
 * The part of a message that is genuinely new, with quote markers removed.
 *
 * Returns the original text when there is nothing to strip, so a plain message
 * is never damaged by running it through this.
 */
export function newestPart(body: string | null | undefined): string {
  const raw = (body ?? "").replace(/\r\n/g, "\n");
  if (!raw.trim()) return "";

  const lines = raw.split("\n");

  // Skip the forwarding banner and the header block that follows it, which
  // describe the message rather than being part of it.
  let start = 0;
  const sep = lines.findIndex((l) => SEPARATOR.test(l));
  if (sep !== -1) {
    start = sep + 1;
    while (start < lines.length && (HEADER.test(lines[start]) || !lines[start].trim())) start += 1;
  }

  const rest = lines.slice(start);
  const content = rest.filter((l) => l.trim());
  if (content.length === 0) return raw.trim();

  const minDepth = Math.min(...content.map(quoteDepth));

  // Nothing is quoted, so there is no chain to cut away.
  if (minDepth === 0 && sep === -1) return raw.trim();

  const kept: string[] = [];
  for (const line of rest) {
    if (!line.trim()) {
      // Keep paragraph breaks inside the part being kept, drop leading ones.
      if (kept.length) kept.push("");
      continue;
    }
    if (quoteDepth(line) !== minDepth) break; // the chain starts here
    kept.push(line.replace(/^[\s>]*/, ""));
  }

  // The attribution line that introduces the quote below belongs to the part
  // being cut, not the part being kept: "On Monday, 10 August, Jennifer wrote:"
  // is only there to label history that is already its own row.
  const out = kept
    .join("\n")
    .replace(/\n*^\s*On\b[^\n]{0,160}(?:wrote:|<[^>\n]+@[^>\n]+>[^\n]*)\s*$/im, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return out || raw.trim();
}

/**
 * Groups messages into threads, newest activity first.
 *
 * `threadId` comes from Gmail, which has already done the hard part - all five
 * AT&T forwards share one. Anything without a thread id stands alone rather
 * than being lumped together, since a null is not evidence of kinship.
 */
export function groupByThread<T extends { id: string; threadId: string | null; receivedAt: Date }>(
  messages: T[]
): { threadId: string; messages: T[]; latest: Date }[] {
  const byThread = new Map<string, T[]>();
  for (const m of messages) {
    const key = m.threadId ?? `solo:${m.id}`;
    byThread.set(key, [...(byThread.get(key) ?? []), m]);
  }

  return [...byThread.entries()]
    .map(([threadId, list]) => {
      const sorted = [...list].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
      return { threadId, messages: sorted, latest: sorted[0].receivedAt };
    })
    .sort((a, b) => b.latest.getTime() - a.latest.getTime());
}
