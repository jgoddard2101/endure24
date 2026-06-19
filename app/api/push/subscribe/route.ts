import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Store (or update) a browser push subscription for a runner.
 * Body: { runnerId, subscription: PushSubscriptionJSON }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const runnerId: string | undefined = body.runnerId;
  const sub = body.subscription;
  if (!runnerId || !sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return NextResponse.json({ error: "runnerId and a valid subscription are required" }, { status: 400 });
  }

  // Endpoint is unique; re-subscribing (or switching who you are) updates the row.
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { runnerId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    update: { runnerId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });

  return NextResponse.json({ ok: true });
}

// Remove a subscription by endpoint (when a runner disables notifications).
export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  await prisma.pushSubscription.deleteMany({ where: { endpoint: body.endpoint } });
  return NextResponse.json({ ok: true });
}
