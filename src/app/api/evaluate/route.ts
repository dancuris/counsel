import { NextRequest, NextResponse } from "next/server";
import { syncEvaluationsToDriveQuietly } from "@/lib/drive-records";
import { prisma } from "@/lib/prisma";
import { cleanInlineText } from "@/lib/text";
import { logActivity } from "@/lib/activity-log";
import { providerFor, generateStructured, getAiErrorMessage } from "@/lib/ai";
import { buildProfileContext } from "@/lib/profile-context";
import { RECOMMENDATIONS } from "@/lib/constants";
import { cachedSystem } from "@/lib/anthropic";

/** Verdicts ordered coldest to warmest, so a disagreement has a direction. */
const RANK: Record<string, number> = { pass: 0, stretch: 1, swing: 2 };

// A single evaluation runs 15 to 20 seconds against a long posting, and a pass
// verdict now costs a second model call on top. Without this the function was
// killed on Vercel's default limit mid-call: the UI said "Evaluating...", the
// request died, and the role landed with a job description and no evaluation.
export const maxDuration = 300;

const EVALUATION_TOOL = {
  name: "submit_evaluation",
  description: "Submit a structured fit evaluation for this job posting.",
  input_schema: {
    type: "object" as const,
    properties: {
      fitSummary: {
        type: "string",
        description: "2-4 sentence honest fit read covering strengths, gaps, geography, and comp.",
      },
      strengths: { type: "array", items: { type: "string" } },
      gaps: { type: "array", items: { type: "string" } },
      recommendation: { type: "string", enum: [...RECOMMENDATIONS] },
      salaryRange: {
        type: "string",
        description:
          "Compensation/salary range exactly as stated in the job posting (e.g. '$150,000 - $180,000 base + bonus'). Empty string if the posting does not mention compensation.",
      },
    },
    required: ["fitSummary", "strengths", "gaps", "recommendation", "salaryRange"],
  },
};

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const applicationId = body?.applicationId;
  if (typeof applicationId !== "string") {
    return NextResponse.json({ error: "applicationId is required." }, { status: 400 });
  }

  const application = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    include: {
      company: true,
      jobDescriptions: { orderBy: { pastedAt: "desc" }, take: 1 },
    },
  });
  if (!application) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }
  const jd = application.jobDescriptions[0];
  if (!jd) {
    return NextResponse.json({ error: "Save a job description first." }, { status: 400 });
  }

  const profileContext = await buildProfileContext();

  type Verdict = {
    fitSummary: string;
    strengths: string[];
    gaps: string[];
    recommendation: string;
    salaryRange?: string;
  };

  const system = cachedSystem(
    profileContext,
    "You are helping evaluate whether a job posting is a good fit for the candidate described below, using their own documented evaluation framework. Be honest and specific, not generically encouraging."
  );
  const user = `Company: ${application.company.name}\nRole: ${application.roleTitle}\n\nJob description:\n${jd.rawText}`;
  // 1200 was not enough. One posting produced a long fitSummary
  // and ten strengths, the response hit the ceiling mid-object, and the tool
  // input arrived with `gaps` empty and `recommendation` absent entirely -
  // which Prisma then refused, turning 22 seconds of real work into a 500 with
  // nothing saved and nothing explained.
  const shared = { toolName: "submit_evaluation", schema: EVALUATION_TOOL.input_schema, maxTokens: 3000, system, user };

  // Two providers on the same posting, at the same time. They weigh geography,
  // seniority and industry differently, and where they disagree is exactly the
  // part worth reading rather than a number to average away.
  if (body?.compare) {
    const [a, b] = await Promise.allSettled([
      generateStructured<Verdict>({ ...shared, model: "claude-sonnet-5", allowFallback: false }),
      generateStructured<Verdict>({ ...shared, model: "gemini-pro-latest", allowFallback: false }),
    ]);
    const ok = [a, b].filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof generateStructured<Verdict>>>>).value);
    if (ok.length === 0) {
      const why = [a, b].map((r) => (r.status === "rejected" ? getAiErrorMessage(r.reason) : "")).filter(Boolean);
      return NextResponse.json({ error: why.join(" / ") || "Both models failed." }, { status: 502 });
    }
    const saved = [];
    for (const r of ok) {
      // Same guard as the single path: a truncated verdict must not reach the
      // database, and here it would take the other model's good one with it.
      if (!r.data?.recommendation || !(RECOMMENDATIONS as readonly string[]).includes(r.data.recommendation)) continue;
      saved.push(
        await prisma.evaluation.create({
          data: {
            applicationId: application.id,
            fitSummary: r.data.fitSummary,
            strengths: JSON.stringify(r.data.strengths ?? []),
            gaps: JSON.stringify(r.data.gaps ?? []),
            recommendation: r.data.recommendation,
            model: r.model,
          },
        })
      );
    }
    await syncEvaluationsToDriveQuietly(application.id);
    return NextResponse.json({
      compared: true,
      evaluations: saved,
      // Only meaningful with two results. One verdict trivially agrees with
      // itself, and reporting that as agreement overstates the confidence.
      agree: ok.length > 1 ? new Set(ok.map((r) => r.data.recommendation)).size === 1 : null,
      errors: [a, b].filter((r) => r.status === "rejected").map((r) => getAiErrorMessage((r as PromiseRejectedResult).reason)),
      failed: [a, b].filter((r) => r.status === "rejected").length,
    });
  }

  /**
   * A verdict with no recommendation is not a verdict.
   *
   * `strict: true` and a `required` list do not survive the response being cut
   * off at max_tokens: the JSON simply stops, and what arrives is a
   * well-formed object missing its most important field. The standing rule
   * here is to validate tool output before persisting, and this is the field
   * where it matters, since everything downstream branches on it.
   */
  const usable = (v: Verdict | undefined): boolean =>
    !!v && typeof v.fitSummary === "string" && v.fitSummary.trim().length > 0 &&
    typeof v.recommendation === "string" && (RECOMMENDATIONS as readonly string[]).includes(v.recommendation);

  let input: Verdict;
  let model: string;
  let fellBack = false;
  try {
    // Runs on whichever provider the chosen model belongs to, and falls back to
    // Gemini if Claude is out of credit rather than leaving the search stuck.
    let result = await generateStructured<Verdict>({ ...shared, model: body?.model });

    // One retry, because truncation is a length accident rather than a
    // disagreement: the same request usually comes back complete.
    if (!usable(result.data)) {
      result = await generateStructured<Verdict>({ ...shared, model: body?.model, maxTokens: 4000 });
    }
    if (!usable(result.data)) {
      return NextResponse.json(
        { error: "The evaluation came back without a verdict, twice. Nothing was saved. Try again, or shorten the job description." },
        { status: 502 }
      );
    }

    input = result.data;
    model = result.model;
    fellBack = result.fellBack;
  } catch (e) {
    return NextResponse.json({ error: getAiErrorMessage(e) }, { status: 502 });
  }

  const evaluation = await prisma.evaluation.create({
    data: {
      applicationId: application.id,
      fitSummary: input.fitSummary,
      strengths: JSON.stringify(input.strengths ?? []),
      gaps: JSON.stringify(input.gaps ?? []),
      recommendation: input.recommendation,
      model,
    },
  });
  await syncEvaluationsToDriveQuietly(applicationId);

  // A pass verdict moves the role out of the live pipeline, but not on one
  // opinion. Closing a role is the one verdict that ends the conversation, so
  // it gets checked against the other provider first - they weigh seniority,
  // industry and geography differently, and a disagreement is exactly the case
  // worth a human look rather than a quiet close.
  //
  // Agree: PASSED. Disagree: VERIFY, which is the "come back to this" status.
  // Forward only, and only from the stages before applying - a pass on
  // something already applied to is a second opinion, not a reason to close it.
  const PASSABLE = ["TARGET", "LIVE_POSTING_FOUND", "VERIFY"];
  let secondOpinion: { model: string; recommendation: string; fitSummary: string } | null = null;

  // The two verdicts worth a second read, for opposite reasons.
  //
  // `pass` ends the conversation, so it must not rest on one opinion.
  //
  // `stretch` is the genuinely uncertain one - it is the model saying "maybe" -
  // and it was the only verdict going unchecked. That is backwards: a confident
  // swing needs no help, but a maybe is precisely where the other provider's
  // read changes what Dan does with his week. They weigh seniority, industry
  // and geography differently, so one calling swing on a role the other called
  // stretch is a signal to move it up, and one calling pass is a signal to stop
  // spending time on it.
  const UNCERTAIN = input.recommendation === "stretch";
  const CLOSING = input.recommendation === "pass" && PASSABLE.includes(application.status);

  if (CLOSING || UNCERTAIN) {
    // Check with the provider that did not just answer.
    const checkModel = providerFor(model) === "google" ? "claude-sonnet-5" : "gemini-pro-latest";
    try {
      const check = await generateStructured<Verdict>({ ...shared, model: checkModel, allowFallback: false });
      secondOpinion = { model: check.model, recommendation: check.data.recommendation, fitSummary: check.data.fitSummary };
      // Kept as a real evaluation row: the detail page already shows every
      // model's verdict, and the disagreement is the useful part.
      await prisma.evaluation.create({
        data: {
          applicationId: application.id,
          fitSummary: check.data.fitSummary,
          strengths: JSON.stringify(check.data.strengths ?? []),
          gaps: JSON.stringify(check.data.gaps ?? []),
          recommendation: check.data.recommendation,
          model: check.model,
        },
      });
      await syncEvaluationsToDriveQuietly(applicationId);
    } catch {
      // No second opinion available. The single verdict still stands, and the
      // note records that it went unchecked.
    }

    // Only a pass moves anything. A stretch that the other provider calls
    // swing is worth knowing and is not a reason to change the role's stage
    // behind Dan's back: the status reflects where the application actually
    // is, not how promising two models find it. The second opinion still rides
    // back in the response and is already saved as its own evaluation row.
    if (CLOSING) {
      const agreed = secondOpinion ? secondOpinion.recommendation === "pass" : null;
      const next = agreed === false ? "VERIFY" : "PASSED";
      const why =
        agreed === true
          ? `both models came back pass (${model} and ${secondOpinion!.model})`
          : agreed === false
            ? `${model} said pass but ${secondOpinion!.model} said ${secondOpinion!.recommendation} - worth a look before closing it`
            : "the evaluation came back pass, and the second opinion could not be reached";

      if (next !== application.status) {
        const stamp = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        await prisma.jobApplication.update({
          where: { id: application.id },
          data: {
            status: next,
            notes: `${application.notes ? `${application.notes}\n\n` : ""}${stamp}: moved to ${next} automatically because ${why}.`,
          },
        });
        await logActivity({
          applicationId: application.id,
          action: "status_changed",
          summary: "Status changed",
          from: application.status,
          to: next,
        });
      }
    }
  }

  // The posting's own stated range is more authoritative than whatever was
  // there before (often a rough Glassdoor guess jotted down at save time).
  // Sanitised because this is model output: an unsanitised write here is how a
  // leaked tool-call fragment ended up stored as a salary and rendered on the
  // pipeline as visible angle brackets.
  const salaryRange = cleanInlineText(input.salaryRange ?? "");
  if (salaryRange) {
    await prisma.jobApplication.update({
      where: { id: application.id },
      data: { salaryRange },
    });
  }

  // The caller needs to know a pass was double-checked, and whether the two
  // agreed - "moved to VERIFY because the models disagreed" is a different
  // message from "closed".
  // What the two verdicts mean together, computed here rather than left to the
  // UI to infer from two strings. A stretch that the other provider calls swing
  // and a stretch it calls pass point in opposite directions, and both read as
  // "they disagreed" if the caller only compares for equality.
  const split =
    secondOpinion && secondOpinion.recommendation !== input.recommendation
      ? {
          first: { model, recommendation: input.recommendation },
          second: { model: secondOpinion.model, recommendation: secondOpinion.recommendation },
          // Positive when the second read is more encouraging than the first.
          lean:
            RANK[secondOpinion.recommendation] > RANK[input.recommendation]
              ? ("warmer" as const)
              : ("cooler" as const),
        }
      : null;

  return NextResponse.json({
    evaluation,
    salaryRange: salaryRange || null,
    model,
    fellBack,
    secondOpinion,
    split,
    passOutcome:
      input.recommendation === "pass" && secondOpinion
        ? secondOpinion.recommendation === "pass"
          ? "passed"
          : "needs-a-look"
        : null,
  });
}
