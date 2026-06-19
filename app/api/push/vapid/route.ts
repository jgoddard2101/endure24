import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Public VAPID key the browser needs to create a push subscription.
export async function GET() {
  return NextResponse.json({ publicKey: process.env.VAPID_PUBLIC_KEY ?? null });
}
