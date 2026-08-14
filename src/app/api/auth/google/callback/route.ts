import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForIdToken, verifyGoogleIdToken } from "@/lib/google-auth";
import { createSessionToken, SESSION_COOKIE, SESSION_COOKIE_OPTIONS, OAUTH_STATE_COOKIE } from "@/lib/auth";

function loginError(request: NextRequest, message: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", message);
  const response = NextResponse.redirect(url);
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return loginError(request, "That sign-in link expired or was invalid. Please try again.");
  }

  const allowedEmail = process.env.ALLOWED_EMAIL;
  if (!allowedEmail) {
    return loginError(request, "Login is misconfigured (ALLOWED_EMAIL not set).");
  }

  let identity;
  try {
    const redirectUri = new URL("/api/auth/google/callback", request.url).toString();
    const idToken = await exchangeCodeForIdToken(code, redirectUri);
    identity = await verifyGoogleIdToken(idToken);
  } catch {
    return loginError(request, "Google sign-in failed. Please try again.");
  }

  if (!identity.emailVerified || identity.email.toLowerCase() !== allowedEmail.toLowerCase()) {
    return loginError(request, "That Google account isn't authorized for this app.");
  }

  const token = await createSessionToken();
  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}
