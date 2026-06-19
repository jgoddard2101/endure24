"use client";

import { milesToUnit, formatClock, type Unit } from "@/lib/format";
import type { ChartPoint } from "@/lib/stats";

interface Props {
  startAt: string;
  endAt: string;
  actual: ChartPoint[];
  projected: ChartPoint[];
  initial: ChartPoint[];
  nowISO: string;
  unit: Unit;
}

const W = 640;
const H = 280;
const M = { l: 46, r: 14, t: 14, b: 30 };

export default function DistanceChart({ startAt, endAt, actual, projected, initial, nowISO, unit }: Props) {
  const xMin = new Date(startAt).getTime();
  const xMax = new Date(endAt).getTime();
  const conv = (mi: number) => milesToUnit(mi, unit);

  const yMaxRaw = Math.max(
    1,
    ...actual.map((p) => p.miles),
    ...projected.map((p) => p.miles),
    ...initial.map((p) => p.miles)
  );
  const yMax = conv(yMaxRaw) * 1.08;

  const sx = (ms: number) => M.l + ((ms - xMin) / (xMax - xMin || 1)) * (W - M.l - M.r);
  const sy = (val: number) => M.t + (1 - val / yMax) * (H - M.t - M.b);

  const path = (pts: ChartPoint[]) =>
    pts
      .map((p, i) => `${i ? "L" : "M"} ${sx(new Date(p.t).getTime()).toFixed(1)} ${sy(conv(p.miles)).toFixed(1)}`)
      .join(" ");

  // X ticks every 4 hours.
  const hours = (xMax - xMin) / 3600_000;
  const stepH = hours <= 13 ? 2 : 4;
  const xTicks: number[] = [];
  for (let h = 0; h <= hours + 0.001; h += stepH) xTicks.push(xMin + h * 3600_000);

  // Y ticks: ~4 gridlines.
  const yTicks: number[] = [];
  const yStep = niceStep(yMax / 4);
  for (let v = 0; v <= yMax; v += yStep) yTicks.push(v);

  const nowMs = new Date(nowISO).getTime();
  const showNow = nowMs >= xMin && nowMs <= xMax;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Cumulative distance over time">
        {/* gridlines + y labels */}
        {yTicks.map((v) => (
          <g key={`y${v}`}>
            <line x1={M.l} x2={W - M.r} y1={sy(v)} y2={sy(v)} stroke="#1e293b" strokeWidth={1} />
            <text x={M.l - 6} y={sy(v) + 3} textAnchor="end" fontSize={10} fill="#64748b">
              {Math.round(v)}
            </text>
          </g>
        ))}
        {/* x labels */}
        {xTicks.map((ms) => (
          <text key={`x${ms}`} x={sx(ms)} y={H - 10} textAnchor="middle" fontSize={10} fill="#64748b">
            {formatClock(new Date(ms).toISOString())}
          </text>
        ))}

        {/* initial plan (straight reference line) */}
        <path d={path(initial)} fill="none" stroke="#64748b" strokeWidth={1.5} strokeDasharray="2 3" />
        {/* current projection */}
        <path d={path(projected)} fill="none" stroke="#fb923c" strokeWidth={2} strokeDasharray="5 4" />
        {/* actual */}
        <path d={path(actual)} fill="none" stroke="#34d399" strokeWidth={2.5} />

        {showNow && (
          <line x1={sx(nowMs)} x2={sx(nowMs)} y1={M.t} y2={H - M.b} stroke="#f8717155" strokeWidth={1} strokeDasharray="3 3" />
        )}
      </svg>

      <div className="flex gap-4 justify-center text-xs mt-1 flex-wrap">
        <Legend color="#34d399" label="Actual" />
        <Legend color="#fb923c" label="Projected" dashed />
        <Legend color="#64748b" label="Initial plan" dashed />
        <span className="text-slate-500">distance in {unit}</span>
      </div>
    </div>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-slate-400">
      <svg width={18} height={6}>
        <line x1={0} y1={3} x2={18} y2={3} stroke={color} strokeWidth={2.5} strokeDasharray={dashed ? "4 3" : undefined} />
      </svg>
      {label}
    </span>
  );
}

// Round a step up to a "nice" 1/2/5 × 10^n value.
function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * pow;
}
