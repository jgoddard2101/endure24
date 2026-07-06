import { NextResponse } from "next/server";
import { getClubRecap } from "@/lib/club";

export const dynamic = "force-dynamic";

// Cross-team club recap (reads all four schemas from the shared Neon DB).
export async function GET() {
  try {
    return NextResponse.json(await getClubRecap());
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
