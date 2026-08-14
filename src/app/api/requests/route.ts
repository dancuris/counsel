import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readRequest, notifyOfRequest } from "@/lib/requests";
import { recordFailure } from "@/lib/failures";

export const dynamic = "force-dynamic";

/**
 * Where a feature request from another instance arrives.
 *
 * Public by necessity: instances are separate deployments with separate
 * databases and no shared credentials, so there is nothing for a caller to
 * authenticate with. That shapes everything here.
 *
 * - **The instance name is a label, never an authorization.** Anyone can claim
 *   to be anyone. It is displayed and never used to decide anything.
 * - **Nothing is acted on automatically.** Every request lands as `new` and
 *   waits for a human. The endpoint cannot cause anything to happen.
 * - **Fields are truncated, not rejected**, so somebody's long paragraph still
 *   arrives while a megabyte does not.
 *
 * The worst an abuser achieves is rows in a list the operator can delete, which
 * is the right blast radius for an endpoint that has to be open.
 */
export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null);
  const parsed = readRequest(payload);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    await prisma.featureRequest.create({
      data: {
        instance: parsed.value.instance,
        requester: parsed.value.requester,
        title: parsed.value.title,
        body: parsed.value.body,
      },
    });
  } catch (error) {
    await recordFailure("requests.receive", error, { instance: parsed.value.instance });
    return NextResponse.json({ error: "Could not store that. Nothing was saved." }, { status: 500 });
  }

  // After the row is committed, and never allowed to fail the reply: the
  // request is safely recorded whether or not a mailbox was reachable.
  await notifyOfRequest(parsed.value);

  return NextResponse.json({ ok: true });
}
