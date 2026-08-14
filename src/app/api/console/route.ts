import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAiErrorMessage, generateText } from "@/lib/ai";
import { stripToolCallLeak } from "@/lib/text";
import { SESSION_COOKIE } from "@/lib/auth";
import { candidateName } from "@/lib/candidate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * A prompt box wired to any model, for asking about the app itself.
 *
 * Everything else here is grounded on purpose: the assistant is scoped to one
 * role, Ask reads the search snapshot, the review reads a document. This one is
 * deliberately ungrounded, because the question Dan wants to ask is about the
 * thing none of those can see - the app. "Two dozen controls on one panel" was
 * a diagnosis he had to drag out of me by getting confused first.
 *
 * It is **read only and tool-free**. It cannot write to the database, send
 * anything, or reach outside the app. The one capability it has beyond a plain
 * prompt is `contextPath`, below.
 */

/**
 * Fetches one of the app's own pages and reduces it to something a model can
 * reason about.
 *
 * Asking "is this UI confusing" without showing the UI gets you generic advice
 * about clarity. Handing over the rendered page gets you "this panel has
 * twenty-six controls and no state". The session cookie is forwarded from the
 * caller, so it sees exactly what Dan sees and nothing he could not already
 * open himself.
 */
/** Rejects anything that is not a page inside this app. */
function assertAppPath(path: string) {
  // Same-origin only. The value comes from a text box, and a console that will
  // fetch any URL is a server-side request forgery hole, single user or not.
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("Context path must be an app path beginning with a single slash, e.g. /pipeline.");
  }
  // Pages, not endpoints. This is for looking at the interface, and an API
  // route returns JSON that tells you nothing about it. It also closes a class
  // rather than a case: most GET handlers here are read-only, but the Google
  // OAuth callback upserts a connection, and "needs a valid code so it cannot
  // really be triggered" is not a property worth relying on from a text box.
  if (/^\/api(\/|$|\?)/i.test(path)) {
    throw new Error("The console attaches pages, not API routes. Try a path like /pipeline or /applications/<id>.");
  }
}

async function fetchHtml(request: NextRequest, path: string): Promise<string> {
  assertAppPath(path);
  const url = new URL(path, request.nextUrl.origin);
  const session = request.cookies.get(SESSION_COOKIE)?.value ?? "";
  const res = await fetch(url, { headers: { cookie: `${SESSION_COOKIE}=${session}` } });
  if (!res.ok) throw new Error(`Could not load ${path}: the app returned ${res.status}.`);
  return res.text();
}

/** One page, reduced to text a model can reason about. */
function describePage(path: string, html: string, budget: number): string {

  // Scripts hold the RSC payload, which carries props for things that were
  // never rendered - the trap that has repeatedly made verification here
  // report the opposite of the truth. Strip them before reading anything.
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  const text = body
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

  // The control inventory is the part that makes UI questions answerable:
  // counting buttons by hand is exactly what a person will not do.
  const controls = [...body.matchAll(/<(button|a|select|textarea|input)\b[^>]*>([\s\S]*?)<\/\1>|<input\b[^>]*>/gi)]
    .map((m) => (m[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 0 && t.length < 60);

  return [
    `RENDERED PAGE: ${path}`,
    `Approximate size: ${Math.round(html.length / 1024)} KB of HTML.`,
    `Interactive controls on the page, in document order (${controls.length}): ${controls.join(" | ")}`,
    "",
    "VISIBLE TEXT:",
    text.slice(0, budget),
  ].join("\n");
}

/**
 * Walks the app from a starting page, following its own links.
 *
 * One page at a time answers "is this panel confusing". It cannot answer "is
 * this app coherent", which needs to see that Today, Pipeline and a role page
 * use three different words for the same idea. So the console crawls: it reads
 * the links a page actually renders and follows them, breadth first.
 *
 * Bounded by the same rules as a single fetch and two more. Only links the app
 * itself renders are followed, so it cannot wander anywhere a click could not
 * take it, and `max` caps the number of fetches so a pipeline of ninety roles
 * cannot turn one prompt into ninety requests.
 */
async function crawl(request: NextRequest, from: string, max: number): Promise<{ path: string; html: string }[]> {
  const seen = new Set<string>();
  const queue = [from];
  const out: { path: string; html: string }[] = [];

  while (queue.length && out.length < max) {
    const path = queue.shift()!;
    const key = path.split("#")[0];
    if (seen.has(key)) continue;
    seen.add(key);

    let html: string;
    try {
      html = await fetchHtml(request, path);
    } catch {
      // A page that will not load is not worth failing the whole crawl over.
      continue;
    }
    out.push({ path, html });

    // Only <a> hrefs - links a person could actually click.
    //
    // Matching every href attribute instead swept up the stylesheet, the HMR
    // chunk, the manifest and two favicons, and a six-page crawl came back
    // having read one real page and five assets.
    for (const m of html.matchAll(/<a\b[^>]*\bhref="(\/[^"]*)"/gi)) {
      const href = m[1].split("#")[0];
      if (!href || seen.has(href) || queue.includes(href)) continue;
      // Never follow anything that leaves the app, hits an endpoint, ends the
      // session, or is a file rather than a page. Logout is a link, and
      // following it would sign him out mid-prompt.
      if (href.startsWith("//")) continue;
      if (/^\/api(\/|$|\?)/i.test(href)) continue;
      if (/^\/(login|logout)\b/.test(href)) continue;
      if (/^\/_next\//.test(href)) continue;
      if (/\.(css|js|png|jpe?g|svg|ico|webmanifest|txt|xml|pdf|docx)(\?|$)/i.test(href)) continue;
      queue.push(href);
    }
  }
  return out;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return NextResponse.json({ error: "Write a prompt first." }, { status: 400 });

  // Three ways to show it the app, in increasing scope: one page, a list of
  // pages, or a crawl from a starting point. The whole context is capped, and
  // each page's share shrinks as more of them arrive - eight pages at full
  // length would be most of a context window spent on boilerplate nav.
  const TOTAL_BUDGET = 90_000;
  const MAX_PAGES = 12;

  const explicit: string[] = Array.isArray(body?.contextPaths)
    ? body.contextPaths.filter((p: unknown): p is string => typeof p === "string" && p.trim().length > 0).map((p: string) => p.trim())
    : typeof body?.contextPath === "string" && body.contextPath.trim()
      ? [body.contextPath.trim()]
      : [];
  const crawlFrom = typeof body?.crawlFrom === "string" ? body.crawlFrom.trim() : "";
  const maxPages = Math.min(Math.max(Number(body?.maxPages) || 6, 1), MAX_PAGES);

  let pages: { path: string; html: string }[] = [];
  try {
    if (crawlFrom) {
      pages = await crawl(request, crawlFrom, maxPages);
      if (pages.length === 0) throw new Error(`Nothing could be loaded starting from ${crawlFrom}.`);
    } else {
      for (const path of explicit.slice(0, MAX_PAGES)) {
        pages.push({ path, html: await fetchHtml(request, path) });
      }
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const perPage = pages.length ? Math.floor(TOTAL_BUDGET / pages.length) : 0;
  const context = pages.length
    ? [
        pages.length > 1
          ? `${pages.length} pages from the app follow${crawlFrom ? `, reached by crawling from ${crawlFrom}` : ""}. They are separate pages, not one long document.`
          : "",
        ...pages.map((p) => describePage(p.path, p.html, perPage)),
      ]
        .filter(Boolean)
        .join("\n\n========================================\n\n")
    : "";

  const requested = typeof body?.model === "string" ? body.model : null;

  const who = await candidateName();
  const system = [
    `You are answering a question from ${who} about Counsel, the single-user app that runs their executive job search. They built it with an AI pair, they are the only user, and they are asking you directly.`,
    "",
    "Answer the question they asked. Lead with the answer, then the reasoning. Disagree with them when you think they are wrong and say why - agreeing with a bad premise is the least useful thing you can do here.",
    "No preamble, no restating the question, no em-dashes or en-dashes.",
    context
      ? "\nOne or more rendered pages from the app are attached below, each with its own path and control inventory. When several are attached, compare them: the same idea called three different things across three pages is exactly the kind of fault a single page cannot show. When you make a claim about the interface, point at something in it. Do not invent controls or copy that is not there, and remember you are reading extracted text: layout, spacing, colour and hierarchy are NOT visible to you, so say so rather than guessing about them."
      : "\nNo page has been attached, so you are reasoning from what he tells you. If the question needs to see the interface, say which page would settle it - he can attach one.",
  ].join("\n");

  const user = context ? `${prompt}\n\n---\n\n${context}` : prompt;

  let generated;
  try {
    generated = await generateText({ model: requested, maxTokens: 8000, system, user });
  } catch (e) {
    return NextResponse.json({ error: getAiErrorMessage(e) }, { status: 502 });
  }
  const model = generated.model;
  const answer = (stripToolCallLeak(generated.text.trim()) ?? "").trim();
  if (!answer) return NextResponse.json({ error: "The model returned nothing. Try again." }, { status: 502 });

  // Never blocks the answer, same as AskLog.
  const attached = pages.map((p) => p.path);
  const saved = await prisma.consoleRun
    .create({
      data: {
        prompt,
        response: answer,
        model,
        contextPath: attached.length ? attached.join(" ") : null,
      },
    })
    .catch(() => null);

  return NextResponse.json({
    answer,
    model,
    id: saved?.id ?? null,
    contextChars: context.length,
    pages: attached,
  });
}

/** Recent runs, so a critique worth keeping can be found again. */
export async function GET() {
  const runs = await prisma.consoleRun.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, prompt: true, response: true, model: true, contextPath: true, createdAt: true },
  });
  return NextResponse.json({ runs });
}
