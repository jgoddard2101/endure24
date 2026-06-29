import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/auth";
import { getEventConfig, METERS_PER_MILE } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Manually record a lap (admin) — backup for when a runner's watch dies or
 * Strava upload fails. Body: { runnerId, minutes, seconds?, miles?, startedAt? }
 */
export async function POST(req: NextRequest) {
  // Open endpoint: manual laps are part of passwordless race-day control.
  const body = await req.json().catch(() => ({}));
  if (!body.runnerId) return NextResponse.json({ error: "runnerId required" }, { status: 400 });

  const config = await getEventConfig();
  const seconds = Number(body.minutes ?? 0) * 60 + Number(body.seconds ?? 0);
  if (!seconds) return NextResponse.json({ error: "lap time required" }, { status: 400 });

  // Number of laps this entry represents (e.g. a manually-logged double lap).
  const laps = Math.max(1, Math.round(Number(body.laps ?? 1)));
  // Distance defaults to laps × the configured lap distance.
  const miles = body.miles != null ? Number(body.miles) : config.lapDistanceMiles * laps;
  // Timestamp priority: explicit start time → derive from a given finish time →
  // assume the runner is finishing about now (now − lap duration).
  const startedAt = body.startedAt
    ? new Date(body.startedAt)
    : body.finishedAt
      ? new Date(new Date(body.finishedAt).getTime() - seconds * 1000)
      : new Date(Date.now() - seconds * 1000);

  const lap = await prisma.lap.create({
    data: {
      runnerId: body.runnerId,
      distanceMeters: miles * METERS_PER_MILE,
      movingTimeSec: seconds,
      elapsedTimeSec: seconds,
      laps,
      startedAt,
      source: "manual",
    },
  });

  // Auto-advance the rotation if this runner was the on-course override.
  if (config.currentRunnerId === body.runnerId) {
    await prisma.eventConfig.update({
      where: { id: 1 },
      data: { currentRunnerId: null, onCourseSince: null },
    });
  }

  return NextResponse.json({ id: lap.id });
}

// Delete a lap (admin) — to fix a mistaken/duplicate entry.
export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!isAdmin(req, body.password)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await prisma.lap.delete({ where: { id: body.id } });
  return NextResponse.json({ ok: true });
}
