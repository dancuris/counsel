import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateStructured, getAiErrorMessage } from "@/lib/ai";
import { NOT_DELETED } from "@/lib/data/applications";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Reads the gap statements across every evaluated application and asks what
 * separates the roles that replied from the ones that did not.
 *
 * The counted half of the retrospective can show that tailored documents
 * correlate with getting a conversation. It cannot say *why* seventeen roles
 * ignored him, because that answer is in the content of the evaluations - two
 * hundred gap statements that were written, stored, and never read back.
 *
 * On demand rather than on page load: it is a model call over the whole
 * archive, and a page that silently spends money every time it is opened is a
 * page you learn not to open.
 */

type Report = {
  patterns: { pattern: string; evidence: string; soWhat: string }[];
  caveat: string;
};

const asList = (raw: string): string[] => {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

export async function POST() {
  const apps = await prisma.jobApplication.findMany({
    where: { ...NOT_DELETED, status: { in: ["APPLIED", "INTERVIEWING", "OFFER", "CLOSED_REJECTED"] } },
    include: {
      company: { select: { name: true } },
      interviewNotes: { select: { id: true } },
      evaluations: { orderBy: { generatedAt: "desc" }, take: 1, select: { recommendation: true, gaps: true } },
    },
  });

  const describe = (a: (typeof apps)[number]) => {
    const e = a.evaluations[0];
    if (!e) return null;
    return `${a.company.name} - ${a.roleTitle} [${e.recommendation}] gaps: ${asList(e.gaps).join(" | ")}`;
  };

  const reached = apps
    .filter((a) => a.interviewNotes.length > 0 || ["INTERVIEWING", "OFFER"].includes(a.status))
    .map(describe)
    .filter((v): v is string => Boolean(v));
  const didNot = apps
    .filter((a) => !(a.interviewNotes.length > 0 || ["INTERVIEWING", "OFFER"].includes(a.status)))
    .map(describe)
    .filter((v): v is string => Boolean(v));

  if (didNot.length < 5) {
    return NextResponse.json({ error: "Not enough evaluated applications yet to say anything useful." }, { status: 422 });
  }

  try {
    const result = await generateStructured<Report>({
      system:
        "You analyse one job seeker's own application record. Be concrete and sceptical. Only claim what the data supports, and where the sample is too small to carry a claim, say so plainly. Name specific employers and roles as evidence. No flattery, no filler, no encouragement.",
      user:
        `Gap statements from fit evaluations on this person's applications.\n\n` +
        `REACHED A CONVERSATION (${reached.length}):\n${reached.join("\n")}\n\n` +
        `NEVER HEARD BACK (${didNot.length}):\n${didNot.join("\n")}\n\n` +
        `What recurs in the second group that does not recur in the first? At most four patterns, ordered by how well the evidence supports them.`,
      schema: {
        type: "object",
        properties: {
          patterns: {
            type: "array",
            description: "At most four, strongest evidence first.",
            items: {
              type: "object",
              properties: {
                pattern: { type: "string", description: "The pattern, one sentence." },
                evidence: { type: "string", description: "The specific roles that show it." },
                soWhat: { type: "string", description: "What to do differently, concretely." },
              },
            },
          },
          caveat: { type: "string", description: "What this analysis cannot show, stated plainly." },
        },
      },
      toolName: "report",
      maxTokens: 2000,
    });

    return NextResponse.json({
      patterns: (result.data.patterns ?? []).slice(0, 4),
      caveat: result.data.caveat ?? "",
      model: result.model,
      counts: { reached: reached.length, didNot: didNot.length },
    });
  } catch (e) {
    return NextResponse.json({ error: getAiErrorMessage(e) }, { status: 502 });
  }
}
