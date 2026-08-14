import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { unseal } from "@/lib/secrets";
import { commitUrl } from "@/lib/release";
import { platformCredentialStatuses } from "@/lib/credentials";
import { platformKeys } from "@/lib/provision";
import { PAGE_TITLE, PAGE_LEDE, PAGE_READING, PAGE_HEADER, SECTION_GAP, EMPTY_BLOCK } from "@/lib/type";
import { InstancesPanel } from "@/components/InstancesPanel";
import { currentSha } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Instances handed to other people, and whether they are current.
 *
 * This page exists because pinning instances to a commit only works if there is
 * somewhere that says which commit each one is on. Without it, "nothing reaches
 * them until you say so" just means everybody quietly runs whatever they were
 * given months ago.
 *
 * It is an operator page, not part of the job search, which is why it sits
 * beside Settings rather than in the nav.
 */
export default async function InstancesPage() {
  const [instances, credentials, keys, sha] = await Promise.all([
    prisma.provisionedInstance.findMany({ orderBy: { createdAt: "desc" } }),
    platformCredentialStatuses(),
    platformKeys(),
    currentSha(),
  ]);

  const rows = instances.map((instance) => ({
    id: instance.id,
    name: instance.name,
    url: instance.url,
    recipient: instance.recipient,
    sha: instance.sha,
    shortSha: instance.sha ? instance.sha.slice(0, 7) : null,
    commitHref: instance.sha ? commitUrl(instance.sha) : null,
    // Unsealed for display: the whole point of storing it is that the invite
    // can be re-read when the tab was closed.
    setupToken: instance.sealedToken ? unseal(instance.sealedToken) : null,
    behind: Boolean(sha && instance.sha && instance.sha !== sha),
    unknown: !instance.sha,
    createdAt: instance.createdAt.toISOString(),
    updatedAt: instance.updatedAt?.toISOString() ?? null,
  }));

  const behind = rows.filter((r) => r.behind).length;

  return (
    <div className={PAGE_READING}>
      <header className={PAGE_HEADER}>
        <h1 className={PAGE_TITLE}>Instances</h1>
        <p className={PAGE_LEDE}>
          Copies of Counsel running for other people. Each one has its own database and its own keys, and none of
          them change until you push an update here.
        </p>
      </header>

      {!keys.keys && (
        <div className="mb-8 rounded-xl border border-line-2 bg-[var(--surface-2)] p-4">
          <h2 className="text-[15px] font-semibold text-[var(--tx)]">Not set up yet</h2>
          <p className="mt-1.5 max-w-[62ch] text-[13px] leading-relaxed text-[var(--tx-2)]">
            Creating an instance needs a {keys.missing.join(" and a ")}. Add them in{" "}
            <Link href="/settings" className="underline hover:text-[var(--tx)]">
              Settings
            </Link>
            . They are encrypted before they are stored, like the model keys.
          </p>
          <ul className="mt-3 space-y-1">
            {credentials.map((credential) => (
              <li key={credential.kind} className="text-[12.5px] text-[var(--tx-3)]">
                {credential.label}: {credential.configured ? "set" : "missing"}
              </li>
            ))}
          </ul>
        </div>
      )}

      <InstancesPanel
        rows={rows}
        canProvision={Boolean(keys.keys)}
        currentSha={sha}
        currentShortSha={sha ? sha.slice(0, 7) : null}
        behindCount={behind}
      />

      {rows.length === 0 && <p className={`${SECTION_GAP} ${EMPTY_BLOCK}`}>Nothing handed out yet.</p>}

      <section className={`${SECTION_GAP} border-t border-line pt-6`}>
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--tx-3)]">
          What this costs you
        </h2>
        <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-[var(--tx-2)]">
          Every instance is a real Vercel project and a real Neon database on your accounts. The free tiers cap that
          at 100 databases and 100 deployments a day, and updating twenty instances spends twenty of those
          deployments. Vercel&apos;s Hobby plan is also non-commercial: handing copies to people for free is within
          it, charging for them is not.
        </p>
        <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-[var(--tx-2)]">
          The version that scales instead has people deploy on their own accounts, which costs you nothing and needs
          the repository to be public.
        </p>
      </section>
    </div>
  );
}
