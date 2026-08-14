import { prisma } from "@/lib/prisma";
import { upstreamUrl, ACTIVE_STATUSES } from "@/lib/requests";
import { buttonClass } from "@/lib/button";
import { SubmitButton } from "@/components/SubmitButton";
import { PAGE_TITLE, PAGE_LEDE, PAGE_READING, PAGE_HEADER, SECTION_GAP, EMPTY_BLOCK } from "@/lib/type";
import { RequestForm } from "@/components/RequestForm";
import { decideRequest, deleteRequest } from "./actions";

export const dynamic = "force-dynamic";

/**
 * One route, two jobs, decided by configuration rather than by a flag.
 *
 * An instance with `UPSTREAM_URL` set reports to somebody, so this is a form
 * for asking them for something. An instance without one is the place requests
 * arrive, so this is the list of them. No deployment is ever both, and neither
 * version renders anything belonging to the other.
 */
export default async function RequestsPage() {
  const upstream = upstreamUrl();
  return upstream ? <AskPage upstream={upstream} /> : <TriagePage />;
}

/** On somebody else's instance: a way to ask for something. */
function AskPage({ upstream }: { upstream: string }) {
  const host = upstream.replace(/^https?:\/\//, "");
  return (
    <div className={PAGE_READING}>
      <header className={PAGE_HEADER}>
        <h1 className={PAGE_TITLE}>Ask for something</h1>
        <p className={PAGE_LEDE}>
          Missing something, or found something broken? This goes to whoever gave you this copy of Counsel.
        </p>
      </header>

      <div className="mb-6 rounded-xl border border-line-2 bg-[var(--surface-2)] p-4">
        <h2 className="text-[13px] font-semibold text-[var(--tx)]">What gets sent</h2>
        <p className="mt-1.5 max-w-[62ch] text-[13px] leading-relaxed text-[var(--tx-2)]">
          Only what you type below, and the name of this instance. Nothing about your job search travels with it:
          not your roles, not your contacts, not your documents, not your profile. This is the only thing in the
          whole app that sends anything anywhere.
        </p>
        <p className="mt-2 font-mono text-[12px] text-[var(--tx-3)]">Sent to {host}</p>
      </div>

      <RequestForm />
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  new: "not looked at",
  queued: "queued",
  approved: "approved",
  declined: "declined",
  done: "shipped",
};

const STATUS_COLOR: Record<string, string> = {
  new: "text-[var(--amber)]",
  queued: "text-[var(--tx-2)]",
  approved: "text-[var(--mint)]",
  declined: "text-[var(--tx-3)]",
  done: "text-[var(--mint)]",
};

/** On the operator's instance: what people have asked for. */
async function TriagePage() {
  const requests = await prisma.featureRequest.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }] });
  const waiting = requests.filter((r) => r.status === "new").length;
  const backlog = requests.filter((r) => ACTIVE_STATUSES.includes(r.status as "approved" | "queued")).length;

  return (
    <div className={PAGE_READING}>
      <header className={PAGE_HEADER}>
        <h1 className={PAGE_TITLE}>Requests</h1>
        <p className={PAGE_LEDE}>
          What people running your copies have asked for.{" "}
          {waiting > 0 ? `${waiting} not looked at yet` : "Nothing new"}, {backlog} in the backlog.
        </p>
      </header>

      {requests.length === 0 && (
        <p className={EMPTY_BLOCK}>
          Nothing yet. Requests arrive here from instances you have handed out, and you get an email when one does.
        </p>
      )}

      <ul className="space-y-3">
        {requests.map((request) => (
          <li key={request.id} className="rounded-xl border border-line bg-[var(--surface)] p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 className="text-[15px] font-semibold text-[var(--tx)]">{request.title}</h2>
              <span className={`text-[11.5px] ${STATUS_COLOR[request.status] ?? "text-[var(--tx-3)]"}`}>
                {STATUS_LABEL[request.status] ?? request.status}
              </span>
            </div>

            <p className="mt-0.5 text-[12px] text-[var(--tx-3)]">
              {request.requester ? `${request.requester} · ` : ""}
              {request.instance} · {request.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </p>

            <p className="mt-2 max-w-[62ch] whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--tx-2)]">
              {request.body}
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              {request.status !== "approved" && (
                <Decide id={request.id} status="approved" label="Approve" variant="primary" />
              )}
              {request.status !== "queued" && <Decide id={request.id} status="queued" label="Queue" variant="outline" />}
              {request.status !== "declined" && (
                <Decide id={request.id} status="declined" label="Decline" variant="quiet" />
              )}
              {request.status !== "done" && <Decide id={request.id} status="done" label="Shipped" variant="quiet" />}
              <form action={deleteRequest}>
                <input type="hidden" name="id" value={request.id} />
                <SubmitButton className={buttonClass("quiet", "sm")} pendingLabel="Deleting">
                  Delete
                </SubmitButton>
              </form>
            </div>
          </li>
        ))}
      </ul>

      <section className={`${SECTION_GAP} border-t border-line pt-6`}>
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--tx-3)]">How this reaches work</h2>
        <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-[var(--tx-2)]">
          Anything approved or queued is the backlog. Running{" "}
          <code className="font-mono text-[12px]">npx tsx --env-file=.env.local scripts/backlog.ts</code> prints it,
          and CLAUDE.md tells every session to read it before starting, so what you approve here turns up as work
          without you having to remember it.
        </p>
      </section>
    </div>
  );
}

function Decide({
  id,
  status,
  label,
  variant,
}: {
  id: string;
  status: string;
  label: string;
  variant: "primary" | "outline" | "quiet";
}) {
  return (
    <form action={decideRequest}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <SubmitButton className={buttonClass(variant, "sm")} pendingLabel={label}>
        {label}
      </SubmitButton>
    </form>
  );
}
