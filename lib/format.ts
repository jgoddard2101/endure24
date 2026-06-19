// Client-safe formatting helpers (no server imports).

/** 3725 -> "1:02:05", 305 -> "5:05" */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !isFinite(totalSeconds)) return "–";
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** seconds/mile -> "8:30 /mi" */
export function formatPace(secPerMile: number | null | undefined): string {
  if (secPerMile == null) return "–";
  return `${formatDuration(secPerMile)} /mi`;
}

/** Relative "in 12 min" / "5 min ago" from an ISO time vs a reference now. */
export function formatRelative(iso: string | null | undefined, nowIso: string): string {
  if (!iso) return "–";
  const diffMs = new Date(iso).getTime() - new Date(nowIso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (Math.abs(mins) < 1) return "now";
  if (mins < 0) return `${formatDuration(-mins * 60)} ago`;
  if (mins < 60) return `in ${mins} min`;
  return `in ${formatDuration(mins * 60)}`;
}

/** Local clock time like "14:32". */
export function formatClock(iso: string | null | undefined): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
