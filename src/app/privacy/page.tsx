import type { Metadata } from "next";
import { PAGE_TITLE } from "@/lib/type";

export const metadata: Metadata = {
  title: "Privacy Policy - Counsel",
  description: "How Counsel handles data, including Google user data.",
};

/**
 * Public by design. Google requires a reachable privacy policy before an OAuth
 * app can be published, and its crawler is not signed in - so this route is
 * excluded from the auth proxy alongside the PWA assets.
 *
 * Written to describe what the app actually does. Counsel has one user, so the
 * usual boilerplate about sharing data with partners and advertisers would be
 * false rather than merely unnecessary.
 */
export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl py-10">
      <h1 className={PAGE_TITLE}>Privacy Policy</h1>
      <p className="mt-1 text-sm text-[var(--tx-3)]">Last updated 5 August 2026</p>

      <div className="mt-8 space-y-6 text-[14px] leading-relaxed text-[var(--tx-2)]">
        <section>
          <h2 className="text-base font-semibold text-[var(--tx)]">What this is</h2>
          <p className="mt-2">
            Counsel is a private, single-user application used by one person to run their own job search. It is not
            offered to the public, has no other users, and no accounts can be created on it. Access is restricted to a
            single Google account.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-[var(--tx)]">What it stores</h2>
          <p className="mt-2">
            Job applications, job descriptions, notes, contacts, generated resumes and cover letters, and messages
            synchronised from the connected Google mailbox. This is stored in a private Postgres database hosted by Neon
            and served from Vercel.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-[var(--tx)]">Google user data</h2>
          <p className="mt-2">Counsel requests these scopes, and uses them only as described:</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            <li>
              <b className="text-[var(--tx)]">gmail.readonly</b> - reads recent messages from the connected mailbox to
              file them against the matching job application and identify rejections, interview invitations and
              recruiter approaches.
            </li>
            <li>
              <b className="text-[var(--tx)]">gmail.send</b> - sends a message only when the user explicitly presses
              Send on a draft they have reviewed. Nothing is ever sent automatically.
            </li>
            <li>
              <b className="text-[var(--tx)]">calendar.events</b> - creates a calendar event for an interview when the
              user confirms it. It does not read, modify or delete other events.
            </li>
            <li>
              <b className="text-[var(--tx)]">openid, userinfo.email, userinfo.profile</b> - confirms which account is
              connected, and restricts sign-in to the single permitted address.
            </li>
          </ul>
          <p className="mt-3">
            Message text is sent to a language model to classify what each message is about and to draft replies. See
            &ldquo;Language models&rdquo; below for which providers, and what they do with it. No Google user data is
            sold, shared with any third party beyond those providers, used for advertising, or used to build any
            profile.
          </p>
          <p className="mt-3">
            Counsel&apos;s use of information received from Google APIs adheres to the{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-[var(--tx)]">Language models</h2>
          <p className="mt-2">
            Counsel uses two model providers. Which one runs a given request depends on the model selected in the app,
            and either may be used for the same kinds of work: evaluating a job description against the stored profile,
            drafting a resume or cover letter, classifying mailbox messages, and drafting replies. The data sent is the
            job description, the stored profile and career history, and the text of messages synchronised from the
            mailbox.
          </p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            <li>
              <b className="text-[var(--tx)]">Anthropic (Claude API)</b> - Anthropic does not train its models on data
              submitted through the API.
            </li>
            <li>
              <b className="text-[var(--tx)]">Google (Gemini API, paid tier)</b> - on paid Gemini API usage, Google
              does not use prompts or responses to improve its products. This application uses the paid tier. Google&apos;s
              free tier does use prompts to improve their products, and is not used here.
            </li>
          </ul>
          <p className="mt-3">
            A request may fall back from Anthropic to Google if the Anthropic account runs out of credit or is rate
            limited, so either provider may see any of the data described above.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-[var(--tx)]">Retention and removal</h2>
          <p className="mt-2">
            Data is kept until the user deletes it. Access can be revoked at any time at{" "}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              myaccount.google.com/permissions
            </a>
            , which immediately ends Counsel&apos;s ability to read mail, send mail or create events. Stored tokens stop
            working at that moment.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-[var(--tx)]">Contact</h2>
          <p className="mt-2">
            Questions about this policy can be sent to the support address shown on the Google consent screen when
            connecting the application.
          </p>
        </section>
      </div>
    </div>
  );
}
