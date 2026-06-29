"use client";

import { useCallback, useEffect, useState } from "react";

interface RosterRunner {
  id: string;
  name: string;
  rotationPosition: number;
  authorized: boolean;
  active: boolean;
  estimatedLapSeconds: number | null;
  hasLaps: boolean;
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

// ISO (UTC) -> value for a <input type="datetime-local"> in the viewer's local time.
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface EventCfg {
  eventName: string;
  teamName: string;
  startAtLocal: string; // datetime-local value
  durationHours: number;
  lapDistanceMiles: number;
}

export default function Admin() {
  const [password, setPassword] = useState("");
  const [editMode, setEditMode] = useState(false); // passwordless everyday controls
  const [advanced, setAdvanced] = useState(false); // password-gated settings
  const [showUnlock, setShowUnlock] = useState(false);
  const [unlockInput, setUnlockInput] = useState("");
  const [runners, setRunners] = useState<RosterRunner[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  // Manual lap form
  const [lapRunner, setLapRunner] = useState("");
  const [lapMin, setLapMin] = useState("");
  const [lapSec, setLapSec] = useState("");
  const [lapCount, setLapCount] = useState("1");
  const [lapTiming, setLapTiming] = useState<"now" | "finish" | "start">("now");
  const [lapTimeLocal, setLapTimeLocal] = useState("");

  // Event settings form
  const [ev, setEv] = useState<EventCfg | null>(null);

  useEffect(() => {
    setPassword(localStorage.getItem("endure24_pw") ?? "");
  }, []);

  const loadRunners = useCallback(async () => {
    const res = await fetch("/api/runners", { cache: "no-store" });
    setRunners(await res.json());
  }, []);

  const loadEvent = useCallback(async () => {
    const c = await fetch("/api/event", { cache: "no-store" }).then((r) => r.json());
    setEv({
      eventName: c.eventName,
      teamName: c.teamName,
      startAtLocal: isoToLocalInput(c.startAt),
      durationHours: c.durationHours,
      lapDistanceMiles: c.lapDistanceMiles,
    });
  }, []);

  useEffect(() => {
    loadRunners();
    loadEvent();
  }, [loadRunners, loadEvent]);

  const savePw = (pw: string) => {
    setPassword(pw);
    localStorage.setItem("endure24_pw", pw);
  };

  // Validate a password against the server (no side effects).
  const checkPw = async (pw: string) => {
    if (!pw) return false;
    const res = await fetch("/api/admin/check", { headers: { "x-admin-password": pw }, cache: "no-store" });
    return res.ok;
  };

  // Unlock the advanced (password-gated) settings: reuse a remembered password
  // silently, else prompt for it.
  const beginUnlock = async () => {
    setMsg(null);
    if (password && (await checkPw(password))) {
      setAdvanced(true);
      return;
    }
    setUnlockInput(password);
    setShowUnlock(true);
  };

  const submitUnlock = async () => {
    if (await checkPw(unlockInput)) {
      savePw(unlockInput);
      setAdvanced(true);
      setShowUnlock(false);
      setMsg("✅ Advanced settings unlocked");
    } else {
      setMsg("❌ Wrong password");
    }
  };

  // Generic mutation helper. Open endpoints ignore the password; advanced ones
  // require it (sent from the unlock above).
  const call = async (url: string, method: string, body: Record<string, unknown> = {}) => {
    setMsg(null);
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Lost authorization on an advanced action — re-lock.
      if (res.status === 401) {
        setAdvanced(false);
        setShowUnlock(true);
      }
      setMsg(`❌ ${data.error ?? res.status}`);
      return false;
    }
    setMsg("✅ Saved");
    return true;
  };

  const activeRunners = runners.filter((r) => r.active);
  const inactiveRunners = runners.filter((r) => !r.active);

  const addRunner = async () => {
    if (!newName.trim()) return;
    if (await call("/api/runners", "POST", { name: newName.trim() })) {
      setNewName("");
      loadRunners();
    }
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const order = activeRunners.map((r) => r.id);
    const j = idx + dir;
    if (j < 0 || j >= order.length) return;
    [order[idx], order[j]] = [order[j], order[idx]];
    if (await call("/api/rotation", "POST", { order })) loadRunners();
  };

  const setCurrent = async (id: string | null) => {
    if (await call("/api/rotation", "POST", { currentRunnerId: id })) loadRunners();
  };

  const dropOut = async (id: string, name: string) => {
    if (!confirm(`Mark ${name} as dropped out? They leave the rotation but their completed laps still count toward the team total. You can re-add them later.`)) return;
    if (await call("/api/runners", "PATCH", { id, active: false })) loadRunners();
  };

  const reAdd = async (id: string) => {
    // Reactivate and append to the end of the current rotation.
    if (!(await call("/api/runners", "PATCH", { id, active: true }))) return;
    await call("/api/rotation", "POST", { order: [...activeRunners.map((r) => r.id), id] });
    loadRunners();
  };

  const hardDelete = async (id: string, name: string) => {
    if (!confirm(`PERMANENTLY delete ${name} and ALL their laps? This cannot be undone. (For a drop-out, use “dropped out” instead so their miles still count.)`)) return;
    if (await call("/api/runners", "DELETE", { id })) loadRunners();
  };

  const addLap = async () => {
    if (!lapRunner) return setMsg("❌ pick a runner");
    const timing: Record<string, unknown> = {};
    if (lapTiming !== "now" && lapTimeLocal) {
      const iso = new Date(lapTimeLocal).toISOString();
      if (lapTiming === "finish") timing.finishedAt = iso;
      else timing.startedAt = iso;
    }
    if (await call("/api/laps", "POST", { runnerId: lapRunner, minutes: lapMin, seconds: lapSec, laps: lapCount, ...timing })) {
      setLapMin("");
      setLapSec("");
      setLapCount("1");
      setLapTiming("now");
      setLapTimeLocal("");
    }
  };

  const saveEstimate = async (id: string, text: string) => {
    const parsed = parseLapTime(text);
    if (parsed === undefined) return setMsg("❌ estimate must be mm or mm:ss");
    if (await call("/api/runners", "PATCH", { id, estimatedLapSeconds: parsed })) loadRunners();
  };

  const saveEvent = async () => {
    if (!ev) return;
    await call("/api/event", "PATCH", {
      eventName: ev.eventName,
      teamName: ev.teamName,
      startAt: new Date(ev.startAtLocal).toISOString(),
      durationHours: Number(ev.durationHours),
      lapDistanceMiles: Number(ev.lapDistanceMiles),
    });
  };

  const setStartNow = async () => {
    if (await call("/api/event", "PATCH", { startAt: new Date().toISOString() })) loadEvent();
  };

  const resetData = async () => {
    if (!confirm("Delete ALL laps and clear the on-course override? Runners and Strava links are kept.")) return;
    const ok = await call("/api/admin/reset", "POST", {});
    if (ok) {
      loadRunners();
      loadEvent();
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Admin / Race Control</h1>
        <div className="flex items-center gap-3">
          {editMode ? (
            <button onClick={() => { setEditMode(false); setMsg(null); }} className="btn-ghost text-xs">
              🔓 Editing — tap to lock
            </button>
          ) : (
            <button onClick={() => setEditMode(true)} className="btn text-xs">✎ Edit mode</button>
          )}
          <a href="/" className="text-sm underline text-slate-400">← dashboard</a>
        </div>
      </div>

      {!editMode && (
        <p className="text-xs text-slate-500">
          Read-only view. Tap <b className="text-slate-300">✎ Edit mode</b> to make race-day changes — no password needed.
          Runners can always tap <span className="text-amber-400">connect Strava</span> below.
        </p>
      )}

      {msg && <p className="text-sm">{msg}</p>}

      <fieldset disabled={!editMode} className="space-y-6 border-0 p-0 m-0 min-w-0">
        <Section title="On course now">
          <p className="text-xs text-slate-500">
            Override who is currently out — use this when someone skips their turn for extra rest, or to set who goes next.
            Clears automatically when they upload (or you log) a lap. Leave unset to infer from the rotation.
          </p>
          <div className="flex flex-wrap gap-2">
            {activeRunners.map((r) => (
              <button key={r.id} onClick={() => setCurrent(r.id)} className="btn">
                {r.name}
              </button>
            ))}
            <button onClick={() => setCurrent(null)} className="btn-ghost">Clear (infer)</button>
          </div>
        </Section>

        <Section title="Roster & rotation order">
          <div className="space-y-2">
            {activeRunners.map((r, idx) => (
              <div key={r.id} className="flex items-center gap-2 rounded-lg bg-slate-800/50 px-3 py-2">
                <span className="font-mono text-slate-500 w-5">{idx + 1}</span>
                <span className="flex-1">
                  {r.name}{" "}
                  {r.authorized ? (
                    <span className="text-[10px] text-emerald-400">✓ linked</span>
                  ) : (
                    // Always tappable (an anchor isn't disabled by the fieldset) so
                    // runners can self-connect even in read-only view.
                    <a className="text-[10px] text-amber-400 underline" href={`/api/auth/strava?runner=${r.id}`}>
                      connect Strava
                    </a>
                  )}
                </span>
                <input
                  key={`est-${r.id}-${r.estimatedLapSeconds ?? ""}`}
                  defaultValue={fmtLapTime(r.estimatedLapSeconds)}
                  onBlur={(e) => saveEstimate(r.id, e.target.value)}
                  disabled={r.hasLaps}
                  placeholder={r.hasLaps ? "actual" : "est mm:ss"}
                  title={
                    r.hasLaps
                      ? "Locked — they've run real laps, so their actual average is used"
                      : "Estimated lap time (mm or mm:ss) — used until they've run real laps"
                  }
                  className="input w-24 text-center"
                  inputMode="numeric"
                />
                <button onClick={() => move(idx, -1)} className="btn-icon">↑</button>
                <button onClick={() => move(idx, 1)} className="btn-icon">↓</button>
                <button onClick={() => dropOut(r.id, r.name)} className="btn-icon text-amber-400" title="Mark as dropped out (keeps their laps)">
                  ⏏
                </button>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            The <span className="text-slate-300">est mm:ss</span> box sets a starting lap-time estimate (e.g. <code>42:30</code>)
            used for projections before anyone has run. Once a runner completes laps it locks — their real average takes over.
            The <span className="text-amber-400">⏏</span> button removes a drop-out from the rotation but keeps their laps.
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
            distance defaults to laps × the lap distance. By default the lap is logged as finishing now — use the timing
            option to set the real start or finish time.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <select value={lapRunner} onChange={(e) => setLapRunner(e.target.value)} className="input">
              <option value="">Select runner…</option>
              {activeRunners.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <input value={lapMin} onChange={(e) => setLapMin(e.target.value)} placeholder="min" className="input w-20" inputMode="numeric" />
            <input value={lapSec} onChange={(e) => setLapSec(e.target.value)} placeholder="sec" className="input w-20" inputMode="numeric" />
            <input value={lapCount} onChange={(e) => setLapCount(e.target.value)} placeholder="laps" title="number of laps" className="input w-16" inputMode="numeric" />
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={lapTiming}
              onChange={(e) => setLapTiming(e.target.value as "now" | "finish" | "start")}
              className="input"
              title="When did this lap happen?"
            >
              <option value="now">finishing now</option>
              <option value="finish">set finish time…</option>
              <option value="start">set start time…</option>
            </select>
            {lapTiming !== "now" && (
              <input
                type="datetime-local"
                value={lapTimeLocal}
                onChange={(e) => setLapTimeLocal(e.target.value)}
                className="input"
              />
            )}
            <button onClick={addLap} className="btn">Record lap</button>
          </div>
        </Section>
      </fieldset>

      {editMode && inactiveRunners.length > 0 && (
        <Section title="Dropped out">
          <p className="text-xs text-slate-500">
            Out of the rotation — their completed laps still count. Re-add if they come back (they rejoin at the end of the order).
          </p>
          <div className="space-y-2">
            {inactiveRunners.map((r) => (
              <div key={r.id} className="flex items-center gap-2 rounded-lg bg-slate-800/30 px-3 py-2">
                <span className="flex-1 text-slate-400">{r.name}</span>
                <button onClick={() => reAdd(r.id)} className="btn-ghost text-xs">Re-add</button>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="⚙️ Advanced settings">
        {advanced ? (
          <>
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">Event config, Strava webhook, reset and permanent delete.</p>
              <button onClick={() => { setAdvanced(false); setMsg(null); }} className="btn-ghost text-xs">🔓 Lock</button>
            </div>

            <AdvancedBlock title="Event settings">
              {ev ? (
                <>
                  <p className="text-xs text-slate-500">
                    Live values (the <code>EVENT_*</code> env vars were only initial defaults). To test the Strava fetch, hit
                    “Set start = now”; you can also drop the lap distance so a short test run counts as a lap.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-slate-400">
                      Event name
                      <input className="input w-full mt-1" value={ev.eventName} onChange={(e) => setEv({ ...ev, eventName: e.target.value })} />
                    </label>
                    <label className="text-xs text-slate-400">
                      Team name
                      <input className="input w-full mt-1" value={ev.teamName} onChange={(e) => setEv({ ...ev, teamName: e.target.value })} />
                    </label>
                    <label className="text-xs text-slate-400 col-span-2">
                      Start time
                      <input
                        type="datetime-local"
                        className="input w-full mt-1"
                        value={ev.startAtLocal}
                        onChange={(e) => setEv({ ...ev, startAtLocal: e.target.value })}
                      />
                    </label>
                    <label className="text-xs text-slate-400">
                      Duration (hours)
                      <input
                        className="input w-full mt-1"
                        inputMode="numeric"
                        value={ev.durationHours}
                        onChange={(e) => setEv({ ...ev, durationHours: Number(e.target.value) })}
                      />
                    </label>
                    <label className="text-xs text-slate-400">
                      Lap distance (miles)
                      <input
                        className="input w-full mt-1"
                        inputMode="decimal"
                        value={ev.lapDistanceMiles}
                        onChange={(e) => setEv({ ...ev, lapDistanceMiles: Number(e.target.value) })}
                      />
                    </label>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={saveEvent} className="btn">Save settings</button>
                    <button onClick={setStartNow} className="btn-ghost">Set start = now</button>
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-500">Loading…</p>
              )}
            </AdvancedBlock>

            <AdvancedBlock title="Strava webhook">
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
            </AdvancedBlock>

            <AdvancedBlock title="Permanently remove a runner">
              <p className="text-xs text-slate-500">
                Deletes the runner <b>and all their laps</b> (cannot be undone). For someone who drops out mid-event, use the
                <span className="text-amber-400"> ⏏</span> drop-out button instead so their miles still count.
              </p>
              <div className="space-y-2">
                {runners.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 rounded-lg bg-slate-800/30 px-3 py-2">
                    <span className="flex-1">
                      {r.name}{" "}
                      {!r.active && <span className="text-[10px] text-slate-500">(dropped out)</span>}
                    </span>
                    <button onClick={() => hardDelete(r.id, r.name)} className="btn-icon text-rose-400" title="Permanently delete">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </AdvancedBlock>

            <AdvancedBlock title="Reset / clear test data">
              <p className="text-xs text-slate-500">
                Deletes <b>all laps</b> and clears the on-course override (runners, Strava links and notification sign-ups are
                kept). Use this to wipe test laps before the real event — then set the start time back to the event date above.
              </p>
              <button onClick={resetData} className="btn-danger">Clear all laps</button>
            </AdvancedBlock>
          </>
        ) : showUnlock ? (
          <>
            <div className="flex gap-2">
              <input
                type="password"
                value={unlockInput}
                onChange={(e) => setUnlockInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitUnlock(); }}
                placeholder="Admin password"
                className="input flex-1"
                autoFocus
              />
              <button onClick={submitUnlock} className="btn">Unlock</button>
              <button onClick={() => setShowUnlock(false)} className="btn-ghost">Cancel</button>
            </div>
            <p className="text-xs text-slate-500">Entered once and remembered in this browser.</p>
          </>
        ) : (
          <>
            <p className="text-xs text-slate-500">
              Event config, Strava webhook, reset/clear data, and permanent delete. Needs the admin password.
            </p>
            <button onClick={beginUnlock} className="btn">🔒 Unlock advanced settings</button>
          </>
        )}
      </Section>

      <style>{`
        .input { background:#1e293b; border:1px solid #334155; border-radius:8px; padding:8px 10px; color:#e8edf5; font-size:14px; }
        .input:disabled { opacity:0.5; cursor:not-allowed; }
        .btn { background:#ea580c; color:white; border-radius:8px; padding:8px 14px; font-size:14px; font-weight:600; }
        .btn:disabled { opacity:0.45; cursor:not-allowed; }
        .btn-ghost { background:#334155; color:#e8edf5; border-radius:8px; padding:8px 14px; font-size:14px; }
        .btn-ghost:disabled { opacity:0.45; cursor:not-allowed; }
        .btn-danger { background:#b91c1c; color:white; border-radius:8px; padding:8px 14px; font-size:14px; font-weight:600; }
        .btn-icon { background:#334155; border-radius:6px; width:32px; height:32px; font-size:14px; }
        .btn-icon:disabled { opacity:0.45; cursor:not-allowed; }
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

// A sub-block inside the Advanced section (lighter than a full Section).
function AdvancedBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-900/40 ring-1 ring-slate-800 p-3 space-y-2">
      <h3 className="text-sm font-semibold text-slate-300">{title}</h3>
      {children}
    </div>
  );
}
