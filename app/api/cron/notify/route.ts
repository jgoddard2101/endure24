import { NextRequest, NextResponse } from "next/server";
import { runNotifyCheck } from "@/lib/notify";

export const dynamic = "force-dynamic";

/**
 * Runs the "you're up soon" notification check. Called every minute by Vercel
 * Cron (which sends `Authorization: Bearer $CRON_SECRET`) or an external cron
 * pinger using `?key=$CRON_SECRET`.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    const key = req.nextUrl.searchParams.get("key");
    if (auth !== `Bearer ${secret}` && key !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const notified = await runNotifyCheck();
    return NextResponse.json({ ok: true, notified });
  } catch (err) {
    console.error("[cron/notify]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
