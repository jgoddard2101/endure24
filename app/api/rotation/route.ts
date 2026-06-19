import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/auth";
import { getEventConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Update the rotation and/or who is on course (admin).
 * Body:
 *   { order: string[] }                  -> new rotation order (runner ids)
 *   { currentRunnerId: string|null,      -> set/clear the on-course override
 *     onCourseSince?: string }           -> when they started (defaults to now)
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!isAdmin(req, body.password)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await getEventConfig(); // ensure the singleton exists

  if (Array.isArray(body.order)) {
    await prisma.$transaction(
      body.order.map((id: string, idx: number) =>
        prisma.runner.update({ where: { id }, data: { rotationPosition: idx } })
      )
    );
  }

  if ("currentRunnerId" in body) {
    const currentRunnerId: string | null = body.currentRunnerId ?? null;
    const onCourseSince = currentRunnerId
      ? body.onCourseSince
        ? new Date(body.onCourseSince)
        : new Date()
      : null;
    await prisma.eventConfig.update({
      where: { id: 1 },
      data: { currentRunnerId, onCourseSince },
    });
  }

  return NextResponse.json({ ok: true });
}
