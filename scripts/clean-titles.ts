/**
 * Strips markup and HTML entities out of role titles, company names and salary
 * strings that were stored before those fields were cleaned on the way in.
 *
 * The write paths now run everything through cleanInlineText, so this is a
 * one-off for rows that predate it - the ones showing something like
 * `Executive Director, Payments &amp; Onboarding` on the application page.
 *
 * Dry by default. It prints every change it would make, and only touches rows
 * where the cleaned value actually differs.
 *
 * Run: npx tsx --env-file=.env.local scripts/clean-titles.ts [--apply]
 */
import { prisma } from "../src/lib/prisma";
import { cleanInlineText } from "../src/lib/text";

const APPLY = process.argv.includes("--apply");

async function main() {
  const applications = await prisma.jobApplication.findMany({
    include: { company: true },
    orderBy: { updatedAt: "desc" },
  });

  let appChanges = 0;
  for (const app of applications) {
    const roleTitle = cleanInlineText(app.roleTitle);
    const salaryRange = cleanInlineText(app.salaryRange) || null;

    const data: { roleTitle?: string; salaryRange?: string | null } = {};
    // An empty result would mean the whole field was markup, which is not a
    // cleanup, it is data loss. Leave those to be looked at by hand.
    if (roleTitle && roleTitle !== app.roleTitle) data.roleTitle = roleTitle;
    if (salaryRange !== app.salaryRange) data.salaryRange = salaryRange;
    if (Object.keys(data).length === 0) continue;

    appChanges += 1;
    console.log(`${app.company.name}`);
    if (data.roleTitle) console.log(`    role   : ${JSON.stringify(app.roleTitle)}\n          -> ${JSON.stringify(data.roleTitle)}`);
    if (data.salaryRange !== undefined) console.log(`    salary : ${JSON.stringify(app.salaryRange)}\n          -> ${JSON.stringify(data.salaryRange)}`);
    if (APPLY) await prisma.jobApplication.update({ where: { id: app.id }, data });
  }

  const companies = await prisma.company.findMany({ orderBy: { name: "asc" } });
  let companyChanges = 0;
  for (const company of companies) {
    const name = cleanInlineText(company.name);
    if (!name || name === company.name) continue;
    // Company.name is unique, so cleaning one into an existing name would
    // throw. Report the collision instead: merging companies is a decision,
    // not a cleanup.
    const clash = companies.find((c) => c.id !== company.id && c.name === name);
    if (clash) {
      console.log(`SKIP ${JSON.stringify(company.name)} -> ${JSON.stringify(name)} (a company with that name already exists)`);
      continue;
    }
    companyChanges += 1;
    console.log(`company: ${JSON.stringify(company.name)}\n      -> ${JSON.stringify(name)}`);
    if (APPLY) await prisma.company.update({ where: { id: company.id }, data: { name } });
  }

  console.log("\n" + "=".repeat(52));
  console.log(`applications to fix: ${appChanges}`);
  console.log(`companies to fix   : ${companyChanges}`);
  console.log(APPLY ? "applied" : "dry run - re-run with --apply to write");
  process.exit(0);
}

main();
