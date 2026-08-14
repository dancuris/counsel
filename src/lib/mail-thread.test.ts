import { describe, expect, it } from "vitest";
import { groupByThread, newestPart, quoteDepth } from "./mail-thread";

/**
 * Trimming a forwarded chain down to the message actually being sent.
 *
 * One AT&T thread arrived as five messages of 976, 1851, 2705, 2904 and 4204
 * characters, the last containing all of the others, so the conversation
 * showed the same sentences up to five times.
 *
 * The real-data result this was measured against: 157 bodies, 123 trimmed,
 * **0 emptied**. Emptying one is the failure that matters, because a message
 * with no body reads as nothing having been said.
 */
describe("quoteDepth", () => {
  it("counts the quote markers", () => {
    expect(quoteDepth("no quote")).toBe(0);
    expect(quoteDepth("> one")).toBe(1);
    expect(quoteDepth(">> two")).toBe(2);
    expect(quoteDepth("> > two with spaces")).toBe(2);
  });
});

describe("newestPart", () => {
  it("keeps only the shallowest quote depth", () => {
    const body = ["> The newest message.", ">", "> On Monday, X wrote:", ">> The older one.", ">>> Older still."].join("\n");
    const out = newestPart(body);
    expect(out).toContain("The newest message.");
    expect(out).not.toContain("The older one.");
    expect(out).not.toContain("Older still.");
  });

  it("drops the trailing attribution line", () => {
    // "On <date>, X wrote:" labels the history rather than belonging to the
    // message, so leaving it makes every trimmed body end mid-sentence.
    const out = newestPart(["> Thanks for sending that.", ">", "> On Monday, Brian wrote:"].join("\n"));
    expect(out).toContain("Thanks for sending that.");
    expect(out).not.toMatch(/wrote:\s*$/);
  });

  it("never empties a body that had content", () => {
    for (const body of ["A plain unquoted message.", "> A singly quoted message.", ">> Only deep quotes."]) {
      expect(newestPart(body).trim(), body).not.toBe("");
    }
  });

  it("handles nothing at all without throwing", () => {
    expect(newestPart(null)).toBe("");
    expect(newestPart(undefined)).toBe("");
    expect(newestPart("")).toBe("");
  });
});

describe("groupByThread", () => {
  const row = (id: string, threadId: string | null, day: number) => ({
    id,
    threadId,
    receivedAt: new Date(`2026-08-${String(day).padStart(2, "0")}T12:00:00Z`),
  });

  it("groups messages sharing a thread id", () => {
    const groups = groupByThread([row("a", "t1", 1), row("b", "t1", 2), row("c", "t2", 3)]);
    expect(groups.length).toBe(2);
    expect(groups.find((g) => g.threadId === "t1")!.messages.map((m) => m.id).sort()).toEqual(["a", "b"]);
  });

  it("puts the newest message first, in the newest thread first", () => {
    const groups = groupByThread([row("old", "t1", 1), row("new", "t1", 5), row("newest", "t2", 9)]);
    expect(groups[0].threadId).toBe("t2");
    expect(groups.find((g) => g.threadId === "t1")!.messages[0].id).toBe("new");
  });

  it("keeps every null-threaded message separate", () => {
    // Lumping them together would merge unrelated conversations, which is the
    // one grouping mistake with a visible consequence.
    const groups = groupByThread([row("a", null, 1), row("b", null, 2)]);
    expect(groups.length).toBe(2);
  });
});
