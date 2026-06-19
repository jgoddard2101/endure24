import { prisma } from "./prisma";
import { getDashboardState, type DashboardState } from "./stats";
import { sendToRunner } from "./push";

// Notify a runner this many minutes before their projected next start.
export const NOTIFY_LEAD_MINUTES = 15;
// Don't notify the same runner again within this window (one ping per turn).
const COOLDOWN_MS = 25 * 60_000;

export interface NotifyResult {
  runner: string;
  inMinutes: number;
  devices: number;
}

/** Convenience wrapper that recomputes state then notifies (used by the cron). */
export async function runNotifyCheck(): Promise<NotifyResult[]> {
  return notifyDueRunners(await getDashboardState());
}

/**
 * Given a dashboard state, push "you're up soon" to runners crossing the
 * lead-time threshold. Idempotent across frequent/concurrent calls via an
 * atomic per-runner cooldown claim — safe to call from a cron AND from the
 * dashboard's state poll.
 */
export async function notifyDueRunners(state: DashboardState): Promise<NotifyResult[]> {
  if (!state.started || state.finished) return [];

  const now = Date.now();
  const leadMs = NOTIFY_LEAD_MINUTES * 60_000;
  const results: NotifyResult[] = [];

  for (const r of state.runners) {
    if (!r.nextStartAt) continue; // on course now, or not running again
    const delta = new Date(r.nextStartAt).getTime() - now;
    if (delta <= 0 || delta > leadMs) continue;

    // Skip runners with no subscribed devices (don't burn the cooldown).
    const deviceCount = await prisma.pushSubscription.count({ where: { runnerId: r.id } });
    if (deviceCount === 0) continue;

    // Atomically claim the cooldown so only one concurrent run sends.
    const claim = await prisma.runner.updateMany({
      where: {
        id: r.id,
        OR: [{ lastNotifiedAt: null }, { lastNotifiedAt: { lt: new Date(now - COOLDOWN_MS) } }],
      },
      data: { lastNotifiedAt: new Date(now) },
    });
    if (claim.count === 0) continue;

    const mins = Math.max(1, Math.round(delta / 60_000));
    const devices = await sendToRunner(r.id, {
      title: "🏃 You're up soon!",
      body: `${r.name}, you're next on course in about ${mins} min. Get ready!`,
      url: "/",
    });
    results.push({ runner: r.name, inMinutes: mins, devices });
  }

  return results;
}
