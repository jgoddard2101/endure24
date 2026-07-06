import { NextResponse } from "next/server";
import { getClubLaps } from "@/lib/club";
import { formatDuration } from "@/lib/format";
import { METERS_PER_MILE } from "@/lib/config";

export const dynamic = "force-dynamic";

// Lap start/finish are shown in event-local time (Europe/London, BST-aware).
const LONDON_DT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
function london(iso: string): string {
  const p = LONDON_DT.formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  const hh = g("hour") === "24" ? "00" : g("hour");
  return `${g("year")}-${g("month")}-${g("day")} ${hh}:${g("minute")}:${g("second")}`;
}
const esc = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// One row per individual lap across all four teams.
export async function GET() {
  try {
    const laps = await getClubLaps();
    const header = ["Runner", "Team", "Lap number", "Lap start", "Lap finish", "Lap time", "Avg pace (min/km)", "Avg pace (min/mile)"];
    const rows = laps.map((l) => {
      const km = l.distanceMeters / 1000;
      const miles = l.distanceMeters / METERS_PER_MILE;
      const paceKm = km > 0 ? formatDuration(l.movingSec / km) : "";
      const paceMi = miles > 0 ? formatDuration(l.movingSec / miles) : "";
      return [l.runner, l.teamName, l.lapNumber, london(l.startISO), london(l.finishISO), formatDuration(l.elapsedSec), paceKm, paceMi]
        .map(esc)
        .join(",");
    });
    const csv = [header.join(","), ...rows].join("\n");
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="club-laps.csv"',
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
