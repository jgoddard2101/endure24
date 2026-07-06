import { PrismaClient } from "@prisma/client";
import { METERS_PER_MILE } from "./config";
import { consistencyStats, isLondonNight, londonHourMinute, type Award } from "./stats";

// The four teams are separate schemas inside ONE shared Neon DB, so a single
// instance can read them all by swapping the `schema` query param on its own
// DATABASE_URL. Team A uses the default `public` schema.
const CLUB: [team: string, schema: string][] = [
  ["A", "public"],
  ["B", "team_b"],
  ["C", "team_c"],
  ["D", "team_d"],
];

function urlFor(schema: string): string {
  const u = new URL(process.env.DATABASE_URL!);
  u.searchParams.set("schema", schema);
  u.searchParams.set("connection_limit", "1"); // 4 clients share one DB — keep pools small
  return u.toString();
}

// Cache a client per schema (module scope; Fluid Compute reuses instances).
const clients = new Map<string, PrismaClient>();
function clientFor(schema: string): PrismaClient {
  let c = clients.get(schema);
  if (!c) {
    c = new PrismaClient({ datasources: { db: { url: urlFor(schema) } } });
    clients.set(schema, c);
  }
  return c;
}

export interface ClubRunner {
  id: string;
  name: string;
  team: string; // "A".."D"
  teamName: string;
  lapCount: number; // weighted
  totalMiles: number;
  avgLapSeconds: number | null;
  fastestSec: number | null; // single-lap min
  slowestSec: number | null; // single-lap max
  stddevSec: number | null; // null if < 3 single laps
  cvPct: number | null;
  adj1Sec: number | null; // mean + 1σ
  adj2Sec: number | null; // mean + 2σ
  nightLaps: number;
  awards: string[];
}

export interface TeamStanding {
  team: string;
  teamName: string;
  laps: number;
  miles: number;
}

export interface ClubRecap {
  eventName: string;
  teams: TeamStanding[];
  runners: ClubRunner[];
  awards: Award[];
  totalLaps: number;
  totalMiles: number;
  runnerCount: number;
  generatedAt: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Cross-team recap: field-wide accolades + a combined runner leaderboard. */
export async function getClubRecap(): Promise<ClubRecap> {
  const teams: TeamStanding[] = [];
  const runners: ClubRunner[] = [];
  // Award-only extras kept alongside each runner (not serialized in ClubRunner).
  const extra = new Map<string, { totalMiles: number; firstLapMs: number; biggestEffortLaps: number; longestStreak: number; improvementPct: number | null }>();
  let eventName = "Endure24";
  let sunrise: { tod: number; runnerId: string } | null = null;

  for (const [team, schema] of CLUB) {
    try {
      const db = clientFor(schema);
      const cfg = await db.eventConfig.findFirst();
      const teamName = cfg?.teamName ?? team;
      if (cfg?.eventName) eventName = cfg.eventName;
      const rs = await db.runner.findMany({ include: { laps: { orderBy: { startedAt: "asc" } } } });

      // Longest back-to-back streak per runner, across this team's whole timeline.
      const timeline = rs.flatMap((r) => r.laps).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
      const streakByRunner = new Map<string, number>();
      let curId: string | null = null;
      let curLen = 0;
      for (const l of timeline) {
        if (l.runnerId === curId) curLen++;
        else {
          curId = l.runnerId;
          curLen = 1;
        }
        streakByRunner.set(curId, Math.max(streakByRunner.get(curId) ?? 0, curLen));
      }

      let teamLaps = 0;
      let teamMiles = 0;
      for (const r of rs) {
        const laps = r.laps;
        if (laps.length === 0) continue;
        const lapCount = laps.reduce((a, l) => a + l.laps, 0);
        const totalElapsed = laps.reduce((a, l) => a + l.elapsedTimeSec, 0);
        const milesRun = laps.reduce((a, l) => a + l.distanceMeters, 0) / METERS_PER_MILE;
        const single = laps.filter((l) => l.laps === 1).map((l) => l.elapsedTimeSec);
        const cs = consistencyStats(single);

        let improvementPct: number | null = null;
        if (laps.length >= 4) {
          const half = Math.floor(laps.length / 2);
          const avg = (arr: typeof laps) => arr.reduce((a, l) => a + l.elapsedTimeSec / l.laps, 0) / arr.length;
          const firstAvg = avg(laps.slice(0, half));
          const secondAvg = avg(laps.slice(laps.length - half));
          if (firstAvg > 0) improvementPct = Math.round(((firstAvg - secondAvg) / firstAvg) * 1000) / 10;
        }

        teamLaps += lapCount;
        teamMiles += milesRun;
        runners.push({
          id: r.id,
          name: r.name,
          team,
          teamName,
          lapCount,
          totalMiles: round1(milesRun),
          avgLapSeconds: lapCount > 0 ? Math.round(totalElapsed / lapCount) : null,
          fastestSec: cs.min,
          slowestSec: cs.max,
          stddevSec: cs.stddev,
          cvPct: cs.cv,
          adj1Sec: cs.adj1,
          adj2Sec: cs.adj2,
          nightLaps: laps.reduce((a, l) => a + (isLondonNight(l.startedAt) ? l.laps : 0), 0),
          awards: [],
        });
        extra.set(r.id, {
          totalMiles: milesRun,
          firstLapMs: laps[0].startedAt.getTime(),
          biggestEffortLaps: laps.reduce((a, l) => Math.max(a, l.laps), 0),
          longestStreak: streakByRunner.get(r.id) ?? 0,
          improvementPct,
        });

        // Field-wide sunrise: earliest lap in the [4am, 8am) London window.
        for (const l of laps) {
          const { h, m } = londonHourMinute(l.startedAt);
          if (h < 4 || h >= 8) continue;
          const tod = h * 60 + m;
          if (!sunrise || tod < sunrise.tod) sunrise = { tod, runnerId: r.id };
        }
      }
      teams.push({ team, teamName, laps: teamLaps, miles: round1(teamMiles) });
    } catch (e) {
      console.error(`[club] team ${team} (${schema}) failed`, e);
    }
  }

  // --- Field-wide awards (same formulas/thresholds/tie-breaks as getEventSummary) ---
  const awards: Award[] = [];
  const byId = new Map(runners.map((r) => [r.id, r]));
  const ex = (id: string) => extra.get(id)!;
  const pick = (filter: (r: ClubRunner) => boolean, cmp: (a: ClubRunner, b: ClubRunner) => number): ClubRunner | null => {
    const pool = runners.filter(filter);
    return pool.length ? pool.slice().sort(cmp)[0] : null;
  };
  const give = (
    w: ClubRunner | null,
    key: string, emoji: string, title: string, blurb: string,
    value: number, valueKind: Award["valueKind"]
  ) => {
    if (!w) return;
    awards.push({ key, emoji, title, blurb, runnerId: w.id, runnerName: w.name, team: w.team, value, valueKind });
    w.awards.push(key);
  };

  const mostLaps = pick(
    (r) => r.lapCount > 0,
    (a, b) => b.lapCount - a.lapCount || ex(b.id).totalMiles - ex(a.id).totalMiles || ex(a.id).firstLapMs - ex(b.id).firstLapMs
  );
  give(mostLaps, "most_laps", "🏆", "Iron Legs", "Most laps run", mostLaps?.lapCount ?? 0, "laps");

  const speed = pick((r) => r.fastestSec != null, (a, b) => a.fastestSec! - b.fastestSec!);
  give(speed, "fastest_lap", "⚡", "Speed Demon", "Fastest single lap", speed?.fastestSec ?? 0, "duration");

  const owl = pick((r) => r.nightLaps > 0, (a, b) => b.nightLaps - a.nightLaps || b.lapCount - a.lapCount);
  give(owl, "night_owl", "🌙", "Night Owl", "Most laps 10pm–6am", owl?.nightLaps ?? 0, "count");

  const metro = pick((r) => r.stddevSec != null, (a, b) => a.stddevSec! - b.stddevSec!);
  give(metro, "metronome", "🎯", "Metronome", "Most consistent lap times", metro?.stddevSec ?? 0, "stdev");

  const improved = pick(
    (r) => ex(r.id).improvementPct != null && ex(r.id).improvementPct! > 0,
    (a, b) => ex(b.id).improvementPct! - ex(a.id).improvementPct!
  );
  give(improved, "most_improved", "📈", "Most Improved", "Faster 2nd half vs 1st", improved ? ex(improved.id).improvementPct! : 0, "pct");

  const beast = pick(
    (r) => ex(r.id).biggestEffortLaps >= 2,
    (a, b) => ex(b.id).biggestEffortLaps - ex(a.id).biggestEffortLaps || ex(b.id).totalMiles - ex(a.id).totalMiles
  );
  give(beast, "biggest_effort", "💪", "Beast Mode", "Biggest single effort", beast ? ex(beast.id).biggestEffortLaps : 0, "laps");

  const roll = pick(
    (r) => ex(r.id).longestStreak >= 2,
    (a, b) => ex(b.id).longestStreak - ex(a.id).longestStreak || b.lapCount - a.lapCount
  );
  give(roll, "streak", "🔁", "On a Roll", "Longest back-to-back streak", roll ? ex(roll.id).longestStreak : 0, "count");

  if (sunrise) {
    const w = byId.get(sunrise.runnerId);
    if (w) give(w, "sunrise", "🌅", "Sunrise Shift", "Ran the dawn lap", sunrise.tod, "clock");
  }

  // Default leaderboard order: consistency-adjusted (mean+1σ) ascending, nulls last.
  runners.sort(
    (a, b) =>
      (a.adj1Sec == null ? 1 : 0) - (b.adj1Sec == null ? 1 : 0) ||
      (a.adj1Sec ?? 0) - (b.adj1Sec ?? 0) ||
      b.lapCount - a.lapCount ||
      a.name.localeCompare(b.name)
  );
  teams.sort((a, b) => b.laps - a.laps || b.miles - a.miles);

  return {
    eventName,
    teams,
    runners,
    awards,
    totalLaps: teams.reduce((a, t) => a + t.laps, 0),
    totalMiles: round1(teams.reduce((a, t) => a + t.miles, 0)),
    runnerCount: runners.length,
    generatedAt: new Date().toISOString(),
  };
}
