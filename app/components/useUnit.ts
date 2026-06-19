"use client";

import { useEffect, useState } from "react";
import type { Unit } from "@/lib/format";

/** Per-viewer mi/km preference, persisted in localStorage. */
export function useUnit(): [Unit, () => void] {
  const [unit, setUnit] = useState<Unit>("mi");

  useEffect(() => {
    const saved = localStorage.getItem("endure24_unit");
    if (saved === "mi" || saved === "km") setUnit(saved);
  }, []);

  const toggle = () =>
    setUnit((u) => {
      const next = u === "mi" ? "km" : "mi";
      localStorage.setItem("endure24_unit", next);
      return next;
    });

  return [unit, toggle];
}
