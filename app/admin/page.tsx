"use client";

import { useCallback, useEffect, useState } from "react";

interface RosterRunner {
  id: string;
  name: string;
  rotationPosition: number;
  authorized: boolean;
  active: boolean;
  estimatedLapSeconds: number | null;
}

// "42" or "42:30" -> seconds; "" -> null. Returns undefined if unparseable.
function parseLapTime(input: string): number | null | undefined {
  const s = input.trim();
  if (s === "") return null;
  const m = s.match(/^(\d+)(?::(\d{1,2}))?$/);
  if (!m) return undefined;
  return parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0);
}

function fmtLapTime(sec: number | null): string {
  if (sec == null) return "";
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

export default function Admin() {
  const [password, setPassword] = useState("");
  const [runners, setRunners] = useState<RosterRunner[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  // Manual lap form
  const [lapRunner, setLapRunner] = useState("");
  const [lapMin, setLapMin] = useState("");
  const [lapSec, setLapSec] = useState("");
  const [lapCount, setLapCount] = useState("1");

  useEffect(() => {
    setPassword(localStorage.getItem("endure24_pw") ?? "");
  }, []);

  const loadRunners = useCallback(async () => {
    const res = await fetch("/api/runners", { cache: "no-store" });
    setRunners(await res.json());
  }, []);

  useEffect(() => {
    loadRunners();
  }, [loadRunners]);

  const savePw = (pw: string) => {
    setPassword(pw);
    localStorage.setItem("endure24_pw", pw);
  };

  // Generic admin POST/PATCH/DELETE helper.
  const call = async (url: string, method: string, body: Record<string, unknown> = {}) => {
    setMsg(null);
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`❌ ${data.error ?? res.status}`);
      return false;
    }
    setMsg("✅ Saved");
    return true;
  };

  const addRunner = async () => {
    if (!newName.trim()) return;
    if (await call("/api/runners", "POST", { name: newName.trim() })) {
      setNewName("");
      loadRunners();
    }
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const order = runners.map((r) => r.id);
    const j = idx + dir;
    if (j < 0 || j >= order.length) return;
    [order[idx], order[j]] = [order[j], order[idx]];
    if (await call("/api/rotation", "POST", { order })) loadRunners();
  };

  const setCurrent = async (id: string | null) => {
    if (await call("/api/rotation", "POST", { currentRunnerId: id })) loadRunners();
  };

  const addLap = async () => {
    if (!lapRunner) return setMsg("❌ pick a runner");
    if (await call("/api/laps", "POST", { runnerId: lapRunner, minutes: lapMin, seconds: lapSec, laps: lapCount })) {
      setLapMin("");
      setLapSec("");
      setLapCount("1");
    }
  };

  const saveEstimate = async (id: string, text: string) => {
    const parsed = parseLapTime(text);
    if (parsed === undefined) return setMsg("❌ estimate must be mm or mm:ss");
    if (await call("/api/runners", "PATCH", { id, estimatedLapSeconds: parsed })) loadRunners();
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Admin / Race Control</h1>
        <a href="/" className="text-sm underline text-slate-400">← dashboard</a>
      </div>

      <Section title="Admin password">
        <input
          type="password"
          value={password}
          onChange={(e) => savePw(e.target.value)}
          placeholder="ADMIN_PASSWORD"
          className="input"
        />
        <p className="text-xs text-slate-500">Stored locally in this browser. Required for every action below.</p>
      </Section>

      {msg && <p className="text-sm">{msg}</p>}

      <Section title="On course now">
        <p className="text-xs text-slate-500">
          Override who is currently out (clears automatically when they upload a lap). Leave unset to infer from rotation.
        </p>
        <div className="flex flex-wrap gap-2">
          {runners.filter((r) => r.active).map((r) => (
            <button key={r.id} onClick={() => setCurrent(r.id)} className="btn">
              {r.name}
            </button>
          ))}
          <button onClick={() => setCurrent(null)} className="btn-ghost">Clear (infer)</button>
        </div>
      </Section>

      <Section title="Roster & rotation order">
        <div className="space-y-2">
          {runners.map((r, idx) => (
            <div key={r.id} className="flex items-center gap-2 rounded-lg bg-slate-800/50 px-3 py-2">
              <span className="font-mono text-slate-500 w-5">{idx + 1}</span>
              <span className="flex-1">
                {r.name}{" "}
                {r.authorized ? (
                  <span className="text-[10px] text-emerald-400">✓ linked</span>
                ) : (
                  <a className="text-[10px] text-amber-400 underline" href={`/api/auth/strava?runner=${r.id}`}>
                    connect Strava
                  </a>
                )}
              </span>
              <input
                key={`est-${r.id}-${r.estimatedLapSeconds ?? ""}`}
                defaultValue={fmtLapTime(r.estimatedLapSeconds)}
                onBlur={(e) => saveEstimate(r.id, e.target.value)}
                placeholder="est mm:ss"
                title="Estimated lap time (mm or mm:ss) — used until they've run real laps"
                className="input w-24 text-center"
                inputMode="numeric"
              />
              <button onClick={() => move(idx, -1)} className="btn-icon">↑</button>
              <button onClick={() => move(idx, 1)} className="btn-icon">↓</button>
              <button
                onClick={async () => {
                  if (await call("/api/runners", "DELETE", { id: r.id })) loadRunners();
                }}
                className="btn-icon text-rose-400"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          The <span className="text-slate-300">est mm:ss</span> box sets a starting lap-time estimate (e.g. <code>42:30</code>)
          used for projections before anyone has run. Once a runner completes laps, their real average takes over automatically.
        </p>
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New runner name"
            className="input flex-1"
          />
          <button onClick={addRunner} className="btn">Add</button>
        </div>
      </Section>

      <Section title="Add a lap manually">
        <p className="text-xs text-slate-500">
          Backup for dead watches / failed uploads. Set <span className="text-slate-300">laps</span> to 2+ for a double lap;
          distance defaults to laps × the lap distance.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <select value={lapRunner} onChange={(e) => setLapRunner(e.target.value)} className="input">
            <option value="">Select runner…</option>
            {runners.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <input value={lapMin} onChange={(e) => setLapMin(e.target.value)} placeholder="min" className="input w-20" inputMode="numeric" />
          <input value={lapSec} onChange={(e) => setLapSec(e.target.value)} placeholder="sec" className="input w-20" inputMode="numeric" />
          <input value={lapCount} onChange={(e) => setLapCount(e.target.value)} placeholder="laps" title="number of laps" className="input w-16" inputMode="numeric" />
          <button onClick={addLap} className="btn">Record lap</button>
        </div>
      </Section>

      <Section title="Strava webhook">
        <p className="text-xs text-slate-500">
          Run once after deploying so Strava pushes new activities here. Requires APP_BASE_URL to be your public URL.
        </p>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              const res = await fetch("/api/admin/webhook", { headers: { "x-admin-password": password } });
              setMsg(JSON.stringify(await res.json()));
            }}
            className="btn-ghost"
          >
            View subscription
          </button>
          <button onClick={() => call("/api/admin/webhook", "POST")} className="btn">Create subscription</button>
        </div>
      </Section>

      <style>{`
        .input { background:#1e293b; border:1px solid #334155; border-radius:8px; padding:8px 10px; color:#e8edf5; font-size:14px; }
        .btn { background:#ea580c; color:white; border-radius:8px; padding:8px 14px; font-size:14px; font-weight:600; }
        .btn-ghost { background:#334155; color:#e8edf5; border-radius:8px; padding:8px 14px; font-size:14px; }
        .btn-icon { background:#334155; border-radius:6px; width:32px; height:32px; font-size:14px; }
      `}</style>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl ring-1 ring-slate-800 p-4 space-y-3">
      <h2 className="font-semibold text-slate-200">{title}</h2>
      {children}
    </section>
  );
}
