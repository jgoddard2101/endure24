import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/strava";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/config";

export const dynamic = "force-dynamic";

// Strava redirects here after the runner grants access.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  const runnerId = req.nextUrl.searchParams.get("state") || undefined;

  if (error || !code) {
    return NextResponse.redirect(`${env.appBaseUrl}/?auth=error`);
  }

  try {
    const token = await exchangeCodeForToken(code);
    const athleteId = token.athlete?.id;
    const fullName = [token.athlete?.firstname, token.athlete?.lastname].filter(Boolean).join(" ").trim();

    const data = {
      stravaAthleteId: athleteId ? BigInt(athleteId) : undefined,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      tokenExpiresAt: new Date(token.expires_at * 1000),
    };

    if (runnerId) {
      // Link to the pre-created roster entry.
      await prisma.runner.update({ where: { id: runnerId }, data });
    } else if (athleteId) {
      // No roster entry specified: match by athlete id, else create a new runner
      // appended to the end of the rotation.
      const existing = await prisma.runner.findUnique({ where: { stravaAthleteId: BigInt(athleteId) } });
      if (existing) {
        await prisma.runner.update({ where: { id: existing.id }, data });
      } else {
        const count = await prisma.runner.count();
        await prisma.runner.create({
          data: { name: fullName || `Runner ${count + 1}`, rotationPosition: count, ...data },
        });
      }
    }

    return NextResponse.redirect(`${env.appBaseUrl}/?auth=ok`);
  } catch (err) {
    console.error(err);
    return NextResponse.redirect(`${env.appBaseUrl}/?auth=error`);
  }
}
