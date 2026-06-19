"use client";

import { useEffect, useState } from "react";
import type { DashboardState } from "@/lib/stats";

/**
 * Polls /api/state and ticks every second so live countdowns update smoothly.
 * Shared by the dashboard, laps and stats pages.
 */
export function useDashboardState(intervalMs = 15000) {
  const [state, setState] = useState<DashboardState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        const data = await res.json();
        if (!active) return;
        if (data.error) setError(data.error);
        else {
          setState(data);
          setError(null);
        }
      } catch (e) {
        if (active) setError(String(e));
      }
    };
    load();
    const poll = setInterval(load, intervalMs);
    const tick = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      active = false;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [intervalMs]);

  return { state, error };
}
