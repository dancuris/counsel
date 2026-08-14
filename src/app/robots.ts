import type { MetadataRoute } from "next";

/**
 * Keeps Counsel out of search results.
 *
 * Not a blanket Disallow: /. Google's OAuth brand verification fetches the home
 * page, privacy policy and terms, and blocking those in robots.txt risks
 * failing the check the public pages exist to pass. Those three stay crawlable
 * and carry noindex instead, which is the correct tool for "do not list this"
 * as opposed to "do not fetch this".
 *
 * Everything else is behind the auth proxy anyway, so a crawler reaching it
 * would only ever see a redirect to the landing page. Naming the paths is
 * belt and braces.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/privacy", "/terms"],
        disallow: ["/applications", "/companies", "/inbox", "/profile", "/contacts", "/api/"],
      },
    ],
    host: "https://tracker.ecuris.com",
  };
}
