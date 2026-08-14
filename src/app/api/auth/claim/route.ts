import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/lib/auth";
import { claimInstance } from "@/lib/owner";

/**
 * Taking ownership of a fresh deployment, from the web.
 *
 * This is the step that used to be impossible without a Google Cloud project.
 * Somebody deploys their own copy, opens it, sets an email and a password, and
 * is inside. Every refusal lives in `claimInstance` rather than here, so there
 * is one place that decides whether an instance may be claimed.
 *
 * On success it signs the new owner straight in and sends them to the setup
 * questions rather than to an empty dashboard: they have just told the app who
 * they are, and stopping to make them find Settings would waste that.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const token = String(form.get("token") ?? "");
  const acknowledged = form.get("acknowledged") === "on";

  const result = await claimInstance(email, password, token, acknowledged);
  if (!result.ok) {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", result.error);
    return NextResponse.redirect(url, { status: 303 });
  }

  const response = NextResponse.redirect(new URL("/setup/start", request.url), { status: 303 });
  response.cookies.set(SESSION_COOKIE, await createSessionToken(), SESSION_COOKIE_OPTIONS);
  return response;
}
