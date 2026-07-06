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
    const nowMs = now.getTime();
    let t = simStart.getTime();
    for (let k = 0; k < 1000; k++) {
      const runner = runners[(currentIdx + k) % n];
      const dur = expectedInfo(runner).sec * 1000;
      const lapStart = t;
      let lapEnd = lapStart + dur;
      // The current runner (k===0) is already out and can't finish in the past:
      // if they're overdue, clamp their projected finish to "now". This anchors
      // the whole downstream timeline to the present, so the rotation order is
      // preserved no matter how long the current runner takes — the next runner
      // stays next instead of the queue marching on without any real laps.
      if (k === 0) {
        lapEnd = Math.max(lapEnd, nowMs);
        estimatedFinishAt = new Date(lapEnd);
      }
      if (lapStart < cutoff) {
        // Future laps (k>=1) always start at >= now thanks to the clamp above.
        if (lapStart >= nowMs && !nextStartAt.has(runner.id)) nextStartAt.set(runner.id, new Date(lapStart));
        futureFitLaps++;
        futureLapsByRunner.set(runner.id, (futureLapsByRunner.get(runner.id) ?? 0) + 1);
        forecastLaps.push({ runnerId: runner.id, startMs: lapStart, durMs: lapEnd - lapStart, inProgress: k === 0 && started });
        t = lapEnd;
      } else {
        marginalLapStartMs = lapStart;
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

// ---------------------------------------------------------------------------
// End-of-event recap (per-team summary + awards + leaderboard)
// ---------------------------------------------------------------------------

// Laps are stored in UTC; the event runs on UK time (BST in July), so night
// detection must use the IANA zone, not a fixed offset. Build the formatter once.
const LONDON_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
});

export function londonHourMinute(d: Date): { h: number; m: number } {
  const parts = LONDON_PARTS.formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  let h = get("hour");
  if (h === 24) h = 0; // en-GB can emit "24" at midnight
  return { h, m: get("minute") };
}

export function isLondonNight(d: Date): boolean {
  const h = londonHourMinute(d).h;
  return h >= 22 || h < 6;
}

export interface ConsistencyStats {
  n: number;
  mean: number | null; // avg of the supplied lap times
  min: number | null;
  max: number | null;
  stddev: number | null; // null unless n >= 3 (matches the Metronome threshold)
  cv: number | null; // stddev / mean * 100 (1 dp)
  adj1: number | null; // consistency-adjusted: mean + 1σ
  adj2: number | null; // mean + 2σ
}

/**
 * Consistency bundle over a set of single-lap elapsed times (seconds). stddev
 * and the derived cv / mean±σ need at least 3 laps to be meaningful; below that
 * they're null while mean/min/max are still returned.
 */
export function consistencyStats(secs: number[]): ConsistencyStats {
  const n = secs.length;
  if (n === 0) return { n: 0, mean: null, min: null, max: null, stddev: null, cv: null, adj1: null, adj2: null };
  const mean = secs.reduce((a, b) => a + b, 0) / n;
  const base: ConsistencyStats = {
    n,
    mean: Math.round(mean),
    min: Math.min(...secs),
    max: Math.max(...secs),
    stddev: null,
    cv: null,
    adj1: null,
    adj2: null,
  };
  if (n >= 3) {
    const variance = secs.reduce((a, x) => a + (x - mean) ** 2, 0) / n;
    const sd = Math.sqrt(variance);
    base.stddev = Math.round(sd);
    base.cv = Math.round((sd / mean) * 1000) / 10;
    base.adj1 = Math.round(mean + sd);
    base.adj2 = Math.round(mean + 2 * sd);
  }
  return base;
}

export interface RunnerRecap {
  id: string;
  name: string;
  active: boolean; // false = dropped out but still counted
  lapCount: number; // weighted by Lap.laps
  totalMiles: number;
  avgLapSeconds: number | null;
  fastestLapSeconds: number | null; // single laps only (laps === 1)
  avgPaceSecPerMile: number | null;
  nightLaps: number; // weighted, London-local [22:00, 06:00)
  biggestEffortLaps: number; // max Lap.laps in one record
  longestStreak: number; // consecutive lap records by this runner
  consistencyStddevSec: number | null; // stdev of single-lap elapsed; null if < 3
  improvementPct: number | null; // + = faster 2nd half; null if < 4 laps
  awards: string[]; // award keys this runner won
}

export interface Award {
  key: string;
  emoji: string;
  title: string;
  blurb: string;
  runnerId: string;
  runnerName: string;
  value: number; // raw value; client formats per valueKind (unit-aware for miles)
  valueKind: "laps" | "duration" | "count" | "stdev" | "pct" | "miles" | "clock";
  team?: string; // set for club-wide awards; undefined for a single team
}

export interface EventSummary {
  eventName: string;
  teamName: string;
  startAt: string;
  endAt: string;
  finished: boolean;
  totalLaps: number;
  totalMiles: number;
  teamAvgLapSeconds: number | null;
  teamAvgPaceSecPerMile: number | null;
  fastestLap: { runnerName: string; seconds: number } | null;
  nightLaps: number;
  manualLaps: number;
  stravaLaps: number;
  movingSeconds: number;
  elapsedSeconds: number;
  effortPct: number | null; // moving / elapsed * 100
  biggestEffort: { runnerName: string; laps: number; miles: number } | null;
  firstLapAt: string | null;
  lastLapEndAt: string | null;
  coverageSeconds: number | null;
  initialProjectedLaps: number;
  planDelta: number; // totalLaps - initialProjectedLaps
  runners: RunnerRecap[];
  awards: Award[];
}

/** Post-event recap: team totals, playful awards and a leaderboard. */
export async function getEventSummary(): Promise<EventSummary> {
  const config = await getEventConfig();
  const startAt = config.startAt;
  const endAt = new Date(startAt.getTime() + config.durationHours * 3600_000);
  const now = new Date();
  const lapDist = config.lapDistanceMiles;
  const defaultLapSeconds = lapDist * DEFAULT_PACE_SEC_PER_MILE;

  // ALL runners (including dropped-out — they still ran laps that count).
  const runners = await prisma.runner.findMany({
    orderBy: { rotationPosition: "asc" },
    include: { laps: { orderBy: { startedAt: "asc" } } },
  });
  const allLaps = await prisma.lap.findMany({
    orderBy: { startedAt: "asc" },
    include: { runner: true },
  });

  // --- Team totals ---
  const totalLaps = allLaps.reduce((a, l) => a + l.laps, 0);
  const totalMeters = allLaps.reduce((a, l) => a + l.distanceMeters, 0);
  const teamMiles = totalMeters / METERS_PER_MILE;
  const movingSeconds = allLaps.reduce((a, l) => a + l.movingTimeSec, 0);
  const elapsedSeconds = allLaps.reduce((a, l) => a + l.elapsedTimeSec, 0);
  const teamAvgLapSeconds = totalLaps > 0 ? Math.round(elapsedSeconds / totalLaps) : null;
  const teamAvgPaceSecPerMile = teamMiles > 0 ? Math.round(movingSeconds / teamMiles) : null;
  const effortPct = elapsedSeconds > 0 ? Math.min(100, Math.round((movingSeconds / elapsedSeconds) * 100)) : null;
  const nightLaps = allLaps.reduce((a, l) => a + (isLondonNight(l.startedAt) ? l.laps : 0), 0);
  const manualLaps = allLaps.reduce((a, l) => a + (l.source === "manual" ? l.laps : 0), 0);
  const stravaLaps = totalLaps - manualLaps;

  // Fastest single lap (team-wide).
  let fastestLap: { runnerName: string; seconds: number } | null = null;
  for (const l of allLaps) {
    if (l.laps !== 1) continue;
    if (!fastestLap || l.elapsedTimeSec < fastestLap.seconds) {
      fastestLap = { runnerName: l.runner.name, seconds: l.elapsedTimeSec };
    }
  }

  // Biggest single effort (max-distance record).
  let biggestLap: (typeof allLaps)[number] | null = null;
  for (const l of allLaps) {
    if (!biggestLap || l.distanceMeters > biggestLap.distanceMeters) biggestLap = l;
  }
  const biggestEffort = biggestLap
    ? { runnerName: biggestLap.runner.name, laps: biggestLap.laps, miles: round1(biggestLap.distanceMeters / METERS_PER_MILE) }
    : null;

  // Coverage window (earliest start → latest finish).
  const firstLap = allLaps[0] ?? null;
  let lastFinishMs: number | null = null;
  for (const l of allLaps) {
    const end = l.startedAt.getTime() + l.elapsedTimeSec * 1000;
    if (lastFinishMs == null || end > lastFinishMs) lastFinishMs = end;
  }
  const firstLapAt = firstLap ? firstLap.startedAt.toISOString() : null;
  const lastLapEndAt = lastFinishMs != null ? new Date(lastFinishMs).toISOString() : null;
  const coverageSeconds =
    firstLap && lastFinishMs != null ? Math.round((lastFinishMs - firstLap.startedAt.getTime()) / 1000) : null;

  // Initial plan: rotation of estimates/default across the full roster.
  let initialProjectedLaps = 0;
  const n = runners.length;
  const cutoff = endAt.getTime();
  if (n > 0) {
    let t = startAt.getTime();
    for (let k = 0; k < 1000 && t < cutoff; k++) {
      const r = runners[k % n];
      initialProjectedLaps++;
      t += (r.estimatedLapSeconds ?? defaultLapSeconds) * 1000;
    }
  }

  // Longest back-to-back streak per runner (consecutive records in time order).
  const streakByRunner = new Map<string, number>();
  {
    let curId: string | null = null;
    let curLen = 0;
    for (const l of allLaps) {
      if (l.runnerId === curId) curLen++;
      else {
        curId = l.runnerId;
        curLen = 1;
      }
      streakByRunner.set(curId, Math.max(streakByRunner.get(curId) ?? 0, curLen));
    }
  }

  // --- Per-runner recap (only runners who actually ran) ---
  const runnerRecaps: RunnerRecap[] = [];
  for (const r of runners) {
    const laps = r.laps;
    if (laps.length === 0) continue;
    const lapCount = laps.reduce((a, l) => a + l.laps, 0);
    const totalElapsed = laps.reduce((a, l) => a + l.elapsedTimeSec, 0);
    const totalMoving = laps.reduce((a, l) => a + l.movingTimeSec, 0);
    const milesRun = laps.reduce((a, l) => a + l.distanceMeters, 0) / METERS_PER_MILE;
    const singleLapTimes = laps.filter((l) => l.laps === 1).map((l) => l.elapsedTimeSec);

    // Consistency: population stdev of single-lap elapsed times (require >= 3).
    const consistencyStddevSec = consistencyStats(singleLapTimes).stddev;

    // Improvement: first-half vs second-half avg elapsed per single lap (require >= 4 records).
    let improvementPct: number | null = null;
    if (laps.length >= 4) {
      const half = Math.floor(laps.length / 2);
      const avg = (arr: typeof laps) => arr.reduce((a, l) => a + l.elapsedTimeSec / l.laps, 0) / arr.length;
      const firstAvg = avg(laps.slice(0, half));
      const secondAvg = avg(laps.slice(laps.length - half));
      if (firstAvg > 0) improvementPct = Math.round(((firstAvg - secondAvg) / firstAvg) * 1000) / 10;
    }

    runnerRecaps.push({
      id: r.id,
      name: r.name,
      active: r.active,
      lapCount,
      totalMiles: round1(milesRun),
      avgLapSeconds: lapCount > 0 ? Math.round(totalElapsed / lapCount) : null,
      fastestLapSeconds: singleLapTimes.length ? Math.min(...singleLapTimes) : null,
      avgPaceSecPerMile: milesRun > 0 ? Math.round(totalMoving / milesRun) : null,
      nightLaps: laps.reduce((a, l) => a + (isLondonNight(l.startedAt) ? l.laps : 0), 0),
      biggestEffortLaps: laps.reduce((a, l) => Math.max(a, l.laps), 0),
      longestStreak: streakByRunner.get(r.id) ?? 0,
      consistencyStddevSec,
      improvementPct,
      awards: [],
    });
  }
  runnerRecaps.sort(
    (a, b) => b.lapCount - a.lapCount || b.totalMiles - a.totalMiles || a.name.localeCompare(b.name)
  );

  // --- Awards ---
  const awards: Award[] = [];
  const recapById = new Map(runnerRecaps.map((r) => [r.id, r]));
  const firstLapMsById = new Map<string, number>();
  for (const r of runners) if (r.laps[0]) firstLapMsById.set(r.id, r.laps[0].startedAt.getTime());

  const pick = (
    filter: (r: RunnerRecap) => boolean,
    cmp: (a: RunnerRecap, b: RunnerRecap) => number
  ): RunnerRecap | null => {
    const pool = runnerRecaps.filter(filter);
    return pool.length ? pool.slice().sort(cmp)[0] : null;
  };
  const award = (
    w: RunnerRecap | null,
    key: string, emoji: string, title: string, blurb: string,
    value: number, valueKind: Award["valueKind"]
  ) => {
    if (!w) return;
    awards.push({ key, emoji, title, blurb, runnerId: w.id, runnerName: w.name, value, valueKind });
    w.awards.push(key);
  };

  const mostLaps = pick(
    (r) => r.lapCount > 0,
    (a, b) => b.lapCount - a.lapCount || b.totalMiles - a.totalMiles || firstLapMsById.get(a.id)! - firstLapMsById.get(b.id)!
  );
  award(mostLaps, "most_laps", "🏆", "Iron Legs", "Most laps run", mostLaps?.lapCount ?? 0, "laps");

  const speed = pick((r) => r.fastestLapSeconds != null, (a, b) => a.fastestLapSeconds! - b.fastestLapSeconds!);
  award(speed, "fastest_lap", "⚡", "Speed Demon", "Fastest single lap", speed?.fastestLapSeconds ?? 0, "duration");

  const owl = pick((r) => r.nightLaps > 0, (a, b) => b.nightLaps - a.nightLaps || b.lapCount - a.lapCount);
  award(owl, "night_owl", "🌙", "Night Owl", "Most laps 10pm–6am", owl?.nightLaps ?? 0, "count");

  const metro = pick((r) => r.consistencyStddevSec != null, (a, b) => a.consistencyStddevSec! - b.consistencyStddevSec!);
  award(metro, "metronome", "🎯", "Metronome", "Most consistent lap times", metro?.consistencyStddevSec ?? 0, "stdev");

  const improved = pick(
    (r) => r.improvementPct != null && r.improvementPct > 0,
    (a, b) => b.improvementPct! - a.improvementPct!
  );
  award(improved, "most_improved", "📈", "Most Improved", "Faster 2nd half vs 1st", improved?.improvementPct ?? 0, "pct");

  const beast = pick((r) => r.biggestEffortLaps >= 2, (a, b) => b.biggestEffortLaps - a.biggestEffortLaps || b.totalMiles - a.totalMiles);
  award(beast, "biggest_effort", "💪", "Beast Mode", "Biggest single effort", beast?.biggestEffortLaps ?? 0, "laps");

  const roll = pick((r) => r.longestStreak >= 2, (a, b) => b.longestStreak - a.longestStreak || b.lapCount - a.lapCount);
  award(roll, "streak", "🔁", "On a Roll", "Longest back-to-back streak", roll?.longestStreak ?? 0, "count");

  // 🌅 Sunrise Shift — the dawn lap: among laps that started in the [4am, 8am)
  // London window, the earliest by local time-of-day.
  {
    let sunriseLap: (typeof allLaps)[number] | null = null;
    let bestTod = Infinity;
    for (const l of allLaps) {
      const { h, m } = londonHourMinute(l.startedAt);
      if (h < 4 || h >= 8) continue;
      const tod = h * 60 + m;
      if (tod < bestTod) {
        bestTod = tod;
        sunriseLap = l;
      }
    }
    const w = sunriseLap ? recapById.get(sunriseLap.runnerId) : null;
    if (sunriseLap && w) award(w, "sunrise", "🌅", "Sunrise Shift", "Ran the dawn lap", bestTod, "clock");
  }

  return {
    eventName: config.eventName,
    teamName: config.teamName,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    finished: now >= endAt,
    totalLaps,
    totalMiles: round1(teamMiles),
    teamAvgLapSeconds,
    teamAvgPaceSecPerMile,
    fastestLap,
    nightLaps,
    manualLaps,
    stravaLaps,
    movingSeconds,
    elapsedSeconds,
    effortPct,
    biggestEffort,
    firstLapAt,
    lastLapEndAt,
    coverageSeconds,
    initialProjectedLaps,
    planDelta: totalLaps - initialProjectedLaps,
    runners: runnerRecaps,
    awards,
  };
}
