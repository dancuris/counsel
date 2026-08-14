import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getGoogleAuthorizeUrl } from "@/lib/google-auth";
import { OAUTH_STATE_COOKIE, OAUTH_STATE_COOKIE_OPTIONS } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const state = randomBytes(24).toString("base64url");
  const redirectUri = new URL("/api/auth/google/callback", request.url).toString();

  const response = NextResponse.redirect(getGoogleAuthorizeUrl(redirectUri, state));
  response.cookies.set(OAUTH_STATE_COOKIE, state, OAUTH_STATE_COOKIE_OPTIONS);
  return response;
}
