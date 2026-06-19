// Client-safe formatting helpers (no server imports).

export const KM_PER_MILE = 1.609344;
export type Unit = "mi" | "km";

/** Convert a distance given in miles to the chosen display unit. */
export function milesToUnit(miles: number, unit: Unit): number {
  return unit === "km" ? miles * KM_PER_MILE : miles;
}

/**
 * Format a distance (stored in miles) in the chosen unit.
 * Pass withUnit: false to omit the trailing "mi"/"km" suffix.
 */
export function formatDistance(
  miles: number | null | undefined,
  unit: Unit,
  withUnit = true
): string {
  if (miles == null) return "–";
  const v = milesToUnit(miles, unit);
  const rounded = Math.round(v * 10) / 10;
  const num = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return withUnit ? `${num} ${unit}` : num;
}

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

/** Pace stored as seconds/mile, formatted in the chosen unit: "8:30 /mi" or "5:17 /km". */
export function formatPace(secPerMile: number | null | undefined, unit: Unit): string {
  if (secPerMile == null) return "–";
  const sec = unit === "km" ? secPerMile / KM_PER_MILE : secPerMile;
  return `${formatDuration(sec)} /${unit}`;
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
