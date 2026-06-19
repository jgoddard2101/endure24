"use client";

import { formatDuration, formatRelative, formatClock } from "@/lib/format";
import { useUnit } from "./components/useUnit";
import { useDashboardState } from "./components/useDashboardState";
import Nav from "./components/Nav";
import NotifyToggle from "./components/NotifyToggle";

const TRANSITION_LEAD_MIN = 10;

export default function Dashboard() {
  const [unit, toggleUnit] = useUnit();
  const { state, error } = useDashboardState(15000);

  if (error) return <Centered>⚠️ {error}</Centered>;
  if (!state) return <Centered>Loading…</Centered>;

  const nowIso = new Date().toISOString();
  const current = state.runners.find((r) => r.id === state.currentRunnerId) ?? null;
  const upNext =
    state.runners
      .filter((r) => !r.onCourse && r.nextStartAt)
      .sort((a, b) => new Date(a.nextStartAt!).getTime() - new Date(b.nextStartAt!).getTime())[0] ?? null;

  // Transition = 10 min before the current runner is due back.
  const dueBack = current?.estimatedFinishAt ?? upNext?.nextStartAt ?? null;
  const transitionAt = dueBack ? new Date(new Date(dueBack).getTime() - TRANSITION_LEAD_MIN * 60_000).toISOString() : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Nav teamName={state.teamName} eventName={state.eventName} active="dashboard" unit={unit} onToggleUnit={toggleUnit} />

      <NotifyToggle />

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {/* On course now */}
        <section className="rounded-2xl bg-gradient-to-br from-orange-600/30 to-rose-600/20 ring-1 ring-orange-500/30 p-5">
          <p className="text-xs uppercase tracking-widest text-orange-300/80">On course now</p>
          {current ? (
            <>
              <p className="mt-1 text-3xl font-extrabold leading-tight">{current.name}</p>
              {!state.started ? (
                <p className="mt-3 text-sm text-slate-300">
                  Event starts {formatClock(state.startAt)} · {formatRelative(state.startAt, nowIso)}
                </p>
              ) : (
                <div className="mt-3 space-y-1 text-sm">
                  <p className="text-slate-300">
                    Out for{" "}
                    <span className="font-mono font-bold text-white">
                      {formatDuration(state.onCourseSince ? (Date.now() - new Date(state.onCourseSince).getTime()) / 1000 : null)}
                    </span>
                  </p>
                  <p className="text-slate-300">
                    Due back ~<span className="font-mono font-bold text-white">{formatClock(current.estimatedFinishAt)}</span>{" "}
                    <span className="text-slate-400">({formatRelative(current.estimatedFinishAt, nowIso)})</span>
                  </p>
                </div>
              )}
              {state.isManualOverride && <p className="mt-2 text-xs text-orange-300/70">manually set</p>}
            </>
          ) : (
            <p className="mt-1 text-xl text-slate-300">No one assigned — set in admin</p>
          )}
        </section>

        {/* Up next */}
        <section className="rounded-2xl bg-gradient-to-br from-sky-600/30 to-indigo-600/20 ring-1 ring-sky-500/30 p-5">
          <p className="text-xs uppercase tracking-widest text-sky-300/80">Up next</p>
          {upNext ? (
            <>
              <p className="mt-1 text-3xl font-extrabold leading-tight">{upNext.name}</p>
              {transitionAt ? (
                <div className="mt-3 text-sm">
                  <p className="text-slate-300">Go to transition at</p>
                  <p className="text-2xl font-mono font-bold text-sky-200">{formatClock(transitionAt)}</p>
                  <p className="text-slate-400 mt-1">{formatRelative(transitionAt, nowIso)}</p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-300">Waiting for the event to start.</p>
              )}
              {!upNext.authorized && <p className="mt-2 text-xs text-amber-400">⚠ not linked to Strava</p>}
            </>
          ) : (
            <p className="mt-1 text-xl text-slate-300">—</p>
          )}
        </section>
      </div>

      <p className="mt-4 text-center text-sm text-slate-500">
        See the full lap schedule on <a href="/laps" className="underline hover:text-slate-300">Laps</a> · totals &amp; charts on{" "}
        <a href="/stats" className="underline hover:text-slate-300">Stats</a>.
      </p>
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center text-slate-400">{children}</div>;
}
