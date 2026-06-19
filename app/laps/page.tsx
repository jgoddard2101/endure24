"use client";

import { formatDuration, formatDistance, formatClock } from "@/lib/format";
import { useUnit } from "../components/useUnit";
import { useDashboardState } from "../components/useDashboardState";
import Nav from "../components/Nav";
import type { ScheduleEntry } from "@/lib/stats";

export default function LapsPage() {
  const [unit, toggleUnit] = useUnit();
  const { state, error } = useDashboardState(30000);

  if (error) return <Centered>⚠️ {error}</Centered>;
  if (!state) return <Centered>Loading…</Centered>;

  const doneCount = state.schedule.filter((s) => s.status !== "forecast").length;
  const forecastCount = state.schedule.filter((s) => s.status === "forecast").length;

  const lapLabel = (e: ScheduleEntry) =>
    e.laps > 1 ? `Laps ${e.fromLap}–${e.fromLap + e.laps - 1}` : `Lap ${e.fromLap}`;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Nav teamName={state.teamName} eventName={state.eventName} active="laps" unit={unit} onToggleUnit={toggleUnit} />

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold">Lap schedule</h2>
        <p className="text-xs text-slate-400">
          <span className="text-emerald-400">{doneCount} done</span> ·{" "}
          <span className="text-slate-500">{forecastCount} forecast</span>
        </p>
      </div>

      <div className="space-y-1.5">
        {state.schedule.map((e) => {
          const forecast = e.status === "forecast";
          const running = e.status === "running";
          return (
            <div
              key={`${e.status}-${e.fromLap}`}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${
                running
                  ? "bg-orange-600/15 ring-1 ring-orange-500/40"
                  : forecast
                  ? "bg-transparent border border-dashed border-slate-700/70 text-slate-500"
                  : "bg-slate-800/50"
              }`}
            >
              <span className={`font-mono w-16 shrink-0 ${forecast ? "text-slate-500" : "text-slate-400"}`}>
                {lapLabel(e)}
              </span>
              <span className={`flex-1 font-medium ${forecast ? "text-slate-400" : ""}`}>
                {e.runnerName}
                {running && <span className="ml-2 text-[10px] uppercase text-orange-300">running</span>}
                {forecast && <span className="ml-2 text-[10px] uppercase text-slate-600">forecast</span>}
              </span>
              <span className="font-mono tabular-nums text-right">
                {formatClock(e.atISO)} · {formatDuration(e.seconds)} · {formatDistance(e.miles, unit)}
              </span>
            </div>
          );
        })}
        {state.schedule.length === 0 && <p className="text-slate-500 text-sm">No laps yet.</p>}
      </div>

      <div className="mt-4 flex gap-4 justify-center text-xs text-slate-500">
        <span><span className="text-emerald-400">●</span> completed</span>
        <span><span className="text-orange-300">●</span> on course</span>
        <span><span className="text-slate-500">●</span> forecast (estimated)</span>
      </div>
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center text-slate-400">{children}</div>;
}
