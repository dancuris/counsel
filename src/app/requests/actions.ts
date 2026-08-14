"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { isRequestStatus, sendUpstream } from "@/lib/requests";

/**
 * Two sides of the same page, deliberately in one file.
 *
 * An instance either reports to somebody (it can send) or is reported to (it
 * can decide), and which one it is depends on whether `UPSTREAM_URL` is set.
 * Keeping both here means the pair is read together, since the second is
 * meaningless without the first.
 */

export type SendResult = { ok: true; message: string } | { ok: false; message: string };

/** Sends a request upstream. Only the words typed here leave this instance. */
export async function submitRequest(_prev: SendResult | null, formData: FormData): Promise<SendResult> {
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const requester = String(formData.get("requester") ?? "").trim() || null;

  if (!title) return { ok: false, message: "Give it a one-line summary." };
  if (!body) return { ok: false, message: "Say a bit more about what you want." };

  const result = await sendUpstream(title, body, requester);
  if (!result.ok) return { ok: false, message: result.error ?? "That did not send." };
  return { ok: true, message: "Sent. You will see it here if it gets built." };
}

/** Approve, queue, decline, or mark shipped. */
export async function decideRequest(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !isRequestStatus(status)) return;

  await prisma.featureRequest.update({
    where: { id },
    data: { status, decidedAt: new Date() },
  });
  revalidatePath("/requests");
}

export async function deleteRequest(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (id) await prisma.featureRequest.delete({ where: { id } }).catch(() => null);
  revalidatePath("/requests");
}
