import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/auth";
import { getEventConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

// Current event settings (used to prefill the admin form).
export async function GET() {
  const c = await getEventConfig();
  return NextResponse.json({
    eventName: c.eventName,
    teamName: c.teamName,
    startAt: c.startAt.toISOString(),
    durationHours: c.durationHours,
    lapDistanceMiles: c.lapDistanceMiles,
  });
}

// Update event settings (admin): name, team, start time, duration, lap distance.
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!isAdmin(req, body.password)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await getEventConfig();
  const data: Record<string, unknown> = {};
  if (typeof body.eventName === "string") data.eventName = body.eventName;
  if (typeof body.teamName === "string") data.teamName = body.teamName;
  if (body.startAt) data.startAt = new Date(body.startAt);
  if (body.durationHours != null) data.durationHours = Number(body.durationHours);
  if (body.lapDistanceMiles != null) data.lapDistanceMiles = Number(body.lapDistanceMiles);

  await prisma.eventConfig.update({ where: { id: 1 }, data });
  return NextResponse.json({ ok: true });
}
