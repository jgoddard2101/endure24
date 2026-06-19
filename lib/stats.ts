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
  // This runner's share of a collective team effort to fit one more lap:
  // seconds/lap faster they'd need to average. null if they have no laps left.
  collectiveSecondsFasterPerLap: number | null;
}

export interface ScheduleEntry {
  fromLap: number; // first team-wide lap number this entry covers
  laps: number; // how many laps (a completed double = 2)
  runnerName: string;
  atISO: string; // start time (actual for done, projected for forecast)
  seconds: number; // elapsed (actual) or expected (forecast) duration
  miles: number;
  status: "done" | "running" | "forecast";
}

export interface ChartPoint {
  t: string;
  miles: number;
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
  // Equal-% speed-up every remaining lap needs for the team to fit one more lap.
  extraLapSpeedupPct: number | null;
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
    laps: number;
    movingSeconds: number;
    elapsedSeconds: number;
    startedAt: string;
    source: string;
  }[];
  schedule: ScheduleEntry[];
  initialProjectedLaps: number;
  chart: {
    startAt: string;
    endAt: string;
    actual: ChartPoint[];
    projected: ChartPoint[];
    initial: ChartPoint[];
  };
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

  // Team average lap duration (elapsed), weighted by lap count so a double lap
  // (one activity, laps=2) correctly counts as two laps' worth.
  const totalLapCount = allLaps.reduce((a, l) => a + l.laps, 0);
  const teamAvgLapSeconds =
    totalLapCount > 0 ? allLaps.reduce((a, l) => a + l.elapsedTimeSec, 0) / totalLapCount : null;

  // Expected lap duration for a runner, and where that number comes from:
  //   actual average  ->  manual estimate  ->  team average  ->  default pace.
  type Basis = "actual" | "estimate" | "team" | "default";
  const expectedInfo = (r: (typeof runners)[number]): { sec: number; basis: Basis } => {
    const ownLaps = r.laps.reduce((a, l) => a + l.laps, 0);
    const own = ownLaps > 0 ? r.laps.reduce((a, l) => a + l.elapsedTimeSec, 0) / ownLaps : null;
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
  const forecastLaps: { runnerId: string; startMs: number; durMs: number; inProgress: boolean }[] = [];
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
        // k===0 is the lap currently underway (or about to start at event open).
        forecastLaps.push({ runnerId: runner.id, startMs: t, durMs: dur, inProgress: k === 0 && started });
        t += dur;
      } else {
        marginalLapStartMs = t;
        break;
      }
    }
  }

  const totalLaps = totalLapCount;
  const totalMiles = round1(allLaps.reduce((a, l) => a + l.distanceMeters, 0) / METERS_PER_MILE);
  const projectedTotalLaps = totalLaps + futureFitLaps;

  // Total team time that must be saved to fit the marginal lap (the next lap that
  // currently starts just after the cutoff).
  const extraLapGainSeconds =
    marginalLapStartMs != null ? Math.max(0, Math.round((marginalLapStartMs - cutoff) / 1000)) : null;

  // Collective effort: shrink every remaining lap by the same fraction so the
  // saved time sums to the gap. p = gap / (total time the remaining laps occupy).
  let extraLapSpeedupFraction: number | null = null;
  if (marginalLapStartMs != null && simStart) {
    const remainingLapTime = marginalLapStartMs - simStart.getTime();
    const gapMs = marginalLapStartMs - cutoff;
    if (remainingLapTime > 0 && gapMs > 0) extraLapSpeedupFraction = gapMs / remainingLapTime;
  }

  const runnerStats: RunnerStat[] = runners.map((r) => {
    const laps = r.laps;
    const lapCount = laps.reduce((a, l) => a + l.laps, 0); // doubles count as 2, etc.
    const totalElapsed = laps.reduce((a, l) => a + l.elapsedTimeSec, 0);
    const totalMoving = laps.reduce((a, l) => a + l.movingTimeSec, 0);
    const totalMilesRun = laps.reduce((a, l) => a + l.distanceMeters, 0) / METERS_PER_MILE;
    const avgLap = lapCount > 0 ? totalElapsed / lapCount : null; // per single lap
    // Fastest lap only counts activities that were exactly one lap.
    const singleLapTimes = laps.filter((l) => l.laps === 1).map((l) => l.elapsedTimeSec);
    const fastest = singleLapTimes.length ? Math.min(...singleLapTimes) : null;
    const avgPace = totalMilesRun > 0 ? totalMoving / totalMilesRun : null; // sec per mile
    const onCourse = r.id === currentRunnerId;
    const { sec: expectedSec, basis } = expectedInfo(r);

    // This runner's share of the collective effort: the same % speed-up applied
    // to their own pace. Faster runners shave fewer seconds, slower runners more.
    const futureLaps = futureLapsByRunner.get(r.id) ?? 0;
    const collectiveSecondsFasterPerLap =
      extraLapSpeedupFraction != null && futureLaps > 0
        ? Math.round(extraLapSpeedupFraction * expectedSec)
        : null;

    return {
      id: r.id,
      name: r.name,
      rotationPosition: r.rotationPosition,
      authorized: Boolean(r.refreshToken),
      lapCount,
      projectedLaps: lapCount + futureLaps,
      totalMiles: round1(totalMilesRun),
      avgLapSeconds: avgLap ? Math.round(avgLap) : null,
      fastestLapSeconds: fastest,
      avgPaceSecPerMile: avgPace ? Math.round(avgPace) : null,
      estimatedLapSeconds: r.estimatedLapSeconds ?? null,
      expectedLapSeconds: Math.round(expectedSec),
      expectedBasis: basis,
      onCourse,
      nextStartAt: onCourse ? null : nextStartAt.get(r.id)?.toISOString() ?? null,
      estimatedFinishAt: onCourse ? estimatedFinishAt?.toISOString() ?? null : null,
      collectiveSecondsFasterPerLap,
    };
  });

  // Fastest single lap (multi-lap activities don't have a single-lap time).
  let fastestLap: DashboardState["fastestLap"] = null;
  for (const l of allLaps) {
    if (l.laps !== 1) continue;
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
      laps: l.laps,
      movingSeconds: l.movingTimeSec,
      elapsedSeconds: l.elapsedTimeSec,
      startedAt: l.startedAt.toISOString(),
      source: l.source,
    }));

  // --- Full lap schedule: completed (actual) + forecast (estimated) ---
  const nameById = new Map(runners.map((r) => [r.id, r.name]));
  const schedule: ScheduleEntry[] = [];
  let lapCounter = 0;
  for (const l of allLaps) {
    schedule.push({
      fromLap: lapCounter + 1,
      laps: l.laps,
      runnerName: l.runner.name,
      atISO: l.startedAt.toISOString(),
      seconds: l.elapsedTimeSec,
      miles: round1(l.distanceMeters / METERS_PER_MILE),
      status: "done",
    });
    lapCounter += l.laps;
  }
  for (const f of forecastLaps) {
    schedule.push({
      fromLap: lapCounter + 1,
      laps: 1,
      runnerName: nameById.get(f.runnerId) ?? "?",
      atISO: new Date(f.startMs).toISOString(),
      seconds: Math.round(f.durMs / 1000),
      miles: lapDist,
      status: f.inProgress ? "running" : "forecast",
    });
    lapCounter += 1;
  }

  // --- Initial plan: projection from the start using only estimates/default ---
  // (ignores actuals & team average) so the chart can show drift from the plan.
  let initialProjectedLaps = 0;
  if (n > 0) {
    let t = startAt.getTime();
    for (let k = 0; k < 1000 && t < cutoff; k++) {
      const r = runners[k % n];
      initialProjectedLaps++;
      t += (r.estimatedLapSeconds ?? defaultLapSeconds) * 1000;
    }
  }

  // --- Chart series (cumulative miles over time) ---
  const actual: { t: string; miles: number }[] = [{ t: startAt.toISOString(), miles: 0 }];
  {
    const byFinish = [...allLaps].sort(
      (a, b) => a.startedAt.getTime() + a.elapsedTimeSec * 1000 - (b.startedAt.getTime() + b.elapsedTimeSec * 1000)
    );
    let cum = 0;
    for (const l of byFinish) {
      cum += l.distanceMeters / METERS_PER_MILE;
      actual.push({ t: new Date(l.startedAt.getTime() + l.elapsedTimeSec * 1000).toISOString(), miles: round1(cum) });
    }
  }
  // Projection continues from the last actual point through the forecast laps.
  const projected: { t: string; miles: number }[] = [actual[actual.length - 1]];
  {
    let cum = projected[0].miles;
    for (const f of forecastLaps) {
      cum += lapDist;
      projected.push({ t: new Date(f.startMs + f.durMs).toISOString(), miles: round1(cum) });
    }
  }
  const initial = [
    { t: startAt.toISOString(), miles: 0 },
    { t: endAt.toISOString(), miles: round1(initialProjectedLaps * lapDist) },
  ];

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
    extraLapSpeedupPct: extraLapSpeedupFraction != null ? Math.round(extraLapSpeedupFraction * 1000) / 10 : null,
    teamAvgLapSeconds: teamAvgLapSeconds ? Math.round(teamAvgLapSeconds) : null,
    fastestLap,
    currentRunnerId: currentRunnerId ?? null,
    isManualOverride,
    onCourseSince: onCourseSince?.toISOString() ?? null,
    runners: runnerStats,
    recentLaps,
    schedule,
    initialProjectedLaps,
    chart: { startAt: startAt.toISOString(), endAt: endAt.toISOString(), actual, projected, initial },
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
