import { NextResponse } from "next/server";
import { getEventSummary } from "@/lib/stats";

export const dynamic = "force-dynamic";

// Post-event recap (team totals, awards, leaderboard). Read-only; no notify.
export async function GET() {
  try {
    return NextResponse.json(await getEventSummary());
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
