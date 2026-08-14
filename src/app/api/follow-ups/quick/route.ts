import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Turning "hold off until day 10" into something that will actually happen.
 *
 * Ask could already act on advice that said write now. Advice that said wait had
 * no action at all, so following it depended on Dan remembering, and the point
 * of this app is that nothing depends on that.
 *
 * Deliberately thin: it only creates a follow-up. The date is computed by the
 * caller from the same cadence the advice used, so the reminder and the
 * recommendation cannot disagree.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const applicationId = typeof body?.applicationId === "string" ? body.applicationId : "";
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  const dueDate = typeof body?.dueDate === "string" ? new Date(body.dueDate) : null;

  if (!applicationId || !note) {
    return NextResponse.json({ error: "applicationId and note are required." }, { status: 400 });
  }
  if (dueDate && Number.isNaN(dueDate.getTime())) {
    return NextResponse.json({ error: "That date could not be read." }, { status: 400 });
  }

  const app = await prisma.jobApplication.findFirst({
    where: { id: applicationId, deletedAt: null },
    select: { id: true },
  });
  if (!app) return NextResponse.json({ error: "Role not found." }, { status: 404 });

  // A second identical reminder on the same day is a double-click, not a
  // second intention.
  const existing = dueDate
    ? await prisma.followUp.findFirst({
        where: {
          applicationId,
          completed: false,
          note,
          dueDate: {
            gte: new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate()),
            lt: new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate() + 1),
          },
        },
        select: { id: true },
      })
    : null;
  if (existing) return NextResponse.json({ id: existing.id, alreadyExisted: true });

  const created = await prisma.followUp.create({ data: { applicationId, note, dueDate } });

  revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/follow-ups");
  revalidatePath("/");

  return NextResponse.json({ id: created.id, alreadyExisted: false });
}
