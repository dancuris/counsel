import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getMailboxAuthorizeUrl } from "@/lib/google-mail";
import type { ConnectionTarget } from "@/lib/google-connections";
import { OAUTH_STATE_COOKIE, OAUTH_STATE_COOKIE_OPTIONS } from "@/lib/auth";

// Starts the mailbox connection flow. This is NOT the login flow: it asks a
// (potentially different) Google account for offline Gmail/Calendar read access.
export async function GET(request: NextRequest) {
  // Which of the two connections this run is establishing. The target is
  // carried inside the state value rather than a second cookie, so the single
  // state comparison in the callback covers it too - a tampered target cannot
  // survive without also matching the random half.
  const target: ConnectionTarget =
    new URL(request.url).searchParams.get("target") === "drive" ? "drive" : "mailbox";
  const state = `${target}.${randomBytes(24).toString("base64url")}`;
  const redirectUri = new URL("/api/google/mailbox/callback", request.url).toString();

  const response = NextResponse.redirect(getMailboxAuthorizeUrl(redirectUri, state, target));
  response.cookies.set(OAUTH_STATE_COOKIE, state, OAUTH_STATE_COOKIE_OPTIONS);
  return response;
}
