import { prisma } from "./prisma";
import { getEventConfig, METERS_PER_MILE } from "./config";
import type { StravaActivity } from "./strava";

// Foot activities we count as a lap.
const LAP_TYPES = new Set(["Run", "TrailRun", "Walk", "Hike"]);

// How far the lap ratio (distance / lapDistance) may sit from a whole number
// and still count. 0.4 means a 5-mile lap is accepted between ~3 and ~7 miles,
// a double between ~8 and ~12, etc.
const MAX_LAP_DEVIATION = 0.4;

/**
 * How many laps an activity of `miles` represents, or null if it doesn't map
 * cleanly to a whole number of laps. Handles double/triple laps recorded as a
 * single Strava activity, allowing for GPS drift and short-or-long courses.
 */
export function lapsForDistance(miles: number, lapDistanceMiles: number): number | null {
  if (lapDistanceMiles <= 0) return null;
  const ratio = miles / lapDistanceMiles;
  const n = Math.round(ratio);
  if (n < 1) return null; // too short — warm-up, jog to the start, etc.
  if (Math.abs(ratio - n) > MAX_LAP_DEVIATION) return null; // ambiguous distance
  return n;
}

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
  const laps = lapsForDistance(miles, lapDist);
  if (laps == null) {
    return { status: "rejected", reason: `distance ${miles.toFixed(2)}mi (~${(miles / lapDist).toFixed(2)} laps)` };
  }

  const startedAt = new Date(activity.start_date);
  // A lap counts only if it STARTED within the event window: no later than the
  // cutoff (start + duration). A lap in progress at the cutoff still counts (it
  // just has to finish within the next hour). Small grace allows for clock skew.
  const grace = 5 * 60_000;
  if (startedAt.getTime() < config.startAt.getTime() - grace || startedAt.getTime() > endAt.getTime() + grace) {
    return { status: "rejected", reason: "lap started outside event window" };
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
      laps,
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
