"use client";

import type { Unit } from "@/lib/format";

type Page = "dashboard" | "laps" | "stats";

const LINKS: { page: Page; href: string; label: string }[] = [
  { page: "dashboard", href: "/", label: "Live" },
  { page: "laps", href: "/laps", label: "Laps" },
  { page: "stats", href: "/stats", label: "Stats" },
];

export default function Nav({
  teamName,
  eventName,
  active,
  unit,
  onToggleUnit,
}: {
  teamName: string;
  eventName: string;
  active: Page;
  unit: Unit;
  onToggleUnit: () => void;
}) {
  return (
    <header className="mb-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-sky-300 via-fuchsia-300 to-amber-300 bg-clip-text text-transparent">
            {teamName}
          </h1>
          <p className="text-sm text-slate-400">{eventName}</p>
        </div>
        <div className="flex items-center gap-3">
          <UnitToggle unit={unit} onToggle={onToggleUnit} />
          <a href="/admin" className="text-xs text-slate-500 hover:text-slate-300 underline">
            admin
          </a>
        </div>
      </div>
      <nav className="mt-3 flex gap-1 rounded-xl bg-slate-900/40 backdrop-blur ring-1 ring-white/10 p-1 text-sm">
        {LINKS.map((l) => (
          <a
            key={l.page}
            href={l.href}
            className={`flex-1 text-center rounded-lg px-3 py-1.5 font-medium transition-colors ${
              active === l.page
                ? "bg-gradient-to-r from-fuchsia-600 to-orange-500 text-white shadow-lg shadow-fuchsia-900/30"
                : "text-slate-300 hover:bg-white/5"
            }`}
          >
            {l.label}
          </a>
        ))}
      </nav>
    </header>
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
