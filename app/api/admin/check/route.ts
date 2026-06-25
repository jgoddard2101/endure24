import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

// No-side-effect admin password check, used by the admin page to validate the
// password when unlocking edit mode (so a wrong password is caught up front).
export async function GET(req: NextRequest) {
  return isAdmin(req)
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
