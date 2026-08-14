"use client";

import { useActionState, useState } from "react";
import { buttonClass, inputClass } from "@/lib/button";
import { SubmitButton } from "@/components/SubmitButton";
import { provisionAction, updateAllAction, sendInvite, type ActionResult } from "@/app/instances/actions";

/**
 * Creating instances, and pushing a version to the ones that are behind.
 *
 * The update control is deliberately loud about how many instances it is about
 * to redeploy. Twenty instances is twenty of the hundred deployments allowed in
 * a day, and the difference between that being fine and being a problem is
 * entirely whether it was chosen.
 */

export type InstanceRow = {
  id: string;
  name: string;
  url: string;
  recipient: string | null;
  shortSha: string | null;
  commitHref: string | null;
  setupToken: string | null;
  behind: boolean;
  unknown: boolean;
  createdAt: string;
  updatedAt: string | null;
};

export function InstancesPanel({
  rows,
  canProvision,
  currentShortSha,
  behindCount,
}: {
  rows: InstanceRow[];
  canProvision: boolean;
  currentSha: string | null;
  currentShortSha: string | null;
  behindCount: number;
}) {
  const [created, provision] = useActionState<ActionResult | null, FormData>(provisionAction, null);
  const [updated, update] = useActionState<ActionResult | null, FormData>(updateAllAction, null);
  const [armed, setArmed] = useState(false);
  const [invited, invite] = useActionState<ActionResult | null, FormData>(sendInvite, null);

  return (
    <div>
      {/* Invite. Deliberately first: handing somebody a link so they own their
          own instance is the path that keeps their data out of your hands, and
          provisioning below is the one that does not. */}
      <form action={invite} className="rounded-xl border border-line bg-[var(--surface)] p-4">
        <h2 className="text-[15px] font-semibold text-[var(--tx)]">Invite somebody</h2>
        <p className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-[var(--tx-3)]">
          Emails them a link that sets up their own copy on their own accounts, with a database you have no
          credentials to. They accept the license terms when they claim it.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input name="name" placeholder="Their name (optional)" className={`${inputClass("md")} sm:max-w-[14rem]`} />
          <input
            name="email"
            type="email"
            required
            placeholder="Their email"
            className={`${inputClass("md")} sm:max-w-[16rem]`}
          />
          <SubmitButton className={buttonClass("primary", "md")} pendingLabel="Sending">
            Send invitation
          </SubmitButton>
        </div>
        {invited && (
          <p className={`mt-3 text-[12.5px] ${invited.ok ? "text-[var(--mint)]" : "text-[var(--danger)]"}`}>
            {invited.message}
          </p>
        )}
      </form>

      {/* Create */}
      {canProvision && (
        <form action={provision} className="mt-4 rounded-xl border border-line bg-[var(--surface)] p-4">
          <h2 className="text-[15px] font-semibold text-[var(--tx)]">Create one</h2>
          <p className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-[var(--tx-3)]">
            The name becomes the address, so pick something you will recognize later. It cannot be changed
            afterwards without breaking the link.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              name="name"
              required
              placeholder="counsel-alex"
              pattern="[a-z0-9][a-z0-9-]{1,60}"
              className={`${inputClass("md")} sm:max-w-[16rem]`}
            />
            <input
              name="recipient"
              type="email"
              placeholder="Who it is for (optional)"
              className={`${inputClass("md")} sm:max-w-[16rem]`}
            />
            <SubmitButton className={buttonClass("primary", "md")} pendingLabel="Creating">
              Create instance
            </SubmitButton>
          </div>
          {created && (
            <p className={`mt-3 text-[12.5px] ${created.ok ? "text-[var(--mint)]" : "text-[var(--danger)]"}`}>
              {created.message}
            </p>
          )}
        </form>
      )}

      {/* Update */}
      {rows.length > 0 && (
        <div className="mt-4 rounded-xl border border-line bg-[var(--surface)] p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold text-[var(--tx)]">
              {behindCount === 0 ? "Everything is current" : `${behindCount} behind`}
            </h2>
            <span className="font-mono text-[12px] text-[var(--tx-3)]">
              you are on {currentShortSha ?? "an unknown build"}
            </span>
          </div>

          {behindCount > 0 && !armed && (
            <>
              <p className="mt-1.5 max-w-[62ch] text-[12.5px] leading-relaxed text-[var(--tx-3)]">
                Nothing reaches these until you push it. Updating puts them on the version this deployment is
                running, which is the one you have actually been using.
              </p>
              <button type="button" onClick={() => setArmed(true)} className={buttonClass("primary", "md", "mt-3")}>
                Push {currentShortSha} to {behindCount}
              </button>
            </>
          )}

          {behindCount > 0 && armed && (
            <form action={update} className="mt-3">
              <p className="max-w-[62ch] text-[12.5px] leading-relaxed text-[var(--tx-2)]">
                This redeploys {behindCount} instance{behindCount === 1 ? "" : "s"}, which spends {behindCount} of
                your 100 daily deployments. Each one rebuilds and is briefly unavailable.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <SubmitButton className={buttonClass("primary", "md")} pendingLabel="Pushing">
                  Push to {behindCount}
                </SubmitButton>
                <button type="button" onClick={() => setArmed(false)} className={buttonClass("outline", "md")}>
                  Not now
                </button>
              </div>
            </form>
          )}

          {updated && (
            <p className={`mt-3 text-[12.5px] ${updated.ok ? "text-[var(--mint)]" : "text-[var(--danger)]"}`}>
              {updated.message}
            </p>
          )}
        </div>
      )}

      {/* The list */}
      {rows.length > 0 && (
        <ul className="mt-4 space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-xl border border-line bg-[var(--surface)] p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="text-[14px] font-semibold text-[var(--tx)]">{row.name}</h3>
                <span className="text-[11.5px]">
                  {row.unknown ? (
                    <span className="text-[var(--tx-3)]">version unknown</span>
                  ) : row.behind ? (
                    <span className="text-[var(--amber)]">behind</span>
                  ) : (
                    <span className="text-[var(--mint)]">current</span>
                  )}
                </span>
              </div>

              <a
                href={row.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 block text-[12.5px] text-accent hover:underline"
              >
                {row.url}
              </a>

              <p className="mt-1.5 text-[12px] text-[var(--tx-3)]">
                {row.recipient ? `For ${row.recipient} · ` : ""}
                {row.commitHref && row.shortSha ? (
                  <>
                    on{" "}
                    <a href={row.commitHref} target="_blank" rel="noopener noreferrer" className="font-mono hover:underline">
                      {row.shortSha}
                    </a>
                  </>
                ) : (
                  "no version recorded"
                )}
              </p>

              {row.setupToken && (
                <p className="mt-2 break-all font-mono text-[11.5px] text-[var(--tx-2)]">
                  <span className="font-sans text-[var(--tx-3)]">Setup token: </span>
                  {row.setupToken}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
