"use client";

import { useActionState } from "react";
import { buttonClass, inputClass } from "@/lib/button";
import { SubmitButton } from "@/components/SubmitButton";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-rules";
import { changePassword } from "@/app/settings/actions";

/**
 * Changing the password on an instance that was claimed from the web.
 *
 * The result is shown rather than assumed. A password form that clears itself
 * and says nothing is the same fault as the contact form that saved silently
 * and read as a broken button, except worse: here "did that work" is a
 * question about whether you can still get in tomorrow.
 */
export function PasswordSection({ email }: { email: string }) {
  const [message, action] = useActionState(changePassword, null);
  const failed = Boolean(message && message !== "Password changed.");

  return (
    <form action={action} className="mt-3 panel p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-[var(--tx)]">Password</h2>
      <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-[var(--tx-2)]">
        You sign in as {email}. Changing this does not sign you out anywhere, so if you are rotating it because it may
        have been seen, sign out of your other browsers afterwards.
      </p>

      <div className="mt-4 flex max-w-xs flex-col gap-2">
        <input
          type="password"
          name="current"
          required
          autoComplete="current-password"
          placeholder="Current password"
          className={inputClass("md")}
        />
        <input
          type="password"
          name="next"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          placeholder={`New password, at least ${MIN_PASSWORD_LENGTH} characters`}
          className={inputClass("md")}
        />
        <SubmitButton className={buttonClass("outline", "md")} pendingLabel="Changing">
          Change password
        </SubmitButton>
      </div>

      {message && (
        <p className={`mt-3 text-[12.5px] ${failed ? "text-[var(--danger)]" : "text-[var(--mint)]"}`}>{message}</p>
      )}
    </form>
  );
}
