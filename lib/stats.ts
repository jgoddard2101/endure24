import { prisma } from "./prisma";
import { getEventConfig, METERS_PER_MILE, DEFAULT_PACE_SEC_PER_MILE } from "./config";
import type { Lap, Runner } from "@prisma/client";

export interface RunnerStat {
  id: string;
  name: string;
  rotationPosition: number;
  authorized: boolean;
  lapCount: number;
  totalMiles: number;
  avgLapSeconds: number | null; // elapsed time per lap
  fastestLapSeconds: number | null;
  avgPaceSecPerMile: number | null; // from moving time
  expectedLapSeconds: number; // used for ETA projection
  onCourse: boolean;
  // ISO time this runner is next expected to start a lap (null if on course now).
  nextStartAt: string | null;
  // For the on-course runner: ISO time they're expected to finish.
  estimatedFinishAt: string | null;
}

export interface DashboardState {
  eventName: string;
  teamName: string;
  startAt: string;
  endAt: string;
  now: string;
  started: boolean;
  finished: boolean;
  secondsElapsed: number;
  secondsRemaining: number;
  lapDistanceMiles: number;

  totalLaps: number;
  totalMiles: number;
  projectedTotalLaps: number;
  teamAvgLapSeconds: number | null;
  fastestLap: { runnerName: string; seconds: number } | null;

  currentRunnerId: string | null;
  isManualOverride: boolean;
  onCourseSince: string | null;

  runners: RunnerStat[];
  recentLaps: {
    id: string;
    runnerName: string;
    miles: number;
    movingSeconds: number;
    elapsedSeconds: number;
    startedAt: string;
    source: string;
  }[];
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Builds the complete, JSON-serializable dashboard state. */
export async function getDashboardState(): Promise<DashboardState> {
  const config = await getEventConfig();
  const runners = await prisma.runner.findMany({
    where: { active: true },
    orderBy: { rotationPosition: "asc" },
    include: { laps: { orderBy: { startedAt: "asc" } } },
  });
  const allLaps = await prisma.lap.findMany({ orderBy: { startedAt: "asc" }, include: { runner: true } });

  const now = new Date();
  const startAt = config.startAt;
  const endAt = new Date(startAt.getTime() + config.durationHours * 3600_000);
  const started = now >= startAt;
  const finished = now >= endAt;

  const lapDist = config.lapDistanceMiles;
  const defaultLapSeconds = lapDist * DEFAULT_PACE_SEC_PER_MILE;

  // Team average lap duration (elapsed) across all completed laps.
  const teamAvgLapSeconds = avg(allLaps.map((l) => l.elapsedTimeSec));

  const expectedFor = (laps: Lap[]): number => {
    const own = avg(laps.map((l) => l.elapsedTimeSec));
    return own ?? teamAvgLapSeconds ?? defaultLapSeconds;
  };

  // --- Determine who is on course ---
  // Manual override wins; otherwise infer the runner after the last lap's runner.
  let currentRunnerId = config.currentRunnerId;
  let onCourseSince = config.onCourseSince;
  const isManualOverride = Boolean(config.currentRunnerId);

  if (!currentRunnerId && runners.length > 0) {
    const lastLap = allLaps[allLaps.length - 1];
    if (!lastLap) {
      currentRunnerId = runners[0].id;
      onCourseSince = started ? startAt : null;
    } else {
      const lastIdx = runners.findIndex((r) => r.id === lastLap.runnerId);
      const nextIdx = lastIdx === -1 ? 0 : (lastIdx + 1) % runners.length;
      currentRunnerId = runners[nextIdx].id;
      onCourseSince = new Date(lastLap.startedAt.getTime() + lastLap.elapsedTimeSec * 1000);
    }
  }

  // --- Project the rotation forward to compute each runner's next start ---
  const n = runners.length;
  const currentIdx = runners.findIndex((r) => r.id === currentRunnerId);
  const nextStartAt = new Map<string, Date>();
  let estimatedFinishAt: Date | null = null;

  if (n > 0 && currentIdx !== -1 && onCourseSince) {
    let t = new Date(onCourseSince);
    // Simulate two full cycles so every runner (incl. the current one) gets a future start.
    for (let k = 0; k <= 2 * n; k++) {
      const runner = runners[(currentIdx + k) % n];
      const lapStart = new Date(t);
      const dur = expectedFor(runner.laps) * 1000;
      const lapEnd = new Date(t.getTime() + dur);
      if (k === 0) estimatedFinishAt = lapEnd;
      // Record the first future start for each runner.
      if (lapStart.getTime() > now.getTime() && !nextStartAt.has(runner.id)) {
        nextStartAt.set(runner.id, lapStart);
      }
      t = lapEnd;
    }
  }

  const runnerStats: RunnerStat[] = runners.map((r) => {
    const laps = r.laps;
    const lapCount = laps.length;
    const avgLap = avg(laps.map((l) => l.elapsedTimeSec));
    const fastest = lapCount ? Math.min(...laps.map((l) => l.elapsedTimeSec)) : null;
    const avgMoving = avg(laps.map((l) => l.movingTimeSec));
    const onCourse = r.id === currentRunnerId;
    return {
      id: r.id,
      name: r.name,
      rotationPosition: r.rotationPosition,
      authorized: Boolean(r.refreshToken),
      lapCount,
      totalMiles: round1((laps.reduce((a, l) => a + l.distanceMeters, 0)) / METERS_PER_MILE),
      avgLapSeconds: avgLap ? Math.round(avgLap) : null,
      fastestLapSeconds: fastest,
      avgPaceSecPerMile: avgMoving ? Math.round(avgMoving / lapDist) : null,
      expectedLapSeconds: Math.round(expectedFor(laps)),
      onCourse,
      nextStartAt: onCourse ? null : nextStartAt.get(r.id)?.toISOString() ?? null,
      estimatedFinishAt: onCourse ? estimatedFinishAt?.toISOString() ?? null : null,
    };
  });

  const totalLaps = allLaps.length;
  const totalMiles = round1(allLaps.reduce((a, l) => a + l.distanceMeters, 0) / METERS_PER_MILE);

  // Projected total laps at event end, using team avg lap duration.
  const lapSecForProjection = teamAvgLapSeconds ?? defaultLapSeconds;
  const secondsRemaining = Math.max(0, Math.round((endAt.getTime() - now.getTime()) / 1000));
  const projectedAdditional = started && !finished ? secondsRemaining / lapSecForProjection : 0;
  const projectedTotalLaps = Math.round(totalLaps + projectedAdditional);

  let fastestLap: DashboardState["fastestLap"] = null;
  for (const l of allLaps) {
    if (!fastestLap || l.elapsedTimeSec < fastestLap.seconds) {
      fastestLap = { runnerName: l.runner.name, seconds: l.elapsedTimeSec };
    }
  }

  const recentLaps = [...allLaps]
    .reverse()
    .slice(0, 12)
    .map((l) => ({
      id: l.id,
      runnerName: l.runner.name,
      miles: round1(l.distanceMeters / METERS_PER_MILE),
      movingSeconds: l.movingTimeSec,
      elapsedSeconds: l.elapsedTimeSec,
      startedAt: l.startedAt.toISOString(),
      source: l.source,
    }));

  return {
    eventName: config.eventName,
    teamName: config.teamName,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    now: now.toISOString(),
    started,
    finished,
    secondsElapsed: Math.max(0, Math.round((now.getTime() - startAt.getTime()) / 1000)),
    secondsRemaining,
    lapDistanceMiles: lapDist,
    totalLaps,
    totalMiles,
    projectedTotalLaps,
    teamAvgLapSeconds: teamAvgLapSeconds ? Math.round(teamAvgLapSeconds) : null,
    fastestLap,
    currentRunnerId: currentRunnerId ?? null,
    isManualOverride,
    onCourseSince: onCourseSince?.toISOString() ?? null,
    runners: runnerStats,
    recentLaps,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
