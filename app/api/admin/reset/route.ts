import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Clear all lap data (admin) — for wiping test data before the real event.
 * Deletes every lap, clears the on-course override, and resets notification
 * cooldowns. Runners, Strava links and push subscriptions are kept.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!isAdmin(req, body.password)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { count } = await prisma.lap.deleteMany();
  await prisma.eventConfig.updateMany({ where: { id: 1 }, data: { currentRunnerId: null, onCourseSince: null } });
  await prisma.runner.updateMany({ data: { lastNotifiedAt: null } });

  return NextResponse.json({ ok: true, deletedLaps: count });
}
