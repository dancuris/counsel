import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const authenticated = await verifySessionToken(token);

  if (!authenticated) {
    // The root renders the public landing rather than redirecting. A home page
    // that bounces to a login wall is what failed brand verification: the
    // checker could not see the app's name or what it does.
    if (request.nextUrl.pathname === "/") return NextResponse.next();
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // PWA install assets are excluded alongside the login/auth routes: the
  // browser fetches the manifest, icons, and service worker without following
  // the app's session, so gating them behind auth redirects them to /login and
  // breaks both SW registration and "Add to Home Screen". None of them expose
  // anything beyond the app's name and icon.
  //
  // robots.txt has to be fetchable by definition - a crawler reads it before
  // anything else, and gating it behind login means the noindex rules are never
  // seen at all.
  //
  // privacy and terms are public for the same reason: Google requires both to
  // be reachable before an OAuth app can be published, and its crawler is not
  // signed in. Neither page contains anything private - they describe what the
  // app does with data, which is the point of publishing them.
  // `api/requests` is public for the same reason and with tighter limits: it
  // receives feature requests from other people's instances, which are separate
  // deployments with no credentials here, so there is nothing for them to
  // authenticate with. It only ever writes a row that waits for a human, so the
  // worst an abuser achieves is a list to delete.
  //
  // `api/version` is public on purpose. One instance per person means there is
  // no central server to push an update from, so an instance asks a known-good
  // one what the newest release is. It returns a commit sha, a date and a
  // release title - the same facts the repository carries - touches no database
  // and reads nothing about the person using it.
  matcher: [
    "/((?!login|privacy|terms|robots\\.txt|api/auth|api/version|api/requests|_next/static|_next/image|favicon\\.ico|favicon\\.png|sw\\.js|manifest\\.webmanifest|icon\\.png|apple-icon\\.png|icons/).*)",
  ],
};
