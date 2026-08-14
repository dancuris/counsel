/**
 * Reviews documents that already exist, in bulk.
 *
 * "Review this draft" sits on each role and is the right place for it when you
 * are working that role. It is the wrong shape for the back catalogue: there
 * were 69 roles with generated documents and no way to ask which of them have
 * a problem without opening 69 pages.
 *
 * It deliberately defaults to the roles where a finding can still change
 * something. Of those 69, only 7 had not been applied to yet. Reviewing the
 * rest is mostly spending money to be told about a resume that already went
 * out, so the applied and closed ones are opt-in:
 *
 *   npx tsx --env-file=.env.local scripts/review-drafts.ts            # not yet applied
 *   npx tsx --env-file=.env.local scripts/review-drafts.ts --applied  # + in flight
 *   npx tsx --env-file=.env.local scripts/review-drafts.ts --all      # + passed and closed
 *
 * Applied roles are still worth a pass occasionally, not to change the
 * document but because a sharp reader's objections to the resume are the
 * questions an interviewer asks about it.
 *
 * It drives the same HTTP route the button does rather than importing the
 * logic, so there is one implementation of the review and this cannot drift
 * away from what the app actually does. That means a dev server has to be
 * running, and a session token in REVIEW_SESSION.
 */
import { prisma } from "../src/lib/prisma";

const BASE = process.env.REVIEW_BASE ?? "http://localhost:3000";
const SESSION = process.env.REVIEW_SESSION ?? "";

const IN_FLIGHT = new Set(["APPLIED", "INTERVIEWING", "OFFER"]);
const FINISHED = new Set(["PASSED", "CLOSED_REJECTED"]);

type Finding = { severity: string; kind: string; what: string; fix: string };
type Review = { verdict: string; summary: string; findings: Finding[]; reviewedBy: string };

/**
 * Which model is claimed to have written the document, which is what picks the
 * reviewer (`reviewerFor` returns the other provider). Passing
 * `--writer=gemini-pro-latest` therefore forces the Anthropic reviewer.
 *
 * It exists because GEMINI_API_KEY is a protected Vercel variable: it pulls as
 * the literal "[SENSITIVE]", so a machine without it in .env.local cannot run
 * the default cross-provider review at all. Production has the key and the
 * in-app button is unaffected.
 */
const WRITER = process.argv.find((a) => a.startsWith("--writer="))?.split("=")[1];

async function review(documentId: string): Promise<Review> {
  const res = await fetch(`${BASE}/api/documents/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `jst_session=${SESSION}` },
    body: JSON.stringify({ documentId, ...(WRITER ? { model: WRITER } : {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `review failed with ${res.status}`);
  return data as Review;
}

/** Small pool: the review is a long model call and the point is not to melt anything. */
async function pooled<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

async function main() {
  if (!SESSION) {
    console.error("Set REVIEW_SESSION to a valid jst_session cookie value.");
    process.exit(1);
  }
  const includeApplied = process.argv.includes("--applied") || process.argv.includes("--all");
  const includeFinished = process.argv.includes("--all");

  const apps = await prisma.jobApplication.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      status: true,
      roleTitle: true,
      company: { select: { name: true } },
      jobDescriptions: { take: 1, select: { id: true } },
      documents: {
        where: { type: { in: ["resume", "cover_letter"] } },
        orderBy: { generatedAt: "desc" },
        select: { id: true, type: true, content: true },
      },
    },
  });

  const targets = apps.filter((a) => {
    if (!a.jobDescriptions.length) return false; // nothing to check against
    if (IN_FLIGHT.has(a.status)) return includeApplied;
    if (FINISHED.has(a.status)) return includeFinished;
    return true;
  });

  // Newest of each type only. Earlier versions are history, not drafts to fix.
  const jobs: { app: (typeof targets)[number]; docId: string; type: string }[] = [];
  for (const a of targets) {
    for (const type of ["resume", "cover_letter"]) {
      const doc = a.documents.find((d) => d.type === type && d.content.trim());
      if (doc) jobs.push({ app: a, docId: doc.id, type });
    }
  }

  console.log(`${targets.length} roles, ${jobs.length} documents to review.\n`);

  const results = await pooled(jobs, 3, async (j) => {
    try {
      const r = await review(j.docId);
      const blocking = r.findings.filter((f) => f.severity === "blocking").length;
      process.stdout.write(`  ${blocking ? "!" : "."}`);
      return { ...j, review: r, blocking, error: null as string | null };
    } catch (e) {
      process.stdout.write("  x");
      return { ...j, review: null, blocking: 0, error: (e as Error).message };
    }
  });
  console.log("\n");

  // Worst first, because the list is only useful if the top of it is where to start.
  results.sort((a, b) => b.blocking - a.blocking || (b.review?.findings.length ?? 0) - (a.review?.findings.length ?? 0));

  for (const r of results) {
    const head = `${r.app.company.name} - ${r.app.roleTitle} [${r.type.replace("_", " ")}]`;
    if (r.error) {
      console.log(`${head}\n  could not review: ${r.error}\n`);
      continue;
    }
    const rev = r.review!;
    console.log(`${head}  (${r.app.status})`);
    console.log(`  ${rev.verdict === "fix_first" ? "FIX FIRST" : "send it"} - ${rev.summary}`);
    for (const f of rev.findings) {
      console.log(`    [${f.severity}] ${f.what}`);
      console.log(`      fix: ${f.fix}`);
    }
    console.log();
  }

  const bad = results.filter((r) => r.blocking > 0).length;
  const clean = results.filter((r) => r.review && r.review.findings.length === 0).length;
  console.log(`${results.length} reviewed: ${bad} with blocking findings, ${clean} clean.`);
}

main().then(() => process.exit(0));
