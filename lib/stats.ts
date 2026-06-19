import { prisma } from "./prisma";
import { getEventConfig, METERS_PER_MILE, DEFAULT_PACE_SEC_PER_MILE } from "./config";

export interface RunnerStat {
  id: string;
  name: string;
  rotationPosition: number;
  authorized: boolean;
  lapCount: number;
  projectedLaps: number; // completed + projected remaining laps for this runner
  totalMiles: number;
  avgLapSeconds: number | null; // elapsed time per lap
  fastestLapSeconds: number | null;
  avgPaceSecPerMile: number | null; // from moving time
  estimatedLapSeconds: number | null; // manual pre-event estimate, if set
  expectedLapSeconds: number; // used for ETA projection
  expectedBasis: "actual" | "estimate" | "team" | "default"; // where expected comes from
  onCourse: boolean;
  // ISO time this runner is next expected to start a lap (null if on course now).
  nextStartAt: string | null;
  // For the on-course runner: ISO time they're expected to finish.
  estimatedFinishAt: string | null;
  // If only this runner sped up, seconds/lap faster needed to fit one more team lap.
  secondsFasterForExtraLap: number | null;
}

export interface DashboardState {
  eventName: string;
  teamName: string;
  startAt: string;
  endAt: string; // last moment a new lap may START (event start + duration)
  finishBy: string; // a lap in progress at the cutoff must finish by here (+1h)
  now: string;
  started: boolean;
  finished: boolean;
  secondsElapsed: number;
  secondsRemaining: number; // until the start cutoff (endAt)
  lapDistanceMiles: number;

  totalLaps: number;
  totalMiles: number;
  projectedTotalLaps: number;
  // Total team time (seconds) that must be saved to fit one more lap; null if N/A.
  extraLapGainSeconds: number | null;
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

  // Expected lap duration for a runner, and where that number comes from:
  //   actual average  ->  manual estimate  ->  team average  ->  default pace.
  type Basis = "actual" | "estimate" | "team" | "default";
  const expectedInfo = (r: (typeof runners)[number]): { sec: number; basis: Basis } => {
    const own = avg(r.laps.map((l) => l.elapsedTimeSec));
    if (own != null) return { sec: own, basis: "actual" };
    if (r.estimatedLapSeconds != null) return { sec: r.estimatedLapSeconds, basis: "estimate" };
    if (teamAvgLapSeconds != null) return { sec: teamAvgLapSeconds, basis: "team" };
    return { sec: defaultLapSeconds, basis: "default" };
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

  // --- Project the rotation forward ---
  // A lap may START any time up to the cutoff (event start + duration). A lap in
  // progress at the cutoff still counts as long as it finishes within the next
  // hour. So total laps == number of laps that START before the cutoff.
  const n = runners.length;
  const currentIdx = runners.findIndex((r) => r.id === currentRunnerId);
  const cutoff = endAt.getTime();
  const simStart = onCourseSince ?? (n > 0 && !finished ? startAt : null);

  const nextStartAt = new Map<string, Date>();
  const futureLapsByRunner = new Map<string, number>();
  let estimatedFinishAt: Date | null = null;
  let futureFitLaps = 0; // future laps (incl. the in-progress one) that start before cutoff
  let marginalLapStartMs: number | null = null; // start time of the first lap that does NOT fit

  if (n > 0 && currentIdx !== -1 && simStart) {
    let t = simStart.getTime();
    for (let k = 0; k < 1000; k++) {
      const runner = runners[(currentIdx + k) % n];
      const dur = expectedInfo(runner).sec * 1000;
      if (k === 0) estimatedFinishAt = new Date(t + dur);
      if (t < cutoff) {
        if (t > now.getTime() && !nextStartAt.has(runner.id)) nextStartAt.set(runner.id, new Date(t));
        futureFitLaps++;
        futureLapsByRunner.set(runner.id, (futureLapsByRunner.get(runner.id) ?? 0) + 1);
        t += dur;
      } else {
        marginalLapStartMs = t;
        break;
      }
    }
  }

  const totalLaps = allLaps.length;
  const totalMiles = round1(allLaps.reduce((a, l) => a + l.distanceMeters, 0) / METERS_PER_MILE);
  const projectedTotalLaps = totalLaps + futureFitLaps;

  // Total team time that must be saved to fit the marginal lap (the next lap that
  // currently starts just after the cutoff).
  const extraLapGainSeconds =
    marginalLapStartMs != null ? Math.max(0, Math.round((marginalLapStartMs - cutoff) / 1000)) : null;

  const runnerStats: RunnerStat[] = runners.map((r) => {
    const laps = r.laps;
    const lapCount = laps.length;
    const avgLap = avg(laps.map((l) => l.elapsedTimeSec));
    const fastest = lapCount ? Math.min(...laps.map((l) => l.elapsedTimeSec)) : null;
    const avgMoving = avg(laps.map((l) => l.movingTimeSec));
    const onCourse = r.id === currentRunnerId;
    const { sec: expectedSec, basis } = expectedInfo(r);

    // If ONLY this runner sped up, how much faster per lap would they need to be
    // to claw back the gap, spread across the laps they're projected to run?
    const futureLaps = futureLapsByRunner.get(r.id) ?? 0;
    let secondsFasterForExtraLap: number | null = null;
    if (extraLapGainSeconds != null && extraLapGainSeconds > 0 && futureLaps > 0) {
      const perLap = extraLapGainSeconds / futureLaps;
      // Only meaningful if they could realistically still complete the lap.
      secondsFasterForExtraLap = perLap < expectedSec ? Math.round(perLap) : null;
    }

    return {
      id: r.id,
      name: r.name,
      rotationPosition: r.rotationPosition,
      authorized: Boolean(r.refreshToken),
      lapCount,
      projectedLaps: lapCount + futureLaps,
      totalMiles: round1(laps.reduce((a, l) => a + l.distanceMeters, 0) / METERS_PER_MILE),
      avgLapSeconds: avgLap ? Math.round(avgLap) : null,
      fastestLapSeconds: fastest,
      avgPaceSecPerMile: avgMoving ? Math.round(avgMoving / lapDist) : null,
      estimatedLapSeconds: r.estimatedLapSeconds ?? null,
      expectedLapSeconds: Math.round(expectedSec),
      expectedBasis: basis,
      onCourse,
      nextStartAt: onCourse ? null : nextStartAt.get(r.id)?.toISOString() ?? null,
      estimatedFinishAt: onCourse ? estimatedFinishAt?.toISOString() ?? null : null,
      secondsFasterForExtraLap,
    };
  });

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
    finishBy: new Date(endAt.getTime() + 3600_000).toISOString(),
    now: now.toISOString(),
    started,
    finished,
    secondsElapsed: Math.max(0, Math.round((now.getTime() - startAt.getTime()) / 1000)),
    secondsRemaining: Math.max(0, Math.round((endAt.getTime() - now.getTime()) / 1000)),
    lapDistanceMiles: lapDist,
    totalLaps,
    totalMiles,
    projectedTotalLaps,
    extraLapGainSeconds,
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
