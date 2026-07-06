"use client";

import { useEffect, useMemo, useState } from "react";
import type { ClubRecap } from "@/lib/club";
import type { Award } from "@/lib/stats";
import { formatDistance, formatDuration, type Unit } from "@/lib/format";
import { useUnit } from "../components/useUnit";
import Nav from "../components/Nav";

type SortKey = "name" | "team" | "lapCount" | "avgLapSeconds" | "fastestSec" | "slowestSec" | "cvPct" | "adj1Sec";

const COLS: { key: SortKey; label: string; kind: "str" | "laps" | "time" | "cv"; hint?: string }[] = [
  { key: "name", label: "Runner", kind: "str" },
  { key: "team", label: "Team", kind: "str" },
  { key: "lapCount", label: "Laps", kind: "laps" },
  { key: "avgLapSeconds", label: "Avg", kind: "time" },
  { key: "fastestSec", label: "Fastest", kind: "time" },
  { key: "slowestSec", label: "Slowest", kind: "time" },
  { key: "cvPct", label: "CV%", kind: "cv", hint: "Consistency: how much lap times vary, relative to their average (lower = steadier)" },
  { key: "adj1Sec", label: "Reliable lap", kind: "time", hint: "The lap time you can count on — pace and consistency combined (about 4 in 5 laps are this fast or better)" },
];

function clockFromMin(v: number): string {
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
}

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
      return clockFromMin(a.value);
    default:
      return String(a.value);
  }
}

export default function ClubPage() {
  const [unit, toggleUnit] = useUnit();
  const [club, setClub] = useState<ClubRecap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("adj1Sec");
  const [dir, setDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    let active = true;
    fetch("/api/club", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        if (d.error) setError(d.error);
        else setClub(d);
      })
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, []);

  const sorted = useMemo(() => {
    if (!club) return [];
    const rows = [...club.runners];
    rows.sort((a, b) => {
      const va = a[sortKey] as string | number | null;
      const vb = b[sortKey] as string | number | null;
      const na = va == null;
      const nb = vb == null;
      if (na && nb) return 0;
      if (na) return 1; // nulls always last
      if (nb) return -1;
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return dir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [club, sortKey, dir]);

  if (error) return <Centered>⚠️ {error}</Centered>;
  if (!club) return <Centered>Loading all teams…</Centered>;
  const s = club;
  const emojiByKey: Record<string, string> = Object.fromEntries(s.awards.map((a) => [a.key, a.emoji]));

  const clickHeader = (k: SortKey) => {
    if (k === sortKey) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setDir(k === "lapCount" ? "desc" : "asc"); // most laps first; times/CV/names ascending
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Nav teamName="All Teams" eventName={s.eventName} active="club" unit={unit} onToggleUnit={toggleUnit} />

      {/* Hero */}
      <section className="rounded-2xl bg-gradient-to-br from-fuchsia-600/35 via-orange-600/30 to-amber-500/35 ring-1 ring-fuchsia-400/40 shadow-lg shadow-fuchsia-950/40 p-5">
        <p className="text-xs uppercase tracking-wide text-fuchsia-100/80">🏆 Club Recap</p>
        <h2 className="text-3xl font-extrabold mt-1">All Teams</h2>
        <p className="mt-3 text-lg font-semibold">
          <span className="font-mono">{s.runnerCount}</span> runners ·{" "}
          <span className="font-mono">{s.totalLaps}</span> laps ·{" "}
          <span className="font-mono">{formatDistance(s.totalMiles, unit)}</span> across {s.teams.length} teams
        </p>
      </section>

      {s.totalLaps === 0 ? (
        <p className="mt-6 text-center text-slate-400">No laps recorded yet.</p>
      ) : (
        <>
          {/* Team standings */}
          <section className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {s.teams.map((t, i) => (
              <div key={t.team} className={`rounded-xl px-4 py-3 ${i === 0 ? "bg-gradient-to-br from-amber-500/30 to-orange-600/25 ring-1 ring-orange-400/40" : "bg-slate-800/50"}`}>
                <p className="text-xs text-slate-400 truncate" title={t.teamName}>
                  {i === 0 && "👑 "}
                  {t.teamName}
                </p>
                <p className="text-xl font-bold font-mono">{t.laps}</p>
                <p className="text-xs text-slate-500">{formatDistance(t.miles, unit)}</p>
              </div>
            ))}
          </section>

          {/* Field-wide awards */}
          {s.awards.length > 0 && (
            <section className="mt-6">
              <h2 className="text-sm font-semibold text-slate-400 mb-2">🏅 Club awards</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {s.awards.map((a) => (
                  <div key={a.key} className="flex items-center gap-3 rounded-xl ring-1 ring-slate-800 p-4">
                    <span className="text-3xl">{a.emoji}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-emerald-300">{a.title}</p>
                      <p className="text-base font-bold truncate">
                        {a.runnerName} <span className="text-xs font-normal text-slate-400">· {a.team}</span>
                      </p>
                      <p className="text-xs text-slate-400 font-mono">
                        {awardValue(a, unit)} · {a.blurb}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Combined leaderboard (sortable) */}
          <section className="mt-6 mb-10">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-slate-400">Combined leaderboard</h2>
              <a href="/api/club/csv" className="text-xs rounded-lg bg-slate-800 ring-1 ring-slate-700 px-3 py-1.5 hover:bg-slate-700">
                ⬇ Download CSV (every lap)
              </a>
            </div>
            <p className="text-xs text-slate-500 mb-2">Tap a column to sort. Default: “Reliable lap” (pace + consistency).</p>
            <div className="overflow-x-auto rounded-xl ring-1 ring-slate-800">
              <table className="w-full text-sm">
                <thead className="text-slate-500 text-xs">
                  <tr className="text-left">
                    {COLS.map((c) => (
                      <th
                        key={c.key}
                        onClick={() => clickHeader(c.key)}
                        title={c.hint}
                        className={`px-3 py-2 cursor-pointer select-none hover:text-slate-300 ${c.kind === "str" ? "" : "text-right"}`}
                      >
                        {c.label}
                        {sortKey === c.key && <span className="ml-0.5">{dir === "asc" ? "▲" : "▼"}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.id} className="border-t border-slate-800/70">
                      <td className="px-3 py-2">
                        {r.name}
                        {r.awards.map((k) => (
                          <span key={k} className="ml-1">
                            {emojiByKey[k]}
                          </span>
                        ))}
                      </td>
                      <td className="px-3 py-2" title={r.teamName}>{r.team}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.lapCount}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatDuration(r.avgLapSeconds)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatDuration(r.fastestSec)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatDuration(r.slowestSec)}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.cvPct != null ? `${r.cvPct}%` : "–"}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatDuration(r.adj1Sec)}</td>
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

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center text-slate-400">{children}</div>;
}
