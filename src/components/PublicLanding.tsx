import Link from "next/link";
import { IS_DEMO } from "@/lib/demo";
import { buttonClass, inputClass } from "@/lib/button";
import { ERROR_TEXT } from "@/lib/type";
import { signInModes, MIN_PASSWORD_LENGTH } from "@/lib/owner";
import { ACKNOWLEDGMENT, DATA_STATEMENT } from "@/lib/license";

/**
 * Failure codes turned into sentences.
 *
 * The OAuth callback and the demo route redirect with short codes, and those
 * were being printed to the page raw: somebody who mistyped a password saw the
 * word "bad_password". Anything not in this table is already a sentence,
 * written by `claimInstance`, and passes through unchanged.
 */
const ERROR_MESSAGES: Record<string, string> = {
  bad_credentials: "That email and password did not match.",
  bad_password: "That password is not right.",
  demo_not_configured: "This demo has no password set, so there is no way in yet.",
};

function errorText(error: string): string {
  return ERROR_MESSAGES[error] ?? error;
}

/**
 * The public face of the app: what an unauthenticated visitor sees at the root
 * and on the sign-in page.
 *
 * It exists because Google's brand verification could not see past a bare login
 * wall - it reported the home page as gated, found no explanation of what the
 * app does, and could not match the name against the consent screen. All three
 * came from the same absence. Shared by both routes so they cannot drift.
 */
export async function PublicLanding({ error, showSignIn = true }: { error?: string; showSignIn?: boolean }) {
  // Fetched here rather than passed in, so the three callers stay unchanged and
  // none of them can render a sign-in state that disagrees with another.
  const modes = await signInModes();
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center py-10">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-[var(--amber)]">
          <svg viewBox="0 0 100 100" fill="none" className="h-6 w-6 text-[#0f1114]" aria-hidden>
            <path d="M66 28 A30 30 0 1 0 66 72" stroke="currentColor" strokeWidth="12.5" strokeLinecap="round" />
            <circle cx="76" cy="50" r="7.5" fill="currentColor" />
          </svg>
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Counsel</h1>
      </div>

      <p className="mt-5 text-[15px] leading-relaxed text-[var(--tx-2)]">
        Counsel is a private assistant for running an executive job search. It keeps every application in one place,
        reads a job description and judges honestly whether the role is worth pursuing, and drafts a resume and cover
        letter tailored to it.
      </p>
      <p className="mt-3 text-[15px] leading-relaxed text-[var(--tx-2)]">
        Connected to a job-search mailbox, it files recruiter mail against the right role, notices rejections and
        interview invitations, and puts a confirmed interview on the calendar. It drafts messages but never sends one
        without an explicit press.
      </p>

      <p className="mt-5 text-[13px] text-[var(--tx-3)]">
        {IS_DEMO
          ? "A demo of a private job-search assistant, running on invented sample data."
          : modes.claimable
            ? "This deployment is new and has no owner yet. Whoever sets a password first owns it, so if it is meant to be yours, claim it now."
            : "This is a single-user application. It is not open for sign-up, and access is restricted to one account."}
      </p>

      {error && <p className={ERROR_TEXT}>{errorText(error)}</p>}

      {/*
        Demo mode swaps Google for a shared password. Google login here is
        locked to one address, so a demo behind it could only be used by Dan,
        which is the opposite of the point.
      */}
      {showSignIn && IS_DEMO && (
        <form action="/api/auth/demo" method="post" className="mt-7 flex w-full max-w-xs flex-col gap-2">
          <input
            type="password"
            name="password"
            required
            autoFocus
            placeholder="Demo password"
            className={`w-full ${inputClass("md")}`}
          />
          <button type="submit" className={buttonClass("primary", "md", "w-full")}>
            Open the demo
          </button>
          <span className="text-[12px] text-[var(--tx-3)]">
            Sample data throughout. Nothing here is anyone&apos;s real job search.
          </span>
        </form>
      )}

      {/*
        A fresh deployment: the first person to set a password owns it. There is
        no second claim, and an instance with ALLOWED_EMAIL set never shows this
        at all, which is what keeps a live instance from being taken over.
      */}
      {showSignIn && !IS_DEMO && modes.claimable && (
        <form action="/api/auth/claim" method="post" className="mt-7 flex w-full max-w-xs flex-col gap-2">
          <label className="text-[12px] font-medium text-[var(--tx-2)]" htmlFor="claim-email">
            Your email
          </label>
          <input
            id="claim-email"
            type="email"
            name="email"
            required
            autoFocus
            autoComplete="email"
            placeholder="you@example.com"
            className={`w-full ${inputClass("md")}`}
          />
          <label className="mt-1 text-[12px] font-medium text-[var(--tx-2)]" htmlFor="claim-password">
            A password
          </label>
          <input
            id="claim-password"
            type="password"
            name="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            className={`w-full ${inputClass("md")}`}
          />
          {modes.tokenRequired && (
            <>
              <label className="mt-1 text-[12px] font-medium text-[var(--tx-2)]" htmlFor="claim-token">
                Setup token
              </label>
              <input
                id="claim-token"
                type="password"
                name="token"
                required
                placeholder="The SETUP_TOKEN you set"
                className={`w-full ${inputClass("md")}`}
              />
            </>
          )}
          {/*
            Stated where the decision is, not on a page somebody has to find.
            The data sentence is only true because they deployed this
            themselves, which is why it sits on the claim form rather than in
            the marketing copy above.
          */}
          <p className="mt-2 rounded-lg border border-line bg-[var(--surface)] p-3 text-[12px] leading-relaxed text-[var(--tx-2)]">
            {DATA_STATEMENT}
          </p>

          <label className="mt-1 flex items-start gap-2 text-[12px] leading-relaxed text-[var(--tx-2)]">
            <input type="checkbox" name="acknowledged" required className="mt-0.5 flex-none" />
            <span>{ACKNOWLEDGMENT}</span>
          </label>

          <button type="submit" className={buttonClass("primary", "md", "mt-1 w-full")}>
            Claim this instance
          </button>
          <span className="text-[12px] text-[var(--tx-3)]">
            Next you will answer a few questions about the search you are running. Nothing needs a Google account.
          </span>
        </form>
      )}

      {/* An instance somebody already claimed. */}
      {showSignIn && !IS_DEMO && modes.password && (
        <form action="/api/auth/password" method="post" className="mt-7 flex w-full max-w-xs flex-col gap-2">
          <input
            type="email"
            name="email"
            required
            autoFocus
            autoComplete="email"
            placeholder="Your email"
            className={`w-full ${inputClass("md")}`}
          />
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            placeholder="Password"
            className={`w-full ${inputClass("md")}`}
          />
          <button type="submit" className={buttonClass("primary", "md", "w-full")}>
            Sign in
          </button>
        </form>
      )}

      {showSignIn && !IS_DEMO && modes.google && (
        <a
          href="/api/auth/google"
          className={`${modes.password || modes.claimable ? "mt-3" : "mt-7"} flex w-full max-w-xs items-center justify-center gap-2 rounded-lg border border-line-2 bg-[var(--surface)] px-3 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--surface-2)]`}
        >
          <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden="true">
            <path
              fill="#FFC107"
              d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.5 4.1 29.6 2 24 2 12.3 2 3 11.3 3 23s9.3 21 21 21c11.7 0 21-9.3 21-21 0-1.5-.2-2.7-.4-3.5z"
            />
            <path
              fill="#FF3D00"
              d="M6.3 14.7l6.6 4.8C14.7 15.5 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34.5 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
            />
            <path
              fill="#4CAF50"
              d="M24 44c5.5 0 10.5-2.1 14.2-5.6l-6.6-5.4C29.6 34.9 26.9 36 24 36c-5.3 0-9.7-3.4-11.3-8L6 33.4C9.4 39.6 16.2 44 24 44z"
            />
            <path
              fill="#1976D2"
              d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.6 5.4C41.4 35.3 44 29.7 44 23c0-1.5-.2-2.7-.4-3.5z"
            />
          </svg>
          Sign in with Google
        </a>
      )}

      {/*
        No way in at all: ALLOWED_EMAIL is set, so the instance is not claimable,
        but the Google client it names is not configured. Saying so beats an
        empty space where the sign-in should be, because the fix is an
        environment variable and nobody can guess that from a blank page.
      */}
      {showSignIn && !IS_DEMO && !modes.claimable && !modes.password && !modes.google && (
        <p className="mt-7 max-w-xs rounded-lg border border-line-2 bg-[var(--surface-2)] p-3 text-[13px] leading-relaxed text-[var(--tx-2)]">
          This deployment has no sign-in configured. It has <code>ALLOWED_EMAIL</code> set, so it is not open to be
          claimed, but <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> are missing. Set those, or
          clear <code>ALLOWED_EMAIL</code> to claim it with a password instead.
        </p>
      )}

      <p className="mt-8 border-t border-line pt-4 text-[13px] text-[var(--tx-3)]">
        <Link href="/privacy" className="underline hover:text-[var(--tx)]">
          Privacy policy
        </Link>
        <span className="mx-2">·</span>
        <Link href="/terms" className="underline hover:text-[var(--tx)]">
          Terms of service
        </Link>
      </p>
    </div>
  );
}
