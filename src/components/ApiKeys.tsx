import { credentialStatuses } from "@/lib/credentials";
import { saveApiKey, removeApiKey } from "@/app/settings/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass, inputClass } from "@/lib/button";
import { EMPTY_INLINE } from "@/lib/type";

/**
 * Where somebody supplies their own model keys.
 *
 * This is what turns the stand-alone deployment from an architecture into
 * something a person can actually set up. Until now an instance was configured
 * the way a developer configures things - `vercel env add` - which is fine for
 * the one person who built it and impossible for anyone he hands it to.
 *
 * Three things it has to get right:
 *
 * - **Never show a key back.** The field is always empty on load and the status
 *   line shows the last four characters only. A key you can read off the screen
 *   is a key that ends up in a screenshot.
 * - **Say which source is winning.** An environment variable takes precedence
 *   over anything entered here, and a form that silently does nothing because a
 *   deployment setting overrides it is the worst kind of control.
 * - **Absence is normal, not an error.** Someone setting this up has neither
 *   key at first, and the page should read as a setup step rather than a fault.
 */
export async function ApiKeys() {
  const statuses = await credentialStatuses();
  const none = statuses.every((s) => !s.configured);

  return (
    <div>
      {none && (
        <p className={`${EMPTY_INLINE} mb-4`}>
          No model provider is configured yet, so evaluation, drafting and document generation are unavailable.
          Adding either key switches them on. Anthropic is the default; Gemini is used automatically when Anthropic
          is unavailable, and is a free tier for most usage.
        </p>
      )}

      <div className="space-y-5">
        {statuses.map((s) => (
          <div key={s.kind} className="border-t border-line pt-4 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[13px] font-medium text-[var(--tx)]">{s.label}</span>
              <span className="text-[11.5px] text-[var(--tx-3)]">
                {s.configured ? (
                  <>
                    <span className="text-[var(--mint)]">configured</span> {s.hint}
                    {s.source === "environment" && " · set as an environment variable"}
                  </>
                ) : (
                  "not set"
                )}
              </span>
            </div>

            {s.source === "environment" ? (
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--tx-3)]">
                This deployment sets it in the environment, which takes precedence over anything entered here.
                Remove the variable to manage it from this page instead.
              </p>
            ) : (
              <form action={saveApiKey} className="mt-2 flex flex-wrap items-center gap-2">
                <input type="hidden" name="kind" value={s.kind} />
                <input
                  type="password"
                  name="value"
                  autoComplete="off"
                  placeholder={s.configured ? "Replace with a new key" : "Paste the key"}
                  className={`min-w-0 flex-1 ${inputClass("sm")}`}
                />
                <SubmitButton className={buttonClass("primary", "sm")} pendingLabel="Saving...">
                  Save
                </SubmitButton>
              </form>
            )}

            {s.configured && s.source === "settings" && (
              <form action={removeApiKey} className="mt-2">
                <input type="hidden" name="kind" value={s.kind} />
                <SubmitButton className={buttonClass("quiet", "sm")} pendingLabel="Removing...">
                  Remove this key
                </SubmitButton>
              </form>
            )}
          </div>
        ))}
      </div>

      <p className="mt-4 border-t border-line pt-3 text-[11.5px] leading-relaxed text-[var(--tx-3)]">
        Keys are encrypted before they are stored, under a key held only in this deployment&apos;s environment, and
        are never shown again once saved. Rotating the deployment&apos;s session secret makes them unreadable and
        they would need re-entering.
      </p>
    </div>
  );
}
