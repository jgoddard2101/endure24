import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Public roster (no tokens exposed).
export async function GET() {
  const runners = await prisma.runner.findMany({ orderBy: { rotationPosition: "asc" } });
  return NextResponse.json(
    runners.map((r) => ({
      id: r.id,
      name: r.name,
      rotationPosition: r.rotationPosition,
      authorized: Boolean(r.refreshToken),
      active: r.active,
    }))
  );
}

// Add a runner to the roster (admin).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!isAdmin(req, body.password)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!body.name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const count = await prisma.runner.count();
  const runner = await prisma.runner.create({
    data: { name: String(body.name), rotationPosition: count },
  });
  return NextResponse.json({ id: runner.id });
}

// Update a runner's name / active flag (admin).
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!isAdmin(req, body.password)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const data: { name?: string; active?: boolean } = {};
  if (typeof body.name === "string") data.name = body.name;
  if (typeof body.active === "boolean") data.active = body.active;
  await prisma.runner.update({ where: { id: body.id }, data });
  return NextResponse.json({ ok: true });
}

// Remove a runner (admin).
export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!isAdmin(req, body.password)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await prisma.runner.delete({ where: { id: body.id } });
  return NextResponse.json({ ok: true });
}
