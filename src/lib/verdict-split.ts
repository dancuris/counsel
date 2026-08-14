/**
 * What it means when the two providers disagree about a role.
 *
 * The detail page already showed both verdicts with a "disagrees" chip, which
 * says that they differ and nothing about which way. Those are not the same
 * fact: one model calling swing on a role the other called stretch is a reason
 * to move it up the week, and one calling pass is a reason to stop spending
 * time on it. A chip reads identically in both cases.
 *
 * Pure, so the wording can be exercised against fabricated pairs rather than
 * by running real evaluations against live roles at two dollars a pair - the
 * same reason `contact-grouping` and `drive-match` are pure.
 */

/** Coldest to warmest. A disagreement has a direction because this ordering exists. */
const RANK: Record<string, number> = { pass: 0, stretch: 1, swing: 2 };

export type Split = {
  /** The warmer of the two verdicts and who gave it. */
  warmer: { model: string; recommendation: string };
  cooler: { model: string; recommendation: string };
  /** One sentence on what the disagreement means for what Dan does next. */
  meaning: string;
};

/** Strips the picker's parenthetical so a sentence reads as prose. */
function shortModel(model: string): string {
  if (model.startsWith("gemini")) return model.includes("flash") ? "Gemini Flash" : "Gemini Pro";
  if (model.includes("opus")) return "Opus";
  if (model.includes("sonnet")) return "Sonnet";
  if (model.includes("haiku")) return "Haiku";
  return model;
}

/**
 * Describes a disagreement, or returns null when there is nothing to say.
 *
 * Null covers three cases that all look like "no split": the two agree, one of
 * them is missing, or they came from the same model - two runs of one model
 * differing is sampling noise, not a second opinion, and presenting it as one
 * would overstate what the app knows.
 */
export function describeSplit(
  a: { model: string; recommendation: string } | null | undefined,
  b: { model: string; recommendation: string } | null | undefined
): Split | null {
  if (!a || !b) return null;
  if (a.model === b.model) return null;
  if (a.recommendation === b.recommendation) return null;
  const ra = RANK[a.recommendation];
  const rb = RANK[b.recommendation];
  if (ra === undefined || rb === undefined) return null;

  const [warmer, cooler] = ra > rb ? [a, b] : [b, a];

  // The sentence names the action, not the disagreement. "They disagree" is
  // what the reader can already see; what to do about it is the useful part.
  const meaning =
    warmer.recommendation === "swing" && cooler.recommendation === "pass"
      ? `${shortModel(warmer.model)} says swing and ${shortModel(cooler.model)} says pass, which is the widest they get. Read both summaries before you decide this one.`
      : warmer.recommendation === "swing"
        ? `${shortModel(warmer.model)} rates this a swing where ${shortModel(cooler.model)} only called it a stretch. Worth moving up the week.`
        : `${shortModel(cooler.model)} would pass on this where ${shortModel(warmer.model)} called it a stretch. Worth a look before you spend the effort.`;

  return { warmer, cooler, meaning };
}
