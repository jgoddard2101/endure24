import { NextRequest, NextResponse } from "next/server";
import { sendToRunner } from "@/lib/push";

export const dynamic = "force-dynamic";

// Send a test push to the given runner's devices (used by the "enable" UI to
// confirm notifications work). Body: { runnerId }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.runnerId) return NextResponse.json({ error: "runnerId required" }, { status: 400 });

  const devices = await sendToRunner(body.runnerId, {
    title: "🔔 Notifications are on",
    body: "You'll get a heads-up here about 15 min before you're up.",
    url: "/",
  });
  return NextResponse.json({ ok: true, devices });
}
