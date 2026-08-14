import { prisma } from "../src/lib/prisma";

/**
 * Makes the LEGO entry match its neighbours in Earlier Experience.
 *
 * That section is a compressed tail on a strict one-page resume: title,
 * employer, dates, nothing else. The LEGO line was added later carrying a
 * description clause and a full stop, so three entries read one way and the
 * fourth read another, in every generated resume.
 *
 * The detail itself is fine - "15-person US/Denmark LEGO team" is on the
 * verified-metrics list - it just does not belong dangling off a list whose
 * whole job is to be brief. If it is worth stating, it belongs in the body.
 *
 * Earlier Experience is copied verbatim out of the chosen `ResumeVariant`, so
 * all four variants need it, and `masterResume` is the reference copy. Dry by
 * default; re-run with --write.
 */
const FROM =
  "- Web Program Manager, LEGO Systems (2001 to 2003), leading a 15-person US and Denmark team across lego.com and consumer contact-center systems.";
const TO = "- Web Program Manager, LEGO Systems (2001 to 2003)";

async function main() {
  const write = process.argv.includes("--write");
  let touched = 0;

  const variants = await prisma.resumeVariant.findMany({ select: { id: true, name: true, content: true } });
  for (const v of variants) {
    if (!v.content.includes(FROM)) {
      console.log(`  ${v.name.padEnd(28)} already correct`);
      continue;
    }
    touched++;
    console.log(`  ${v.name.padEnd(28)} fixing`);
    if (write) {
      await prisma.resumeVariant.update({ where: { id: v.id }, data: { content: v.content.replace(FROM, TO) } });
    }
  }

  const profile = await prisma.profile.findFirst({ select: { id: true, masterResume: true } });
  if (profile?.masterResume?.includes(FROM)) {
    touched++;
    console.log(`  ${"masterResume".padEnd(28)} fixing`);
    if (write) {
      await prisma.profile.update({
        where: { id: profile.id },
        data: { masterResume: profile.masterResume.replace(FROM, TO) },
      });
    }
  }

  console.log(`\n  ${touched} source${touched === 1 ? "" : "s"} to change.`);
  console.log(write ? "  Written." : "  Dry run. Re-run with --write to apply.");
}

main().finally(() => prisma.$disconnect());
