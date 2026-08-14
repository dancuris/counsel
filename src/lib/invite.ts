import { AUTHOR, DATA_STATEMENT } from "@/lib/license";

/**
 * The invitation somebody gets, and the link that does the work.
 *
 * One place, because the deploy URL and the message explaining it are the same
 * artifact: a link with no explanation gets ignored, and an explanation whose
 * link has drifted is worse than neither.
 *
 * ## Why the link goes to Vercel rather than to this app
 *
 * The whole point of inviting somebody rather than hosting them is that their
 * instance is created under *their* accounts, so the author holds no
 * credentials to it and cannot read their job search. That property comes
 * entirely from them being the one signed in when the database is made. An
 * invitation that kept them inside this app could not deliver it.
 *
 * So the friction is the feature, and the message says so plainly instead of
 * apologising for it.
 */

/** The public repository the deploy button clones from. */
const REPO = process.env.PUBLIC_REPO?.trim() || "https://github.com/dancuris/counsel";

/**
 * Neon's Vercel integration. Listing it makes the database mandatory before the
 * project can be imported, so nobody lands on a deployed app with no storage
 * and a page full of errors.
 */
const NEON_INTEGRATION = "oac_3sK3gnG06emjIEVL09jjntDD";

export function deployUrl(): string {
  const params = new URLSearchParams({
    "repository-url": REPO,
    "integration-ids": NEON_INTEGRATION,
    env: "SESSION_SECRET",
    envDescription: "A long random string that signs your login cookie. Any 40 characters will do.",
    envLink: `${REPO}#run-your-own-copy`,
    "project-name": "counsel",
    "repository-name": "counsel",
  });
  return `https://vercel.com/new/clone?${params.toString()}`;
}

/** Where the illustrated guide lives, when there is one. */
export function guideUrl(): string | null {
  return process.env.GUIDE_URL?.trim() || null;
}

export type Invitation = { subject: string; body: string };

export function buildInvitation(recipientName: string | null): Invitation {
  const hello = recipientName?.trim() ? `${recipientName.trim()},` : "Hello,";
  const guide = guideUrl();

  return {
    subject: `${AUTHOR} built a job-search tool and thought you would want it`,
    body: [
      hello,
      "",
      "I built something for running an executive job search and I think it would be useful to you.",
      "It keeps every application in one place, reads a job description and tells you honestly whether",
      "the role is worth your time, and drafts the resume and cover letter when it is. It is built to",
      "talk you out of the wrong roles rather than help you apply to more of them.",
      "",
      "Set up your own copy here. It takes about ten minutes:",
      "",
      deployUrl(),
      "",
      "You will sign in to Vercel and GitHub, approve a database, and paste one random string. Then you",
      "set a password and answer a few questions about the search you are running.",
      "",
      DATA_STATEMENT,
      "",
      "That is deliberate, and it is the reason the setup runs on your accounts rather than mine.",
      ...(guide ? ["", `There is a guide with screenshots here: ${guide}`] : []),
      "",
      "If something breaks or you want it to do something it does not, there is a page inside the app",
      "for telling me. It comes straight to me.",
      "",
      AUTHOR,
    ].join("\n"),
  };
}
