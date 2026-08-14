"use client";

import { useActionState } from "react";
import { buttonClass, inputClass } from "@/lib/button";
import { SubmitButton } from "@/components/SubmitButton";
import { submitRequest, type SendResult } from "@/app/requests/actions";

/**
 * Asking for something, on an instance that reports to somebody.
 *
 * The outcome is stated rather than assumed. This posts to another deployment
 * over the network, which can fail in ways nothing local can, and a form that
 * clears itself on failure would lose what somebody wrote and tell them it went.
 */
export function RequestForm() {
  const [result, send] = useActionState<SendResult | null, FormData>(submitRequest, null);

  return (
    <form action={send} className="flex flex-col gap-4">
      <div>
        <label className="block text-[12.5px] font-medium text-[var(--tx)]" htmlFor="title">
          In one line, what do you want?
        </label>
        <input id="title" name="title" required maxLength={200} placeholder="Let me tag roles by priority" className={`mt-2 ${inputClass("md")}`} />
      </div>

      <div>
        <label className="block text-[12.5px] font-medium text-[var(--tx)]" htmlFor="body">
          What would it do, and why do you want it?
        </label>
        <p className="mt-1 max-w-[62ch] text-[12px] leading-relaxed text-[var(--tx-3)]">
          What you are trying to do matters more than how you think it should work. Say what is awkward now.
        </p>
        <textarea id="body" name="body" required rows={7} maxLength={4000} className={`mt-2 ${inputClass("md")}`} />
      </div>

      <div>
        <label className="block text-[12.5px] font-medium text-[var(--tx)]" htmlFor="requester">
          Your name or email, so they can come back to you
        </label>
        <input id="requester" name="requester" maxLength={200} placeholder="Optional" className={`mt-2 ${inputClass("md")}`} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton className={buttonClass("primary", "md")} pendingLabel="Sending">
          Send it
        </SubmitButton>
        {result && (
          <span className={`text-[12.5px] ${result.ok ? "text-[var(--mint)]" : "text-[var(--danger)]"}`}>
            {result.message}
          </span>
        )}
      </div>
    </form>
  );
}
