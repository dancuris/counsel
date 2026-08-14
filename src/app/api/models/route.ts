import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

/**
 * Lists the Gemini models this API key can actually call.
 *
 * Model ids were picked from documentation three times and were wrong three
 * times: gemini-2.5-flash returns "no longer available to new users", the 3.x
 * models return PERMISSION_DENIED for this project, and 2.5-pro answered once
 * and then started returning 404. Availability depends on the account, not on
 * what the docs list, so the account is the thing to ask.
 */
export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY is not set." }, { status: 400 });

  try {
    const ai = new GoogleGenAI({ apiKey });
    const usable: { id: string; name: string }[] = [];
    for await (const m of await ai.models.list()) {
      const actions = (m as { supportedActions?: string[] }).supportedActions ?? [];
      // Only text generation is relevant here; the list also carries embedding
      // and media models that would fail if offered as a choice.
      if (actions.length === 0 || actions.includes("generateContent")) {
        usable.push({ id: (m.name ?? "").replace(/^models\//, ""), name: m.displayName ?? "" });
      }
    }
    return NextResponse.json({ count: usable.length, models: usable });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not list models." }, { status: 502 });
  }
}
