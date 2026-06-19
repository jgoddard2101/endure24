import { NextResponse } from "next/server";
import { getDashboardState } from "@/lib/stats";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await getDashboardState();
    return NextResponse.json(state);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
