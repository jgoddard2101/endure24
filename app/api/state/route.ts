import { NextResponse } from "next/server";
import { getDashboardState } from "@/lib/stats";
import { notifyDueRunners } from "@/lib/notify";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await getDashboardState();
    // Opportunistic "you're up soon" check — cheap unless a runner is actually
    // due, and idempotent (atomic cooldown), so concurrent polls are safe.
    // This keeps notifications flowing whenever the dashboard is open, with the
    // /api/cron/notify endpoint available for 24/7 external-cron coverage.
    try {
      await notifyDueRunners(state);
    } catch (e) {
      console.error("[state] notify check failed", e);
    }
    return NextResponse.json(state);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
