import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { getCredential } from "@/lib/credentials";
import { getAnthropicClient, resolveModel, getClaudeErrorMessage } from "@/lib/anthropic";
import { assertDemoBudget } from "@/lib/demo";
import { prisma } from "@/lib/prisma";

/**
 * One structured-output call, either provider.
 *
 * Two reasons this exists. Running the same evaluation or the same cover letter
 * through a second model is genuinely useful - a second opinion on a role is
 * worth having, and the two write differently. And Claude credits run out,
 * which currently means the app simply stops working mid-search.
 *
 * Both providers can be pinned to a JSON shape, they just spell it differently:
 * Anthropic through a strict tool definition, Gemini through responseSchema.
 * The schema is written once here in the Anthropic style and translated, since
 * every existing route already speaks that dialect.
 */

export type Provider = "anthropic" | "google";

export function providerFor(model: string): Provider {
  return model.startsWith("gemini") ? "google" : "anthropic";
}

let genai: { key: string; instance: GoogleGenAI } | null = null;
async function getGoogleClient(): Promise<GoogleGenAI> {
  const apiKey = await getCredential("gemini");
  if (!apiKey) {
    throw new Error("No Gemini API key is configured. Add one in Settings, or set GEMINI_API_KEY.");
  }
  if (!genai || genai.key !== apiKey) genai = { key: apiKey, instance: new GoogleGenAI({ apiKey }) };
  return genai.instance;
}

export async function hasGemini(): Promise<boolean> {
  return Boolean(await getCredential("gemini"));
}

/**
 * Anthropic tool schemas carry keys Gemini rejects. Strip them and keep the
 * shape, which is all Gemini needs to constrain the output.
 */
function toGeminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (!node || typeof node !== "object") return node;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === "additionalProperties" || k === "strict" || k === "minItems" || k === "maxItems") continue;
    out[k] = toGeminiSchema(v);
  }
  return out;
}

/**
 * strict:true requires additionalProperties:false on every object node, and
 * several tool schemas predate that rule. Adding it here rather than editing
 * each schema means new callers cannot forget it - and strict is what stops
 * the model returning a field in the wrong shape entirely.
 */
function toStrictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toStrictSchema);
  if (!node || typeof node !== "object") return node;

  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    // Strict rejects any minItems/maxItems other than 0 or 1, so a schema
    // written before strict existed fails the whole request rather than
    // loosening. `generate-documents` asks for 3 to 5 cover letter paragraphs
    // and came back "'minItems' values other than 0 or 1 are not supported".
    // The count has to live in the field's description instead, which is where
    // every other length rule in these schemas already is.
    if ((k === "minItems" || k === "maxItems") && v !== 0 && v !== 1) continue;
    out[k] = toStrictSchema(v);
  }
  if (src.type === "object") {
    out.additionalProperties = false;
    // strict also requires every property to be listed as required.
    if (src.properties && typeof src.properties === "object") {
      out.required = Object.keys(src.properties as Record<string, unknown>);
    }
  }
  return out;
}

/** Credit, quota and rate failures - the cases where another provider helps. */
function isCapacityError(e: unknown): boolean {
  const msg = `${getClaudeErrorMessage(e)}`.toLowerCase();
  const status = (e as { status?: number })?.status;
  return (
    status === 429 ||
    status === 402 ||
    msg.includes("credit balance") ||
    msg.includes("quota") ||
    msg.includes("rate limit") ||
    msg.includes("insufficient")
  );
}


/**
 * A system prompt: either plain text, or blocks where the stable prefix is
 * marked for caching.
 *
 * Anthropic takes the blocks as they are; Gemini has a single
 * `systemInstruction` string and no cache-control concept, so `systemText`
 * flattens them. Keeping both providers behind one type is the reason this
 * wrapper exists at all - a route that reached for its own client is how a
 * Gemini model id once got posted to Anthropic.
 */
export type SystemPrompt = string | { type: "text"; text: string; cache_control?: { type: "ephemeral" } }[];

export function systemText(system: SystemPrompt): string {
  return typeof system === "string" ? system : system.map((b) => b.text).join("\n\n");
}

export type StructuredCall = {
  system: SystemPrompt;
  user: string;
  /** Anthropic-style JSON schema for the object you want back. */
  schema: Record<string, unknown>;
  toolName: string;
  maxTokens?: number;
  /** Model id; anything starting with "gemini" routes to Google. */
  model?: string | null;
  /** Which Gemini model to fall back to. Defaults to Pro; see below. */
  fallbackModel?: string;
  /**
   * Fall back to Gemini when Claude is out of credit or rate limited. On by
   * default: a job search should not stop because a balance hit zero.
   */
  allowFallback?: boolean;
};

export type StructuredResult<T> = { data: T; model: string; provider: Provider; fellBack: boolean };

export async function generateStructured<T>(call: StructuredCall): Promise<StructuredResult<T>> {
  // The other provider, which does not pass through resolveModel and would
  // otherwise be an uncapped way to spend.
  await assertDemoBudget(prisma);

  const model = await resolveModel(call.model);

  if (providerFor(model) === "google") {
    return { ...(await viaGoogle<T>(call, model)), fellBack: false };
  }

  try {
    return { ...(await viaAnthropic<T>(call, model)), fellBack: false };
  } catch (e) {
    const canFall = (call.allowFallback ?? true) && (await hasGemini()) && isCapacityError(e);
    if (!canFall) throw e;
    // Pro, not Flash.
    //
    // This used to fall back to the cheap model on the reasoning that the path
    // exists "to keep the app working, not to make a considered choice about
    // which model to use". That is wrong for what this app produces. Almost
    // everything behind this call is written to be read by an employer: a
    // resume, a cover letter, an interview answer, a note to a recruiter. A
    // degraded version of those is not a degraded feature, it is a worse
    // document going out under Dan's name, and he would have no way to know
    // which model wrote it.
    //
    // `fallbackModel` lets the small extraction routes opt back down to Flash,
    // where the output is a company name rather than prose.
    return { ...(await viaGoogle<T>(call, call.fallbackModel ?? "gemini-pro-latest")), fellBack: true };
  }
}

async function viaAnthropic<T>(call: StructuredCall, model: string) {
  const anthropic = await getAnthropicClient();
  const message = await anthropic.messages.create({
    model,
    max_tokens: call.maxTokens ?? 4000,
    system: call.system,
    tools: [
      {
        name: call.toolName,
        strict: true,
        input_schema: toStrictSchema(call.schema) as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: call.toolName },
    messages: [{ role: "user", content: call.user }],
  });

  const use = message.content.find((b) => b.type === "tool_use");
  if (!use || use.type !== "tool_use") throw new Error("Claude did not return structured output.");
  return { data: use.input as T, model, provider: "anthropic" as const };
}

async function viaGoogle<T>(call: StructuredCall, model: string) {
  const res = await (await getGoogleClient()).models.generateContent({
    model,
    contents: call.user,
    config: {
      systemInstruction: systemText(call.system),
      responseMimeType: "application/json",
      responseSchema: toGeminiSchema(call.schema) as never,
      // Gemini spends part of this budget on internal reasoning before it
      // writes a single character of the answer, so a limit sized for the
      // answer alone truncates it mid-object. A 1200-token evaluation budget
      // that worked on a short posting produced unparseable JSON on a longer
      // one, which is the worst kind of limit: fine until the input grows.
      maxOutputTokens: Math.max((call.maxTokens ?? 4000) * 4, 8000),
    },
  });

  const finish = res.candidates?.[0]?.finishReason;
  const text = res.text;

  if (finish === "MAX_TOKENS") {
    throw new Error("Gemini ran out of output budget before finishing. Try a shorter job description, or Claude.");
  }
  if (!text) throw new Error(`Gemini returned no content${finish ? ` (${finish})` : ""}.`);

  try {
    return { data: JSON.parse(text) as T, model, provider: "google" as const };
  } catch {
    // Say what actually came back rather than a flat "invalid JSON" - the
    // reason is nearly always truncation or a safety stop, and those need
    // different responses.
    throw new Error(
      `Gemini returned output that was not valid JSON${finish ? ` (finish reason: ${finish})` : ""}.`
    );
  }
}

export function getAiErrorMessage(e: unknown): string {
  return getClaudeErrorMessage(e);
}

/**
 * Plain prose from either provider.
 *
 * The structured path above is the one almost everything uses, because almost
 * everything here wants fields it can render. The settings console does not:
 * it asks an open question and shows the answer. It still routes through this
 * module rather than reaching for a client directly, which is the whole point
 * of having it - a route that picked its own client is how a Gemini model id
 * ended up being posted to Anthropic.
 */
export async function generateText(call: {
  system: SystemPrompt;
  user: string;
  model?: string | null;
  maxTokens?: number;
  fallbackModel?: string;
  allowFallback?: boolean;
  /**
   * Earlier turns, oldest first.
   *
   * Ask is a conversation: "ok what should it say when I do" is meaningless
   * without the turn before it. The route was calling Anthropic directly partly
   * because this wrapper could only send one message, so supporting history
   * here is what lets it move behind the router and gain the fallback.
   */
  history?: { question: string; answer: string }[];
}): Promise<{ text: string; model: string; provider: Provider; fellBack: boolean }> {
  const model = await resolveModel(call.model);

  if (providerFor(model) === "google") {
    return { ...(await textViaGoogle(call, model)), fellBack: false };
  }

  try {
    return { ...(await textViaAnthropic(call, model)), fellBack: false };
  } catch (e) {
    /**
     * The same fallback the structured path has had all along.
     *
     * This function did not have one, which meant "a job search should not
     * stop because a balance hit zero" was true for five routes and false for
     * every prose route: the drafting, the refining, the answers. Dan hit
     * exactly that today and the app simply stopped.
     */
    if (!(call.allowFallback ?? true) || !(await hasGemini()) || !isCapacityError(e)) throw e;
    return { ...(await textViaGoogle(call, call.fallbackModel ?? "gemini-pro-latest")), fellBack: true };
  }
}

async function textViaGoogle(
  call: { system: SystemPrompt; user: string; maxTokens?: number; history?: { question: string; answer: string }[] },
  model: string
): Promise<{ text: string; model: string; provider: Provider }> {
  if (!(await hasGemini())) throw new Error("GEMINI_API_KEY is not set, so Gemini models are unavailable.");
  // Gemini calls the assistant role "model" where Anthropic calls it
  // "assistant"; everything else about the shape is the same.
  const contents = call.history?.length
    ? [
        ...call.history.flatMap((t) => [
          { role: "user" as const, parts: [{ text: t.question }] },
          { role: "model" as const, parts: [{ text: t.answer }] },
        ]),
        { role: "user" as const, parts: [{ text: call.user }] },
      ]
    : call.user;
  const res = await (await getGoogleClient()).models.generateContent({
    model,
    contents,
    config: {
      systemInstruction: systemText(call.system),
      // Same headroom as the structured path: Gemini spends part of the
      // budget thinking before it writes anything.
      maxOutputTokens: Math.max((call.maxTokens ?? 4000) * 2, 8000),
    },
  });
  const finish = res.candidates?.[0]?.finishReason;
  if (finish === "MAX_TOKENS") throw new Error("Gemini ran out of output budget before finishing.");
  const text = res.text;
  if (!text) throw new Error(`Gemini returned no content${finish ? ` (${finish})` : ""}.`);
  return { text, model, provider: "google" };
}

async function textViaAnthropic(
  call: { system: SystemPrompt; user: string; maxTokens?: number; history?: { question: string; answer: string }[] },
  model: string
): Promise<{ text: string; model: string; provider: Provider }> {
  const message = await (await getAnthropicClient()).messages.create({
    model,
    max_tokens: call.maxTokens ?? 4000,
    system: call.system,
    messages: [
      ...(call.history ?? []).flatMap((t) => [
        { role: "user" as const, content: t.question },
        { role: "assistant" as const, content: t.answer },
      ]),
      { role: "user" as const, content: call.user },
    ],
  });
  const text = message.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
  if (!text.trim()) throw new Error("Claude returned no content.");
  return { text, model, provider: "anthropic" };
}
