import { NextRequest, NextResponse } from "next/server";
import { getAuthorizeUrl } from "@/lib/strava";

export const dynamic = "force-dynamic";

// Sends the runner to Strava's consent screen. Pass ?runner=<id> to link the
// authorization to a specific roster entry.
export async function GET(req: NextRequest) {
  const runnerId = req.nextUrl.searchParams.get("runner") ?? undefined;
  return NextResponse.redirect(getAuthorizeUrl(runnerId));
}
