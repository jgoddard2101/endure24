import webpush from "web-push";
import { prisma } from "./prisma";

let configured = false;

/** Configure web-push with VAPID details once (lazily). Returns false if unset. */
function ensureConfigured(): boolean {
  if (configured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", publicKey, privateKey);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/**
 * Send a push to every device the runner has subscribed. Dead subscriptions
 * (404/410) are pruned. Returns the number of successful sends.
 */
export async function sendToRunner(runnerId: string, payload: PushPayload): Promise<number> {
  if (!ensureConfigured()) return 0;
  const subs = await prisma.pushSubscription.findMany({ where: { runnerId } });
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload)
        );
        sent++;
      } catch (err: unknown) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
        } else {
          console.error("[push] send failed", code, err);
        }
      }
    })
  );
  return sent;
}
