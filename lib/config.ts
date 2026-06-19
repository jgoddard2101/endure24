import { prisma } from "./prisma";

export const env = {
  stravaClientId: process.env.STRAVA_CLIENT_ID ?? "",
  stravaClientSecret: process.env.STRAVA_CLIENT_SECRET ?? "",
  stravaWebhookVerifyToken: process.env.STRAVA_WEBHOOK_VERIFY_TOKEN ?? "",
  appBaseUrl: (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  adminPassword: process.env.ADMIN_PASSWORD ?? "change-me",
};

export const METERS_PER_MILE = 1609.344;

// Fallback pace used for ETAs before we have any completed laps.
// 9 min/mile -> a 5-mile lap takes 45 min.
export const DEFAULT_PACE_SEC_PER_MILE = 9 * 60;

/**
 * Returns the EventConfig singleton (row id = 1), creating it from env
 * defaults on first run.
 */
export async function getEventConfig() {
  const existing = await prisma.eventConfig.findUnique({ where: { id: 1 } });
  if (existing) return existing;

  return prisma.eventConfig.create({
    data: {
      id: 1,
      eventName: process.env.EVENT_NAME ?? "Endure24",
      teamName: process.env.TEAM_NAME ?? "Team Name",
      startAt: new Date(process.env.EVENT_START ?? Date.now()),
      durationHours: Number(process.env.EVENT_DURATION_HOURS ?? 24),
      lapDistanceMiles: Number(process.env.LAP_DISTANCE_MILES ?? 5),
    },
  });
}
