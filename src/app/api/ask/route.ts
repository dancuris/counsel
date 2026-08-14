import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getClaudeErrorMessage, cachedSystem } from "@/lib/anthropic";
import { generateText } from "@/lib/ai";
import { buildProfileContext } from "@/lib/profile-context";
import { buildSearchSnapshot } from "@/lib/search-snapshot";
// The same numbers the app shows on every role, so the advice and the line on
// the page cannot say different things about the same silence.
import { CHECK_IN_DAY, CHASE_DAY } from "@/lib/follow-up-state";
import { FOLLOW_UP_STATUSES } from "@/lib/constants";
import { stripToolCallLeak } from "@/lib/text";
import { prisma } from "@/lib/prisma";
import { NOT_DELETED } from "@/lib/data/applications";
import { candidateName } from "@/lib/candidate";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * One box, any question about the search.
 *
 * The existing assistant is scoped to a single application, so it cannot answer
 * what Dan actually asks out loud: "should I chase the recruiter about the airline role, it
 * has been over a week." That spans a role, its silence, the person, and
 * whether anything is already owed.
 *
 * It is **read only**. There are no tools and no writes, which is what lets the
 * whole search be handed over in one pass instead of a tool loop: the snapshot
 * is about 2,300 tokens, and a question that needs no round trips answers in
 * one call.
 *
 * The thing it must not do is hedge. A summary of the facts is useless here -
 * Dan can read his own pipeline. He asked for an opinion, so the prompt demands
 * a recommendation first and the reasoning after, and permits disagreement with
 * the premise of the question, which is often the useful part: the
 * thread had been quiet six days, not "over a week".
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ error: "Ask something." }, { status: 400 });

  // A follow-up continues the thread it belongs to. Without this, "draft that
  // for Friday instead" arrives with no idea what "that" was, and Dan has to
  // restate the whole question - which is the reason a one-shot box was the
  // wrong call.
  const threadId = typeof body?.threadId === "string" && body.threadId ? body.threadId : randomUUID();
  const prior = await prisma.askLog.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
    // Enough to hold a conversation, capped so a long thread cannot crowd out
    // the snapshot, which is the part that keeps answers factual.
    take: 8,
    select: { question: true, answer: true },
  });

  const [profile, snapshot] = await Promise.all([buildProfileContext(), buildSearchSnapshot()]);

  const who = await candidateName();
  const system = cachedSystem(
    profile,
    `You are advising ${who} on their executive job search. They are looking at the app that holds all of this and can read the facts himself, so a summary is worth nothing. He wants your judgement.

HERE IS THE ENTIRE SEARCH AS OF TODAY:

${snapshot}

How to answer:

- **Lead with the recommendation.** First sentence is what you think he should do, stated plainly. "Yes, write to Brian today." / "No, give it until Friday."
- Then the reasoning, in two or three sentences. Cite the actual numbers from the snapshot: how many days quiet, what the last contact was, what stage the role is at.
- **Correct the premise when it is wrong.** If he says "it has been over a week" and the data says six days, say so - that is often the whole answer.
- **Never restate a number as words that contradict it.** Six days is "six days",
  not "a full week" and not "over a week". Nine days is not "10 days". If you
  have written the figure in one sentence, every later description of the same
  gap must agree with it. This has gone wrong: an answer said "6 days ago" and
  then "sitting a full week" two clauses later.
- **Do not adopt his framing of how long something has been.** He will say "it
  has been ages" or "over a week" as an assumption, not a fact. The snapshot is
  the only source for elapsed time. Agreeing with a wrong premise because he
  stated it confidently is the single worst thing you can do here, because the
  whole reason he is asking is to check his own instinct against the record.
- If something in the data changes the picture and he has not asked about it, add one line at the end. Only when it genuinely matters.
- Never invent a fact that is not above. If the snapshot does not say, say you do not know and name what would settle it.
- No em-dashes or en-dashes. Plain sentences. No preamble, no "great question", no restating what he asked.
- Address him as "you". Never refer to him in the third person: the snapshot is
  written about him, which makes "he has never written to them" an easy slip.
- If you say "N places" or "three roles", the list underneath must have exactly
  that many items. Count before you commit to a number.
- Short. Under 150 words unless he asked for something that genuinely needs more.

A DEFAULT CADENCE, so the same facts do not produce opposite advice on different days. Sampling cannot be turned down on this model, and without a rule the judgement was a coin flip: the same six-day that role question returned "reach out" and "hold off" on alternate runs. Use this unless something in the snapshot argues otherwise, and say which it is:

- **The last message was his and they have not replied.** The ball is theirs. Under ${CHECK_IN_DAY} days: wait. ${CHECK_IN_DAY} to ${CHASE_DAY} days: a short check-in is fine. Over ${CHASE_DAY}: chase, and say the silence is now notable.
- **The last message was theirs and he owes a reply.** He is the one holding it up. Answer today regardless of the day count.
- **An interview or call is booked.** Do not chase about status in between; it reads as anxious.
- **Nobody has ever written.** Days quiet is meaningless. The question is whether to make the first move at all.

This is a default, not a law. Say plainly when a role deserves an exception and why.

You are not writing an email here and you cannot change anything. If the answer is "send this note", say so and he will open the composer.`
  );

  try {
    // Through the router: advice about the search should not stop being
    // available because one provider's balance hit zero.
    const response = await generateText({ system, user: question, history: prior, maxTokens: 1200 });
    const text = response.text.trim();

    const answer = stripToolCallLeak(text) ?? "";
    if (!answer) return NextResponse.json({ error: "No answer came back. Try again." }, { status: 502 });

    // What the answer is about, as things you can open. The recommendation is
    // useless if acting on it means going to find the role by hand, which is
    // the same fault as a count that links nowhere. Matching is on names the
    // answer actually used, so nothing appears that was not discussed.
    const [roles, people] = await Promise.all([
      prisma.jobApplication.findMany({
        where: NOT_DELETED,
        select: {
          id: true,
          roleTitle: true,
          status: true,
          company: { select: { name: true } },
          // Enough to date a reminder from the same cadence the advice used.
          mailMessages: { orderBy: { receivedAt: "desc" }, take: 1, select: { receivedAt: true } },
          correspondence: { orderBy: { createdAt: "desc" }, take: 1, select: { sentAt: true, createdAt: true } },
        },
      }),
      prisma.contact.findMany({ select: { id: true, name: true } }),
    ]);

    const haystack = answer.toLowerCase();
    const links = [
      ...roles
        .filter((r) => r.company.name.length > 3 && haystack.includes(r.company.name.toLowerCase()))
        .map((r) => ({ label: r.company.name, href: `/applications/${r.id}`, primary: false })),
      // A person named in this app's advice is named because Dan should write to
      // them, so the link is the act rather than the page. It carries the
      // question as the instruction, so Claude drafts against what was asked
      // instead of making him retype it.
      ...people
        .filter((c) => c.name.includes(" ") && haystack.includes(c.name.toLowerCase()))
        .map((c) => ({
          label: `Write to ${c.name.split(" ")[0]}`,
          href: `/contacts/${c.id}?write=1&prompt=${encodeURIComponent(question)}`,
          primary: true,
        })),
    ]
      // One chip per destination, and a handful at most: the answer mentions a
      // few things, a wall of chips would bury the ones that matter.
      .filter((l, i, all) => all.findIndex((x) => x.href === l.href) === i)
      .slice(0, 6);

    // Kept as a record. The answers are judgement calls and they vary run to
    // run, so without this there is no way to tell whether it changed its mind
    // or Dan misremembered - and across a months-long search it is a decision
    // log, which is the more useful thing. Never blocks the answer.
    await prisma.askLog
      .create({ data: { threadId, question, answer, subjects: links.length ? JSON.stringify(links) : null } })
      .catch(() => null);

    // A reminder for advice that says wait. "Hold off until day 10" is only
    // useful if day 10 arrives with a prompt attached, and the date is computed
    // here from the same cadence rather than read out of the model's prose, so
    // the button and the recommendation cannot disagree.
    const LIVE = new Set<string>(FOLLOW_UP_STATUSES);
    const discussed = roles.find(
      (r) => LIVE.has(r.status) && r.company.name.length > 3 && haystack.includes(r.company.name.toLowerCase())
    );

    let followUp: { applicationId: string; company: string; inDays: number; dueDate: string; note: string } | null = null;
    if (discussed) {
      const lastAt = [
        discussed.mailMessages[0]?.receivedAt,
        discussed.correspondence[0]?.sentAt ?? discussed.correspondence[0]?.createdAt,
      ]
        .filter((d): d is Date => Boolean(d))
        .sort((a, b) => b.getTime() - a.getTime())[0];

      const quietDays = lastAt ? Math.floor((Date.now() - lastAt.getTime()) / 86_400_000) : CHASE_DAY;
      // Never today and never in the past: a reminder you have already missed
      // is worse than none.
      const inDays = Math.max(2, CHASE_DAY - quietDays);
      const due = new Date(Date.now() + inDays * 86_400_000);
      followUp = {
        applicationId: discussed.id,
        company: discussed.company.name,
        inDays,
        dueDate: due.toISOString(),
        note: `Check in on ${discussed.company.name} if there is still no reply`,
      };
    }

    return NextResponse.json({ answer, links, threadId, followUp });
  } catch (e) {
    return NextResponse.json({ error: getClaudeErrorMessage(e) }, { status: 502 });
  }
}

/**
 * Past conversations. `?threadId=` returns one thread's turns; without it, the
 * most recent threads by their opening question, which is what Dan recognises
 * a conversation by.
 */
export async function GET(request: NextRequest) {
  const threadId = request.nextUrl.searchParams.get("threadId");

  if (threadId) {
    const turns = await prisma.askLog.findMany({
      where: { threadId },
      orderBy: { createdAt: "asc" },
      select: { question: true, answer: true, subjects: true },
    });
    return NextResponse.json({
      threadId,
      turns: turns.map((t) => ({
        question: t.question,
        answer: t.answer,
        links: t.subjects ? JSON.parse(t.subjects) : [],
      })),
    });
  }

  const rows = await prisma.askLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { threadId: true, question: true, createdAt: true },
  });

  // Newest first, but a thread is named by how it opened, not by its last turn.
  const byThread = new Map<string, { threadId: string; opening: string; at: Date; turns: number }>();
  for (const r of rows) {
    const seen = byThread.get(r.threadId);
    if (!seen) byThread.set(r.threadId, { threadId: r.threadId, opening: r.question, at: r.createdAt, turns: 1 });
    else {
      seen.turns += 1;
      if (r.createdAt < seen.at) seen.opening = r.question;
      if (r.createdAt > seen.at) seen.at = r.createdAt;
    }
  }

  return NextResponse.json({
    threads: [...byThread.values()].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 8),
  });
}
