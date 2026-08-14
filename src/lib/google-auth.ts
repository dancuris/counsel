import { createRemoteJWKSet, jwtVerify } from "jose";

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

const googleJwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));

function getClientCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set.");
  }
  return { clientId, clientSecret };
}

export function getGoogleAuthorizeUrl(redirectUri: string, state: string): string {
  const { clientId } = getClientCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCodeForIdToken(code: string, redirectUri: string): Promise<string> {
  const { clientId, clientSecret } = getClientCredentials();
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { id_token?: string };
  if (!body.id_token) throw new Error("Google token response had no id_token.");
  return body.id_token;
}

export type GoogleIdentity = { email: string; emailVerified: boolean; name?: string };

/**
 * `audience` defaults to the login client, which is right for sign-in. The
 * Drive connection is issued by a different OAuth client, so its id_token
 * carries a different `aud` and fails verification against the default. That
 * failure was swallowed by the callback's catch and the connection was stored
 * with the email "unknown" - which quietly disabled the one check that makes a
 * wrong-account connection visible on the Profile page.
 */
export async function verifyGoogleIdToken(idToken: string, audience?: string): Promise<GoogleIdentity> {
  const { clientId } = getClientCredentials();
  const { payload } = await jwtVerify(idToken, googleJwks, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: audience ?? clientId,
  });
  if (typeof payload.email !== "string") throw new Error("Google ID token had no email claim.");
  return {
    email: payload.email,
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === "string" ? payload.name : undefined,
  };
}
