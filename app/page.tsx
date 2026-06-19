"use client";

import { useEffect, useState } from "react";
import type { DashboardState } from "@/lib/stats";
import { formatDuration, formatPace, formatRelative, formatClock } from "@/lib/format";

export default function Dashboard() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // Poll the server every 15s; tick locally every second for live countdowns.
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        const data = await res.json();
        if (active) {
          if (data.error) setError(data.error);
          else {
            setState(data);
            setError(null);
          }
        }
      } catch (e) {
        if (active) setError(String(e));
      }
    };
    load();
    const poll = setInterval(load, 15000);
    const tick = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      active = false;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  if (error) return <Centered>⚠️ {error}</Centered>;
  if (!state) return <Centered>Loading…</Centered>;

  const nowIso = new Date().toISOString();
  const current = state.runners.find((r) => r.id === state.currentRunnerId);
  const upNext = state.runners
    .filter((r) => !r.onCourse && r.nextStartAt)
    .sort((a, b) => new Date(a.nextStartAt!).getTime() - new Date(b.nextStartAt!).getTime());

  const remaining = state.finished
    ? 0
    : Math.max(0, Math.round((new Date(state.endAt).getTime() - Date.now()) / 1000));

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      {/* Header */}
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{state.teamName}</h1>
          <p className="text-sm text-slate-400">{state.eventName}</p>
        </div>
        <a href="/admin" className="text-xs text-slate-500 hover:text-slate-300 underline">
          admin
        </a>
      </header>

      {/* Countdown banner */}
      <div className="mt-4 rounded-xl bg-slate-800/60 px-4 py-3 text-center">
        {!state.started ? (
          <p className="text-amber-300">Starts {formatClock(state.startAt)} · {formatRelative(state.startAt, nowIso)}</p>
        ) : state.finished ? (
          <p className="text-emerald-300 font-semibold">🏁 Event complete — {state.totalLaps} laps, {state.totalMiles} mi</p>
        ) : (
          <p className="text-lg">
            <span className="text-slate-400 text-sm">Time remaining</span>{" "}
            <span className="font-mono font-bold text-emerald-300">{formatDuration(remaining)}</span>
          </p>
        )}
      </div>

      {/* On course now */}
      <section className="mt-4 rounded-2xl bg-gradient-to-br from-orange-600/30 to-rose-600/20 ring-1 ring-orange-500/30 p-5">
        <p className="text-xs uppercase tracking-widest text-orange-300/80">On course now</p>
        {current ? (
          <>
            <p className="mt-1 text-3xl font-extrabold">{current.name}</p>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <Stat label="Out for" value={formatDuration(state.onCourseSince ? (Date.now() - new Date(state.onCourseSince).getTime()) / 1000 : null)} />
              <Stat label="Est. finish" value={formatClock(current.estimatedFinishAt)} sub={formatRelative(current.estimatedFinishAt, nowIso)} />
            </div>
            {state.isManualOverride && <p className="mt-2 text-xs text-orange-300/70">manually set</p>}
          </>
        ) : (
          <p className="mt-1 text-xl text-slate-300">No one assigned — set in admin</p>
        )}
      </section>

      {/* Up next queue */}
      <section className="mt-4">
        <h2 className="text-sm font-semibold text-slate-400 mb-2">Up next</h2>
        <div className="space-y-2">
          {upNext.length === 0 && <p className="text-slate-500 text-sm">No upcoming runners.</p>}
          {upNext.map((r, i) => (
            <div key={r.id} className="flex items-center justify-between rounded-lg bg-slate-800/50 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="text-slate-500 font-mono text-sm w-5">{i + 1}</span>
                <span className="font-medium">{r.name}</span>
                {!r.authorized && <span className="text-[10px] text-amber-400">⚠ not linked</span>}
              </div>
              <div className="text-right">
                <p className="font-mono text-emerald-300">{formatRelative(r.nextStartAt, nowIso)}</p>
                <p className="text-xs text-slate-500">~{formatClock(r.nextStartAt)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Team stats */}
      <section className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card label="Total laps" value={String(state.totalLaps)} />
        <Card label="Total miles" value={String(state.totalMiles)} />
        <Card label="Projected laps" value={String(state.projectedTotalLaps)} hint="at 24h" />
        <Card label="Avg lap" value={formatDuration(state.teamAvgLapSeconds)} />
        <Card
          label="Fastest lap"
          value={state.fastestLap ? formatDuration(state.fastestLap.seconds) : "–"}
          hint={state.fastestLap?.runnerName}
        />
        <Card label="Lap distance" value={`${state.lapDistanceMiles} mi`} />
      </section>

      {/* Per-runner breakdown */}
      <section className="mt-5">
        <h2 className="text-sm font-semibold text-slate-400 mb-2">Runners</h2>
        <div className="overflow-x-auto rounded-xl ring-1 ring-slate-800">
          <table className="w-full text-sm">
            <thead className="text-slate-500 text-xs">
              <tr className="text-left">
                <th className="px-3 py-2">Runner</th>
                <th className="px-3 py-2 text-right">Laps</th>
                <th className="px-3 py-2 text-right">Miles</th>
                <th className="px-3 py-2 text-right">Avg lap</th>
                <th className="px-3 py-2 text-right">Pace</th>
              </tr>
            </thead>
            <tbody>
              {[...state.runners]
                .sort((a, b) => b.lapCount - a.lapCount)
                .map((r) => (
                  <tr key={r.id} className="border-t border-slate-800/70">
                    <td className="px-3 py-2">
                      {r.onCourse && <span className="mr-1">🏃</span>}
                      {r.name}
                      {!r.authorized && <span className="ml-1 text-[10px] text-amber-400">⚠</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{r.lapCount}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.totalMiles}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatDuration(r.avgLapSeconds)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatPace(r.avgPaceSecPerMile)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Recent laps */}
      <section className="mt-5 mb-10">
        <h2 className="text-sm font-semibold text-slate-400 mb-2">Recent laps</h2>
        <div className="space-y-1">
          {state.recentLaps.length === 0 && <p className="text-slate-500 text-sm">No laps yet.</p>}
          {state.recentLaps.map((l) => (
            <div key={l.id} className="flex items-center justify-between rounded-lg bg-slate-800/30 px-3 py-2 text-sm">
              <span>
                {l.runnerName}
                {l.source === "manual" && <span className="ml-1 text-[10px] text-slate-500">(manual)</span>}
              </span>
              <span className="text-slate-400 font-mono">
                {l.miles} mi · {formatDuration(l.movingSeconds)} · {formatClock(l.startedAt)}
              </span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-black/20 px-3 py-2">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="font-mono font-bold text-lg">{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-slate-800/50 px-4 py-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-xl font-bold font-mono">{value}</p>
      {hint && <p className="text-xs text-slate-500 truncate">{hint}</p>}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center text-slate-400">{children}</div>;
}
