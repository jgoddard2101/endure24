import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Public roster (no tokens exposed). Includes inactive (dropped-out) runners so
// the admin page can show them separately with a re-add option.
export async function GET() {
  const runners = await prisma.runner.findMany({
    orderBy: { rotationPosition: "asc" },
    include: { _count: { select: { laps: true } } },
  });
  return NextResponse.json(
    runners.map((r) => ({
      id: r.id,
      name: r.name,
      rotationPosition: r.rotationPosition,
      authorized: Boolean(r.refreshToken),
      active: r.active,
      estimatedLapSeconds: r.estimatedLapSeconds ?? null,
      // Whether they have any recorded laps — once true, the estimate is ignored
      // (actual average takes over) so the admin UI locks the estimate field.
      hasLaps: r._count.laps > 0,
    }))
  );
}

// Add a runner to the roster. Open endpoint (passwordless race-day control).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const count = await prisma.runner.count();
  const runner = await prisma.runner.create({
    data: { name: String(body.name), rotationPosition: count },
  });
  return NextResponse.json({ id: runner.id });
}

// Update a runner's name / active flag / estimate. Open endpoint. Deactivating
// (active:false) is how a drop-out is removed from the rotation while keeping
// their completed laps in the team total.
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const data: { name?: string; active?: boolean; estimatedLapSeconds?: number | null } = {};
  if (typeof body.name === "string") data.name = body.name;
  if (typeof body.active === "boolean") data.active = body.active;
  // estimatedLapSeconds: number to set, null to clear.
  if ("estimatedLapSeconds" in body) {
    data.estimatedLapSeconds =
      body.estimatedLapSeconds == null ? null : Math.max(1, Math.round(Number(body.estimatedLapSeconds)));
  }
  await prisma.runner.update({ where: { id: body.id }, data });

  // If we just deactivated whoever was the on-course override, clear it so the
  // dashboard doesn't point at a runner who's no longer in the rotation.
  if (body.active === false) {
    await prisma.eventConfig.updateMany({
      where: { id: 1, currentRunnerId: body.id },
      data: { currentRunnerId: null, onCourseSince: null },
    });
  }
  return NextResponse.json({ ok: true });
}

// Hard-delete a runner and ALL their laps (cascade) — destructive roster wipe,
// kept behind the admin password (advanced). Use deactivate for drop-outs.
export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!isAdmin(req, body.password)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await prisma.runner.delete({ where: { id: body.id } });
  return NextResponse.json({ ok: true });
}
