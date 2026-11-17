"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { seal } from "@/lib/secrets";
import { getLiveVersion } from "@/lib/release";
import { recordFailure } from "@/lib/failures";
import { nameProblem, platformKeys, provisionInstance, updateInstance } from "@/lib/provision";
import { buildInvitation } from "@/lib/invite";
import { sendViaMailbox as sendMail } from "@/lib/mail-provider";

/**
 * Handing out instances, and keeping them up to date afterwards.
 *
 * The second half is the part that needed designing. Instances are created
 * with no git link, so nothing reaches them until somebody says so, and this is
 * where somebody says so.
 */

/**
 * The commit to put everybody on: whatever this deployment is running.
 *
 * Not the newest commit in the repository, and not the tip of `production`.
 * The version serving this page is the one that has actually been used rather
 * than merely built, which is the only meaningful definition of "known good"
 * available here.
 */
export async function currentSha(): Promise<string | null> {
  return getLiveVersion().sha ?? null;
}

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

export async function provisionAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const name = String(formData.get("name") ?? "").trim().toLowerCase();
  const recipient = String(formData.get("recipient") ?? "").trim() || null;

  const problem = nameProblem(name);
  if (problem) return { ok: false, message: problem };

  const existing = await prisma.provisionedInstance.findUnique({ where: { name } });
  if (existing) return { ok: false, message: `There is already an instance called ${name}.` };

  const { keys, missing } = await platformKeys();
  if (!keys) return { ok: false, message: `Add the ${missing.join(" and ")} in Settings first.` };

  try {
    const result = await provisionInstance({ name, recipient: recipient ?? undefined }, keys);
    await prisma.provisionedInstance.create({
      data: {
        name: result.name,
        url: result.url,
        recipient,
        // Sealed, like a model key. It is the only thing standing between an
        // unclaimed URL and whoever finds it.
        sealedToken: result.setupToken ? seal(result.setupToken) : null,
        vercelId: result.vercelId,
        deploymentId: result.deploymentId,
        sha: result.sha,
      },
    });
    revalidatePath("/instances");
    return { ok: true, message: `${name} is building. It takes a couple of minutes.` };
  } catch (error) {
    await recordFailure("instances.provision", error, { name });
    return { ok: false, message: error instanceof Error ? error.message : "That did not work." };
  }
}

/**
 * Brings instances onto the commit this deployment is running.
 *
 * Deliberately one call per instance rather than anything clever: they are
 * independent deployments and one failing must not stop the rest. The report
 * says how many moved, because "some of them" is the honest answer when one
 * fails and a summary that hid it would be worse than the failure.
 */
export async function updateAllAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const only = String(formData.get("only") ?? "").trim() || null;

  const sha = await currentSha();
  if (!sha) {
    return { ok: false, message: "This deployment does not know its own commit, so there is nothing to push." };
  }

  const { keys, missing } = await platformKeys();
  if (!keys) return { ok: false, message: `Add the ${missing.join(" and ")} in Settings first.` };

  const instances = await prisma.provisionedInstance.findMany({
    where: only ? { name: only } : { NOT: { sha } },
  });
  if (instances.length === 0) return { ok: true, message: "Everything is already on this version." };

  let moved = 0;
  const failures: string[] = [];
  for (const instance of instances) {
    try {
      const deployment = await updateInstance(instance, sha, keys);
      await prisma.provisionedInstance.update({
        where: { id: instance.id },
        data: { sha, deploymentId: deployment.id, updatedAt: new Date() },
      });
      moved += 1;
    } catch (error) {
      await recordFailure("instances.update", error, { name: instance.name });
      failures.push(instance.name);
    }
  }

  revalidatePath("/instances");
  if (failures.length === 0) {
    return { ok: true, message: `${moved} instance${moved === 1 ? "" : "s"} building on ${sha.slice(0, 7)}.` };
  }
  return {
    ok: false,
    message: `${moved} updated, ${failures.length} failed: ${failures.join(", ")}. The failures are unchanged, so retrying is safe.`,
  };
}

/** Forgets an instance here. It does not delete the deployment or its data. */
export async function forgetInstance(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (id) await prisma.provisionedInstance.delete({ where: { id } }).catch(() => null);
  revalidatePath("/instances");
}

/**
 * Emails somebody an invitation to set up their own instance.
 *
 * Sending is the one thing here that reaches a real person, so it goes through
 * `sendMail`, which refuses in demo mode, and it reports what happened rather
 * than clearing the form and hoping.
 */
export async function sendInvite(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const to = String(formData.get("email") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim() || null;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return { ok: false, message: "That does not look like an email address." };
  }

  const invitation = buildInvitation(name);
  try {
    await sendMail({ to, subject: invitation.subject, body: invitation.body });
  } catch (error) {
    await recordFailure("instances.invite", error, { to });
    return { ok: false, message: error instanceof Error ? error.message : "That did not send." };
  }
  return { ok: true, message: `Invitation sent to ${to}.` };
}
