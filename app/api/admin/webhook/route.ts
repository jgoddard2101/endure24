import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import {
  listWebhookSubscriptions,
  createWebhookSubscription,
  deleteWebhookSubscription,
} from "@/lib/strava";

export const dynamic = "force-dynamic";

// Inspect the current Strava webhook subscription (admin).
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await listWebhookSubscriptions());
}

// Create the webhook subscription pointing at this app (admin). Run once after deploy.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!isAdmin(req, body.password)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await createWebhookSubscription());
}

// Delete a webhook subscription by id (admin).
export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!isAdmin(req, body.password)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  return NextResponse.json(await deleteWebhookSubscription(Number(body.id)));
}
