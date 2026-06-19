import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/config";
import { getValidAccessToken, getActivity } from "@/lib/strava";
import { ingestActivity } from "@/lib/laps";

export const dynamic = "force-dynamic";

// Strava webhook subscription validation handshake.
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === env.stravaWebhookVerifyToken) {
    return NextResponse.json({ "hub.challenge": challenge });
  }
  return NextResponse.json({ error: "verification failed" }, { status: 403 });
}

// Strava posts here when an authorized athlete creates/updates/deletes activity.
export async function POST(req: NextRequest) {
  let event: {
    object_type?: string;
    object_id?: number;
    aspect_type?: string;
    owner_id?: number;
  };
  try {
    event = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  // Acknowledge non-activity / non-create events immediately.
  if (event.object_type !== "activity" || event.aspect_type !== "create" || !event.owner_id || !event.object_id) {
    return NextResponse.json({ ok: true });
  }

  try {
    const runner = await prisma.runner.findUnique({
      where: { stravaAthleteId: BigInt(event.owner_id) },
    });
    if (runner) {
      const accessToken = await getValidAccessToken(runner);
      const activity = await getActivity(accessToken, event.object_id);
      const result = await ingestActivity(runner.id, activity);
      console.log(`[webhook] ${runner.name} activity ${event.object_id}: ${result.status} ${result.reason ?? ""}`);
    }
  } catch (err) {
    // Always 200 so Strava doesn't disable the subscription; log for debugging.
    console.error("[webhook] processing error", err);
  }

  return NextResponse.json({ ok: true });
}
