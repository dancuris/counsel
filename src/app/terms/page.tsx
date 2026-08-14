import type { Metadata } from "next";
import { PAGE_TITLE } from "@/lib/type";

export const metadata: Metadata = {
  title: "Terms of Service - Counsel",
  description: "Terms covering use of Counsel.",
};

/**
 * Public alongside the privacy policy, for the same reason: Google's crawler
 * has to be able to reach it, and it is not signed in.
 */
export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl py-10">
      <h1 className={PAGE_TITLE}>Terms of Service</h1>
      <p className="mt-1 text-sm text-[var(--tx-3)]">Last updated 5 August 2026</p>

      <div className="mt-8 space-y-6 text-[14px] leading-relaxed text-[var(--tx-2)]">
        <section>
          <h2 className="text-base font-semibold text-[var(--tx)]">Who this is for</h2>
          <p className="mt-2">
            Counsel is a private application built and operated by one individual for their own use. It is not a product, is
            not offered to the public, and is not available for sign-up. Access is limited to a single authorised Google
            account.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-[var(--tx)]">Acceptable use</h2>
          <p className="mt-2">
            Only the account holder may use it. Attempting to access it with any other account, or to access its data
            without authorisation, is not permitted.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-[var(--tx)]">Third-party services</h2>
          <p className="mt-2">
            Counsel relies on Google (Gmail, Calendar and the Gemini API), Anthropic (the Claude API), Vercel and Neon. Use of it is also
            subject to those providers&apos; own terms. It is not affiliated with or endorsed by any of them, nor by any
            employer whose job postings it stores.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-[var(--tx)]">No warranty</h2>
          <p className="mt-2">
            Counsel is provided as is, with no warranty of any kind. It generates text using a language model, and that
            output can be wrong: it should be read and corrected before being sent to anyone. The operator accepts no
            liability for any loss arising from its use, including from generated content, missed messages, or data
            loss.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-[var(--tx)]">Changes and termination</h2>
          <p className="mt-2">
            These terms may change at any time, and the application may be modified or shut down at any time, without
            notice. Since there is one user, that user is the person making those decisions.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-[var(--tx)]">Contact</h2>
          <p className="mt-2">
            Reachable at the support address shown on the Google consent screen when connecting the application.
          </p>
        </section>
      </div>
    </div>
  );
}
