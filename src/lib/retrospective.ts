import { prisma } from "@/lib/prisma";
import { NOT_DELETED } from "@/lib/data/applications";

/**
 * What the closed applications have in common.
 *
 * The fourth mode the app never had a surface for. Three of Dan's four working
 * modes had a home - decide, apply, interview - and "why did that not work"
 * had none, despite twenty-two closed roles and twenty that never reached an
 * interview.
 *
 * Deliberately arithmetic rather than a model call. Every number here is
 * countable from rows that already exist, and a counted fact survives scrutiny
 * in a way a generated paragraph does not. The interesting comparison is
 * between the applications that reached a conversation and the ones that did
 * not, on the things that were actually within Dan's control.
 */

export type Cohort = {
  label: string;
  count: number;
  withResume: number;
  withCoverLetter: number;
  withJd: number;
  evaluatedFirst: number;
};

export type Retrospective = {
  reached: Cohort;
  didNot: Cohort;
  /** Roles that reached a conversation, for reading the shape of what works. */
  wins: { company: string; roleTitle: string; verdict: string | null; hadResume: boolean }[];
  /** Verdict, against whether it went anywhere. Thin, and labelled as thin. */
  byVerdict: { verdict: string; reached: number; total: number }[];
  /** The gap that limits every conclusion below. */
  closedWithoutJd: number;
  closedTotal: number;
};

function cohort(label: string, apps: AppRow[]): Cohort {
  return {
    label,
    count: apps.length,
    withResume: apps.filter((a) => a.documents.some((d) => d.type === "resume")).length,
    withCoverLetter: apps.filter((a) => a.documents.some((d) => d.type === "cover_letter")).length,
    withJd: apps.filter((a) => (a.jobDescriptions[0]?.rawText ?? "").length > 400).length,
    evaluatedFirst: apps.filter((a) => a.evaluations.length > 0).length,
  };
}

type AppRow = Awaited<ReturnType<typeof load>>[number];

async function load() {
  return prisma.jobApplication.findMany({
    where: { ...NOT_DELETED, status: { in: ["APPLIED", "INTERVIEWING", "OFFER", "CLOSED_REJECTED"] } },
    include: {
      company: { select: { name: true } },
      documents: { select: { type: true } },
      interviewNotes: { select: { id: true } },
      evaluations: { orderBy: { generatedAt: "desc" }, take: 1, select: { recommendation: true } },
      jobDescriptions: { orderBy: { pastedAt: "desc" }, take: 1, select: { rawText: true } },
    },
  });
}

export async function getRetrospective(): Promise<Retrospective> {
  const apps = await load();

  // Reaching a conversation is the outcome worth measuring. Status alone is not
  // enough: a role rejected after two rounds still got somewhere, and counting
  // it as a failure would bury the thing that worked.
  const reachedSet = apps.filter((a) => a.interviewNotes.length > 0 || ["INTERVIEWING", "OFFER"].includes(a.status));
  const didNotSet = apps.filter((a) => !reachedSet.includes(a));

  const verdicts = ["swing", "stretch", "pass"];
  const byVerdict = verdicts
    .map((verdict) => {
      const withVerdict = apps.filter((a) => a.evaluations[0]?.recommendation === verdict);
      return {
        verdict,
        total: withVerdict.length,
        reached: withVerdict.filter((a) => reachedSet.includes(a)).length,
      };
    })
    .filter((v) => v.total > 0);

  const closed = apps.filter((a) => a.status === "CLOSED_REJECTED");

  return {
    reached: cohort("Reached a conversation", reachedSet),
    didNot: cohort("Never heard back", didNotSet),
    wins: reachedSet.map((a) => ({
      company: a.company.name,
      roleTitle: a.roleTitle,
      verdict: a.evaluations[0]?.recommendation ?? null,
      hadResume: a.documents.some((d) => d.type === "resume"),
    })),
    byVerdict,
    closedWithoutJd: closed.filter((a) => (a.jobDescriptions[0]?.rawText ?? "").length <= 400).length,
    closedTotal: closed.length,
  };
}
