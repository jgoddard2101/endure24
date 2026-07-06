"use client";

import { useEffect, useState } from "react";
import type { EventSummary, Award } from "@/lib/stats";
import { formatDistance, formatDuration, formatPace, type Unit } from "@/lib/format";
import { useUnit } from "../components/useUnit";
import Nav from "../components/Nav";

function awardValue(a: Award, unit: Unit): string {
  switch (a.valueKind) {
    case "laps":
      return `${a.value} lap${a.value === 1 ? "" : "s"}`;
    case "count":
      return String(a.value);
    case "duration":
      return formatDuration(a.value);
    case "stdev":
      return `±${formatDuration(a.value)}`;
    case "pct":
      return `${a.value}% faster`;
    case "miles":
      return formatDistance(a.value, unit);
    case "clock":
      return `${Math.floor(a.value / 60)}:${String(a.value % 60).padStart(2, "0")}`;
    default:
      return String(a.value);
  }
}

function dateRange(startIso: string, endIso: string): string {
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  const s = new Date(startIso).toLocaleDateString(undefined, opts);
  const e = new Date(endIso).toLocaleDateString(undefined, { ...opts, year: "numeric" });
  return `${s} – ${e}`;
}

export default function RecapPage() {
  const [unit, toggleUnit] = useUnit();
  const [summary, setSummary] = useState<EventSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/summary", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        if (d.error) setError(d.error);
        else setSummary(d);
      })
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, []);

  if (error) return <Centered>⚠️ {error}</Centered>;
  if (!summary) return <Centered>Loading…</Centered>;
  const s = summary;

  const emojiByKey: Record<string, string> = Object.fromEntries(s.awards.map((a) => [a.key, a.emoji]));

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Nav teamName={s.teamName} eventName={s.eventName} active="recap" unit={unit} onToggleUnit={toggleUnit} />

      {/* Hero */}
      <section className="rounded-2xl bg-gradient-to-br from-amber-500/40 via-orange-600/35 to-rose-600/30 ring-1 ring-orange-400/40 shadow-lg shadow-orange-950/40 p-5">
        <p className="text-xs uppercase tracking-wide text-orange-100/80">🏁 That&apos;s a wrap</p>
        <h2 className="text-3xl font-extrabold mt-1">{s.teamName}</h2>
        <p className="text-sm text-orange-100/80">
          {s.eventName} · {dateRange(s.startAt, s.endAt)}
        </p>
        {s.totalLaps > 0 && (
          <p className="mt-3 text-lg font-semibold">
            <span className="font-mono">{s.totalLaps}</span> laps ·{" "}
            <span className="font-mono">{formatDistance(s.totalMiles, unit)}</span> covered
          </p>
        )}
      </section>

      {s.totalLaps === 0 ? (
        <p className="mt-6 text-center text-slate-400">No laps were recorded for this team.</p>
      ) : (
        <>
          {/* Team totals */}
          <section className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card label="Total laps" value={String(s.totalLaps)} />
            <Card label="Total distance" value={formatDistance(s.totalMiles, unit)} />
            <Card label="Avg lap" value={formatDuration(s.teamAvgLapSeconds)} />
            <Card label="Avg pace" value={formatPace(s.teamAvgPaceSecPerMile, unit)} />
            <Card label="Night laps" value={String(s.nightLaps)} hint="10pm – 6am" />
            <Card label="Grind" value={s.effortPct != null ? `${s.effortPct}%` : "–"} hint="moving vs elapsed" />
            <Card label="Coverage" value={formatDuration(s.coverageSeconds)} hint="first to last lap" />
            <Card
              label="vs plan"
              value={`${s.planDelta >= 0 ? "+" : ""}${s.planDelta}`}
              hint={`plan was ${s.initialProjectedLaps}`}
              valueClass={s.planDelta > 0 ? "text-emerald-400" : s.planDelta < 0 ? "text-rose-400" : "text-slate-300"}
            />
          </section>
          <p className="mt-2 text-xs text-slate-500">
            {s.stravaLaps} via Strava · {s.manualLaps} logged manually
            {s.fastestLap && (
              <>
                {" "}
                · fastest lap {formatDuration(s.fastestLap.seconds)} by {s.fastestLap.runnerName}
              </>
            )}
          </p>

          {/* Awards */}
          {s.awards.length > 0 && (
            <section className="mt-6">
              <h2 className="text-sm font-semibold text-slate-400 mb-2">🏅 Awards</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {s.awards.map((a) => (
                  <div key={a.key} className="flex items-center gap-3 rounded-xl ring-1 ring-slate-800 p-4">
                    <span className="text-3xl">{a.emoji}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-emerald-300">{a.title}</p>
                      <p className="text-base font-bold truncate">{a.runnerName}</p>
                      <p className="text-xs text-slate-400 font-mono">
                        {awardValue(a, unit)} · {a.blurb}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Leaderboard */}
          <section className="mt-6 mb-10">
            <h2 className="text-sm font-semibold text-slate-400 mb-2">Leaderboard</h2>
            <div className="overflow-x-auto rounded-xl ring-1 ring-slate-800">
              <table className="w-full text-sm">
                <thead className="text-slate-500 text-xs">
                  <tr className="text-left">
                    <th className="px-3 py-2">Runner</th>
                    <th className="px-3 py-2 text-right">Laps</th>
                    <th className="px-3 py-2 text-right">{unit === "km" ? "Km" : "Miles"}</th>
                    <th className="px-3 py-2 text-right">Best</th>
                    <th className="px-3 py-2 text-right">Pace</th>
                    <th className="px-3 py-2 text-right">Night</th>
                  </tr>
                </thead>
                <tbody>
                  {s.runners.map((r, i) => (
                    <tr key={r.id} className="border-t border-slate-800/70">
                      <td className="px-3 py-2">
                        {i === 0 && <span className="mr-1">👑</span>}
                        {r.name}
                        {r.awards.map((k) => (
                          <span key={k} className="ml-1">
                            {emojiByKey[k]}
                          </span>
                        ))}
                        {!r.active && <span className="ml-1 text-[10px] text-slate-500">(dropped)</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{r.lapCount}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatDistance(r.totalMiles, unit, false)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatDuration(r.fastestLapSeconds)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatPace(r.avgPaceSecPerMile, unit)}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.nightLaps || "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function Card({
  label,
  value,
  hint,
  valueClass,
}: {
  label: string;
  value: string;
  hint?: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-xl bg-slate-800/50 px-4 py-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-xl font-bold font-mono ${valueClass ?? ""}`}>{value}</p>
      {hint && <p className="text-xs text-slate-500 truncate">{hint}</p>}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center text-slate-400">{children}</div>;
}
