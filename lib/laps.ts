import { prisma } from "./prisma";
import { getEventConfig, METERS_PER_MILE } from "./config";
import type { StravaActivity } from "./strava";

// Foot activities we count as a lap.
const LAP_TYPES = new Set(["Run", "TrailRun", "Walk", "Hike"]);

export interface IngestResult {
  status: "created" | "duplicate" | "rejected";
  reason?: string;
  lapId?: string;
}

/**
 * Decide whether a Strava activity is a valid event lap and, if so, record it.
 * Filters by activity type, distance (within tolerance of the lap distance) and
 * the event time window. Idempotent via the unique stravaActivityId.
 */
export async function ingestActivity(runnerId: string, activity: StravaActivity): Promise<IngestResult> {
  const config = await getEventConfig();
  const endAt = new Date(config.startAt.getTime() + config.durationHours * 3600_000);

  if (!LAP_TYPES.has(activity.sport_type) && !LAP_TYPES.has(activity.type)) {
    return { status: "rejected", reason: `type ${activity.sport_type}` };
  }

  const miles = activity.distance / METERS_PER_MILE;
  const lapDist = config.lapDistanceMiles;
  // Accept 70%–140% of the lap distance to tolerate GPS drift / short-or-long courses.
  if (miles < lapDist * 0.7 || miles > lapDist * 1.4) {
    return { status: "rejected", reason: `distance ${miles.toFixed(2)}mi` };
  }

  const startedAt = new Date(activity.start_date);
  // 30 min grace either side of the official window.
  const grace = 30 * 60_000;
  if (startedAt.getTime() < config.startAt.getTime() - grace || startedAt.getTime() > endAt.getTime() + grace) {
    return { status: "rejected", reason: "outside event window" };
  }

  const existing = await prisma.lap.findUnique({ where: { stravaActivityId: BigInt(activity.id) } });
  if (existing) return { status: "duplicate", lapId: existing.id };

  const lap = await prisma.lap.create({
    data: {
      runnerId,
      stravaActivityId: BigInt(activity.id),
      distanceMeters: activity.distance,
      movingTimeSec: activity.moving_time,
      elapsedTimeSec: activity.elapsed_time,
      startedAt,
      source: "strava",
    },
  });

  // If a manual override named this runner as on-course, clear it so the
  // rotation auto-advances to the next runner now that they've finished.
  if (config.currentRunnerId === runnerId) {
    await prisma.eventConfig.update({
      where: { id: 1 },
      data: { currentRunnerId: null, onCourseSince: null },
    });
  }

  return { status: "created", lapId: lap.id };
}
