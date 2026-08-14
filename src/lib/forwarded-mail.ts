/**
 * Recovers the real sender from a forwarded message.
 *
 * Dan started the search on his personal address and is moving to the
 * job-search one, so the back catalogue arrives as forwards from himself. That
 * made him the single largest "sender" in the mailbox at 15 messages, and it
 * broke two things quietly: the Inbox credited him for a recruiter's email, and
 * the contact pages, which pair `fromEmail` against `Contact.email`, could
 * never match. A recruiter's outreach sat in the mailbox as a forward while
 * that same person existed as a contact; the two had no way to meet.
 *
 * Proton Mail writes two shapes, and both appear in the real data:
 *
 *   ------- Forwarded Message -------
 *   From: Tom Alder <Tom.Alder@example.com>
 *
 *   -------- Original Message --------
 *   On Monday, 08/03/26 at 20:31 Tom Alder <Tom.Alder@example.com> wrote:
 *
 * Only the first sender is taken. A long reply chain contains many addresses
 * and the topmost is the one who wrote the message being forwarded.
 */
export type ForwardedSender = { name: string | null; email: string };

const HEADER_FROM = /^\s*From:\s*(?:"?([^"<\n]*?)"?\s*)?<?([^\s<>@]+@[^\s<>]+?)>?\s*$/im;
const INLINE_WROTE = /^\s*On\s.{0,80}?(?:\s|^)(?:"?([^"<\n]*?)"?\s*)?<?([^\s<>@]+@[^\s<>]+?)>?\s+wrote:/im;

export function forwardedSender(body: string | null | undefined): ForwardedSender | null {
  if (!body) return null;

  // Anchor on the separator so a "From:" quoted deeper down cannot win.
  const marker = body.search(/-{3,}\s*(?:Forwarded|Original)\s+Message\s*-{3,}/i);
  const region = marker === -1 ? body.slice(0, 1200) : body.slice(marker, marker + 1200);

  const match = HEADER_FROM.exec(region) ?? INLINE_WROTE.exec(region);
  if (!match) return null;

  const email = match[2]?.trim().toLowerCase();
  if (!email || !email.includes("@")) return null;

  // The inline shape puts the date in front of the name on the same line
  // ("On Monday, 08/03/26 at 20:31 Tom Alder <...> wrote:"), so anything up
  // to a time or a date is debris rather than part of who sent it.
  const name = (match[1] ?? "")
    .replace(/^.*?\d{1,2}:\d{2}\s*(?:[AP]M)?\s*/i, "")
    .replace(/^.*?\d{1,2}\/\d{1,2}\/\d{2,4}\s*(?:at\s*)?/i, "")
    .replace(/^(?:on\s+)?(?:mon|tues?|wed(?:nes)?|thur?s?|fri|sat(?:ur)?|sun)(?:day)?,?\s*/i, "")
    .trim()
    .replace(/\s+/g, " ");

  return { name: name || null, email };
}

/**
 * "SURNAME, FORENAME" in capitals is how a corporate directory writes a name
 * and not how anyone is addressed. Only shouted, comma-separated names are
 * rewritten, because "Alder, Tom" and "Tom Alder" both have to survive.
 */
export function tidySenderName(raw: string | null): string | null {
  if (!raw) return null;
  const name = raw.trim();
  if (!name) return null;

  const parts = name.split(",").map((p) => p.trim());
  const reordered = parts.length === 2 && parts[0] && parts[1] ? `${parts[1]} ${parts[0]}` : name;

  if (reordered !== reordered.toUpperCase()) return reordered;
  return reordered
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\bMc([a-z])/g, (_, c) => `Mc${c.toUpperCase()}`);
}
