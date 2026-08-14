import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/lib/auth";
import { verifyOwnerPassword } from "@/lib/owner";
import { recordFailure } from "@/lib/failures";

/**
 * Signing in with the password set when the instance was claimed.
 *
 * This is the ordinary way into a deployment somebody set up for themselves.
 * Google sign-in still works where it is configured, and on Dan's instance it
 * is still the only way in, because he never claimed a password there.
 *
 * The reply is deliberately vague about which half was wrong. "No account with
 * that email" confirms which addresses exist, and there is exactly one.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");

  const ok = await verifyOwnerPassword(email, password);
  if (!ok) {
    // Worth a log line: on a single-user instance a run of these is somebody
    // trying, and nothing else in the app would ever say so.
    await recordFailure("auth.password", new Error("Sign-in refused"), { email });
    return NextResponse.redirect(new URL("/login?error=bad_credentials", request.url), { status: 303 });
  }

  const response = NextResponse.redirect(new URL("/", request.url), { status: 303 });
  response.cookies.set(SESSION_COOKIE, await createSessionToken(), SESSION_COOKIE_OPTIONS);
  return response;
}
