"use client";

import { formatDuration, formatPace, formatDistance, milesToUnit } from "@/lib/format";
import { useUnit } from "../components/useUnit";
import { useDashboardState } from "../components/useDashboardState";
import Nav from "../components/Nav";
import DistanceChart from "../components/DistanceChart";

export default function StatsPage() {
  const [unit, toggleUnit] = useUnit();
  const { state, error } = useDashboardState(30000);

  if (error) return <Centered>⚠️ {error}</Centered>;
  if (!state) return <Centered>Loading…</Centered>;

  const lapDelta = state.projectedTotalLaps - state.initialProjectedLaps;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Nav teamName={state.teamName} eventName={state.eventName} active="stats" unit={unit} onToggleUnit={toggleUnit} />

      {/* Totals */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="Total laps" value={String(state.totalLaps)} />
        <Card label="Total distance" value={formatDistance(state.totalMiles, unit)} />
        <Card label="Projected laps" value={String(state.projectedTotalLaps)} hint="at the cutoff" />
        <Card label="Avg lap" value={formatDuration(state.teamAvgLapSeconds)} />
      </section>

      {/* Push for one more lap */}
      {state.extraLapGainSeconds != null && state.extraLapGainSeconds > 0 && (
        <section className="mt-5 rounded-xl ring-1 ring-orange-500/30 bg-orange-600/10 p-4">
          <h2 className="text-sm font-semibold text-orange-300 mb-1">🎯 Push for one more lap</h2>
          <p className="text-sm text-slate-300">
            Projected <b>{state.projectedTotalLaps}</b> laps. To squeeze in <b>one more</b>, the team needs to claw back{" "}
            <b className="text-orange-200">{formatDuration(state.extraLapGainSeconds)}</b>
            {state.extraLapSpeedupPct != null && (
              <>
                {" "}— everyone digging in about <b className="text-orange-200">{state.extraLapSpeedupPct}% faster</b> per lap.
              </>
            )}
          </p>
          {(() => {
            const helpers = state.runners.filter((r) => r.collectiveSecondsFasterPerLap != null);
            if (helpers.length === 0) return null;
            return (
              <>
                <p className="text-xs text-slate-400 mt-3 mb-1">Each runner&apos;s share (faster per lap, on average):</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {helpers.map((r) => (
                    <div key={r.id} className="rounded-lg bg-black/20 px-3 py-2 text-sm">
                      <span className="font-medium">{r.name}</span>
                      <span className="block font-mono text-orange-200">
                        {formatDuration(r.collectiveSecondsFasterPerLap!)}/lap faster
                      </span>
                      <span className="block text-[11px] text-slate-500">
                        ≈ {formatDuration(r.collectiveSecondsFasterPerLap! / milesToUnit(state.lapDistanceMiles, unit))}/{unit} quicker
                      </span>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </section>
      )}

      {/* Chart */}
      <section className="mt-5 rounded-xl ring-1 ring-slate-800 p-4">
        <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-slate-300">Distance over time</h2>
          <p className="text-xs text-slate-400">
            Projected <b className="text-slate-200">{state.projectedTotalLaps}</b> vs initial plan{" "}
            <b className="text-slate-200">{state.initialProjectedLaps}</b>{" "}
            {lapDelta === 0 ? (
              <span className="text-slate-500">(on plan)</span>
            ) : lapDelta > 0 ? (
              <span className="text-emerald-400">(+{lapDelta} ahead)</span>
            ) : (
              <span className="text-rose-400">({lapDelta} behind)</span>
            )}
          </p>
        </div>
        <DistanceChart
          startAt={state.chart.startAt}
          endAt={state.chart.endAt}
          actual={state.chart.actual}
          projected={state.chart.projected}
          initial={state.chart.initial}
          nowISO={state.now}
          unit={unit}
        />
      </section>

      {/* Per-runner */}
      <section className="mt-5 mb-10">
        <h2 className="text-sm font-semibold text-slate-400 mb-2">Per runner</h2>
        <div className="overflow-x-auto rounded-xl ring-1 ring-slate-800">
          <table className="w-full text-sm">
            <thead className="text-slate-500 text-xs">
              <tr className="text-left">
                <th className="px-3 py-2">Runner</th>
                <th className="px-3 py-2 text-right">Laps</th>
                <th className="px-3 py-2 text-right">On track</th>
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
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{r.lapCount}</td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-300">{r.projectedLaps}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatDistance(r.totalMiles, unit, false)}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {r.avgLapSeconds != null ? (
                        formatDuration(r.avgLapSeconds)
                      ) : r.expectedBasis === "estimate" ? (
                        <span className="text-slate-500">
                          {formatDuration(r.expectedLapSeconds)} <span className="text-[10px]">est</span>
                        </span>
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
    </main>
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
