import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/lib/auth";
import { IS_DEMO } from "@/lib/demo";

/**
 * The demo's way in: a shared password, not Google.
 *
 * Real login is Google OAuth locked to one address, which is right for Dan and
 * useless for a link he hands to somebody else - they would need to be him.
 * Registering another redirect URI for a demo domain also means a Google Cloud
 * change, and the whole point of the demo is that it stands alone.
 *
 * So demo mode gets a shared password instead. Not to protect the data, which
 * is invented and worth nothing, but to protect the **spend**: every page in
 * here can call Claude, and an open URL is an open invoice.
 *
 * The route does not exist outside demo mode. It is not a second way into the
 * real app - `IS_DEMO` is false there, and this 404s.
 */
export async function POST(request: NextRequest) {
  if (!IS_DEMO) {
    return new NextResponse("Not found", { status: 404 });
  }

  const expected = process.env.DEMO_PASSWORD;
  if (!expected) {
    return NextResponse.redirect(new URL("/login?error=demo_not_configured", request.url), { status: 303 });
  }

  const form = await request.formData();
  const given = String(form.get("password") ?? "");

  // Length-independent comparison is overkill for a demo password guarding
  // invented data, but it costs one line and this is the shape to copy if
  // anything real ever authenticates this way.
  const ok = given.length === expected.length && timingSafeEqual(given, expected);
  if (!ok) {
    return NextResponse.redirect(new URL("/login?error=bad_password", request.url), { status: 303 });
  }

  const response = NextResponse.redirect(new URL("/", request.url), { status: 303 });
  response.cookies.set(SESSION_COOKIE, await createSessionToken(), SESSION_COOKIE_OPTIONS);
  return response;
}

function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
