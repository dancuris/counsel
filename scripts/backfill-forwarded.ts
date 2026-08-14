import { prisma } from "../src/lib/prisma";
import { forwardedSender, tidySenderName } from "../src/lib/forwarded-mail";

/**
 * Fills `forwardedFromEmail` on mail that arrived before the parser existed.
 *
 * Dry by default, like every other script here: it reports what it would write
 * and changes nothing unless run with --write.
 */
async function main() {
  const write = process.argv.includes("--write");
  const messages = await prisma.mailMessage.findMany({
    where: { forwardedFromEmail: null },
    select: { id: true, body: true, snippet: true, fromEmail: true, subject: true },
  });

  let found = 0;
  for (const m of messages) {
    const f = forwardedSender(m.body ?? m.snippet);
    if (!f) continue;
    // A forward of Dan's own reply names Dan. Nothing is recovered there.
    if (f.email === (m.fromEmail ?? "").trim().toLowerCase()) continue;

    found++;
    const name = tidySenderName(f.name);
    console.log(`  ${(name ?? "(no name)").padEnd(26)} <${f.email}>  ${(m.subject ?? "").slice(0, 44)}`);
    if (write) {
      await prisma.mailMessage.update({
        where: { id: m.id },
        data: { forwardedFromEmail: f.email, forwardedFromName: name },
      });
    }
  }

  console.log(`\n  ${found} of ${messages.length} messages carry a forwarded sender.`);
  console.log(write ? "  Written." : "  Dry run. Re-run with --write to apply.");
}

main().finally(() => prisma.$disconnect());
