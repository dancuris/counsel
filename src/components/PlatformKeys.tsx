import { platformCredentialStatuses } from "@/lib/credentials";
import { buttonClass, inputClass } from "@/lib/button";
import { SubmitButton } from "@/components/SubmitButton";
import { savePlatformKey, removePlatformKey } from "@/app/settings/actions";

/**
 * The two operator tokens, entered and shown the same way as the model keys.
 *
 * Where to get each one is stated on the row. A settings field that names a
 * credential and does not say where it comes from is a search somebody has to
 * do, and these two live in different consoles.
 */
const WHERE: Record<string, string> = {
  vercel: "vercel.com/account/tokens",
  neon: "console.neon.tech/app/settings/api-keys",
};

export async function PlatformKeys() {
  const credentials = await platformCredentialStatuses();

  return (
    <ul className="space-y-4">
      {credentials.map((credential) => (
        <li key={credential.kind}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-[13px] font-medium text-[var(--tx)]">{credential.label}</span>
            <span className="text-[11.5px] text-[var(--tx-3)]">
              {credential.configured
                ? `set${credential.hint ? ` · ends ${credential.hint}` : ""}${
                    credential.source === "environment" ? " · from the environment" : ""
                  }`
                : "not set"}
            </span>
          </div>
          <p className="mt-0.5 font-mono text-[11.5px] text-[var(--tx-3)]">{WHERE[credential.kind]}</p>

          {credential.source === "environment" ? (
            <p className="mt-2 text-[12px] text-[var(--tx-3)]">
              Set in this deployment&apos;s environment, so it cannot be changed from here.
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              <form action={savePlatformKey} className="flex flex-1 flex-wrap gap-2">
                <input type="hidden" name="kind" value={credential.kind} />
                <input
                  name="value"
                  type="password"
                  autoComplete="off"
                  placeholder={credential.configured ? "Replace it" : "Paste it here"}
                  className={`${inputClass("sm")} sm:max-w-[20rem]`}
                />
                <SubmitButton className={buttonClass("outline", "sm")} pendingLabel="Saving">
                  Save
                </SubmitButton>
              </form>
              {credential.configured && (
                <form action={removePlatformKey}>
                  <input type="hidden" name="kind" value={credential.kind} />
                  <SubmitButton className={buttonClass("quiet", "sm")} pendingLabel="Removing">
                    Remove
                  </SubmitButton>
                </form>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
