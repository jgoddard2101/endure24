"use client";

import { useEffect, useState } from "react";
import type { DashboardState } from "@/lib/stats";
import { formatDuration, formatPace, formatDistance, formatRelative, formatClock, milesToUnit, type Unit } from "@/lib/format";

export default function Dashboard() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [unit, setUnit] = useState<Unit>("mi");

  // Load the viewer's saved unit preference (mi/km) on mount.
  useEffect(() => {
    const saved = localStorage.getItem("endure24_unit");
    if (saved === "mi" || saved === "km") setUnit(saved);
  }, []);

  const toggleUnit = () => {
    setUnit((u) => {
      const next = u === "mi" ? "km" : "mi";
      localStorage.setItem("endure24_unit", next);
      return next;
    });
  };

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
        <div className="flex items-center gap-3">
          <UnitToggle unit={unit} onToggle={toggleUnit} />
          <a href="/admin" className="text-xs text-slate-500 hover:text-slate-300 underline">
            admin
          </a>
        </div>
      </header>

      {/* Countdown banner */}
      <div className="mt-4 rounded-xl bg-slate-800/60 px-4 py-3 text-center">
        {!state.started ? (
          <p className="text-amber-300">Starts {formatClock(state.startAt)} · {formatRelative(state.startAt, nowIso)}</p>
        ) : state.finished ? (
          <p className="text-emerald-300 font-semibold">🏁 Event complete — {state.totalLaps} laps, {formatDistance(state.totalMiles, unit)}</p>
        ) : (
          <>
            <p className="text-lg">
              <span className="text-slate-400 text-sm">Time to start last lap</span>{" "}
              <span className="font-mono font-bold text-emerald-300">{formatDuration(remaining)}</span>
            </p>
            <p className="text-xs text-slate-500 mt-1">
              New laps can start until {formatClock(state.endAt)} · in-progress laps must finish by {formatClock(state.finishBy)}
            </p>
          </>
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
        <Card label={`Total ${unit === "km" ? "km" : "miles"}`} value={formatDistance(state.totalMiles, unit, false)} />
        <Card label="Projected laps" value={String(state.projectedTotalLaps)} hint="at 24h" />
        <Card label="Avg lap" value={formatDuration(state.teamAvgLapSeconds)} />
        <Card
          label="Fastest lap"
          value={state.fastestLap ? formatDuration(state.fastestLap.seconds) : "–"}
          hint={state.fastestLap?.runnerName}
        />
        <Card label="Lap distance" value={formatDistance(state.lapDistanceMiles, unit)} />
      </section>

      {/* Push for one more lap */}
      {state.extraLapGainSeconds != null && state.extraLapGainSeconds > 0 && (
        <section className="mt-5 rounded-xl ring-1 ring-orange-500/30 bg-orange-600/10 p-4">
          <h2 className="text-sm font-semibold text-orange-300 mb-1">🎯 Push for one more lap</h2>
          <p className="text-sm text-slate-300">
            Projected <b>{state.projectedTotalLaps}</b> laps. To squeeze in <b>one more</b>, the team needs to claw back{" "}
            <b className="text-orange-200">{formatDuration(state.extraLapGainSeconds)}</b> before the last-lap cutoff at{" "}
            {formatClock(state.endAt)}.
          </p>
          {(() => {
            const helpers = state.runners
              .filter((r) => r.secondsFasterForExtraLap != null)
              .sort((a, b) => a.secondsFasterForExtraLap! - b.secondsFasterForExtraLap!);
            if (helpers.length === 0)
              return (
                <p className="text-xs text-slate-400 mt-2">No single runner can make that up alone — it’ll take a team effort.</p>
              );
            return (
              <>
                <p className="text-xs text-slate-400 mt-3 mb-1">
                  …or if just one runner picks it up, how much faster they’d need to average per lap:
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {helpers.map((r) => (
                    <div key={r.id} className="rounded-lg bg-black/20 px-3 py-2 text-sm">
                      <span className="font-medium">{r.name}</span>
                      <span className="block font-mono text-orange-200">{formatDuration(r.secondsFasterForExtraLap!)}/lap</span>
                      <span className="block text-[11px] text-slate-500">
                        ≈ {formatDuration(r.secondsFasterForExtraLap! / milesToUnit(state.lapDistanceMiles, unit))}/{unit} quicker
                      </span>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </section>
      )}

      {/* Per-runner breakdown */}
      <section className="mt-5">
        <h2 className="text-sm font-semibold text-slate-400 mb-2">Runners</h2>
        <div className="overflow-x-auto rounded-xl ring-1 ring-slate-800">
          <table className="w-full text-sm">
            <thead className="text-slate-500 text-xs">
              <tr className="text-left">
                <th className="px-3 py-2">Runner</th>
                <th className="px-3 py-2 text-right">Laps</th>
                <th className="px-3 py-2 text-right">{unit === "km" ? "Km" : "Miles"}</th>
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
                    <td className="px-3 py-2 text-right font-mono">{formatDistance(r.totalMiles, unit, false)}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {r.avgLapSeconds != null ? (
                        formatDuration(r.avgLapSeconds)
                      ) : r.expectedBasis === "estimate" ? (
                        <span className="text-slate-500">{formatDuration(r.expectedLapSeconds)} <span className="text-[10px]">est</span></span>
                      ) : (
                        "–"
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{formatPace(r.avgPaceSecPerMile, unit)}</td>
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
                {formatDistance(l.miles, unit)} · {formatDuration(l.movingSeconds)} · {formatClock(l.startedAt)}
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

function UnitToggle({ unit, onToggle }: { unit: Unit; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-label="Toggle distance units"
      className="flex items-center rounded-full bg-slate-800 ring-1 ring-slate-700 p-0.5 text-xs font-medium"
    >
      {(["mi", "km"] as Unit[]).map((u) => (
        <span
          key={u}
          className={`px-2.5 py-1 rounded-full transition-colors ${
            unit === u ? "bg-orange-600 text-white" : "text-slate-400"
          }`}
        >
          {u}
        </span>
      ))}
    </button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center text-slate-400">{children}</div>;
}
