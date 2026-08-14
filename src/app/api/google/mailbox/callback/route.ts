import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exchangeMailboxCode, clientIdFor } from "@/lib/google-mail";
import { verifyGoogleIdToken } from "@/lib/google-auth";
import { OAUTH_STATE_COOKIE } from "@/lib/auth";
import { connectionIdFor, type ConnectionTarget } from "@/lib/google-connections";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/settings?mailbox=${encodeURIComponent(reason)}`, request.url));

  if (url.searchParams.get("error")) return fail(url.searchParams.get("error") as string);
  if (!code || !state || !expectedState || state !== expectedState) return fail("state_mismatch");

  const target: ConnectionTarget = state.startsWith("drive.") ? "drive" : "mailbox";

  let tokens;
  try {
    tokens = await exchangeMailboxCode(
      code,
      new URL("/api/google/mailbox/callback", request.url).toString(),
      target
    );
  } catch {
    return fail("exchange_failed");
  }

  // Without a refresh token the connection cannot survive an hour, so treat a
  // response that lacks one as a failure rather than storing something broken.
  if (!tokens.refresh_token) return fail("no_refresh_token");

  let email = "unknown";
  if (tokens.id_token) {
    try {
      email = (await verifyGoogleIdToken(tokens.id_token, clientIdFor(target))).email;
    } catch {
      /* the mailbox address is a convenience label; a bad id_token shouldn't block the connection */
    }
  }

  const data = {
    email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    scopes: tokens.scope,
  };
  const id = connectionIdFor(target);
  await prisma.googleConnection.upsert({
    where: { id },
    create: { id, ...data },
    update: data,
  });

  const response = NextResponse.redirect(new URL(`/settings?${target}=connected`, request.url));
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}
