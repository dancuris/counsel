"use client";

import { useActionState } from "react";
import { buttonClass, inputClass } from "@/lib/button";
import { SubmitButton } from "@/components/SubmitButton";
import { connectFastmailAction } from "@/app/settings/actions";

/**
 * Pasting a Fastmail API token.
 *
 * The outcome is shown, never assumed: the action verifies the token against
 * Fastmail first and says exactly what it can do, including the case that
 * matters most, a token that reads but cannot send. The field is always empty
 * on load, like a model key, so a token never sits on screen to be captured.
 */
export function FastmailConnect({ replacing }: { replacing: boolean }) {
  const [result, action] = useActionState(connectFastmailAction, null);

  return (
    <form action={action} className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="password"
          name="token"
          required
          autoComplete="off"
          placeholder={replacing ? "Replace with a new API token" : "Paste a Fastmail API token"}
          className={`min-w-0 flex-1 ${inputClass("sm")}`}
        />
        <SubmitButton className={buttonClass(replacing ? "outline" : "primary", "sm")} pendingLabel="Checking...">
          {replacing ? "Replace" : "Connect Fastmail"}
        </SubmitButton>
      </div>
      {result && (
        <p className={`mt-2 text-[12.5px] ${result.ok ? "text-[var(--mint)]" : "text-[var(--danger)]"}`}>
          {result.message}
        </p>
      )}
    </form>
  );
}
