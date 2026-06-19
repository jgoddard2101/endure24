"use client";

import { useEffect, useState } from "react";

interface RosterRunner {
  id: string;
  name: string;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

type Status = "loading" | "unsupported" | "ios-install" | "off" | "on" | "working";

export default function NotifyToggle() {
  const [runners, setRunners] = useState<RosterRunner[]>([]);
  const [me, setMe] = useState("");
  const [status, setStatus] = useState<Status>("loading");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setMe(localStorage.getItem("endure24_me") ?? "");
    fetch("/api/runners")
      .then((r) => r.json())
      .then((rs: RosterRunner[]) => setRunners(rs))
      .catch(() => {});

    const supported =
      "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!supported) {
      // iOS only supports web push from an installed (Home Screen) PWA.
      const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        // @ts-expect-error iOS-only Safari flag
        window.navigator.standalone === true;
      setStatus(isIos && !standalone ? "ios-install" : "unsupported");
      return;
    }
    // Reflect any existing subscription.
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => setStatus(sub ? "on" : "off"))
      .catch(() => setStatus("off"));
  }, []);

  const persistMe = async (id: string) => {
    setMe(id);
    localStorage.setItem("endure24_me", id);
    // If already subscribed, re-map the existing subscription to the new runner.
    if (status === "on" && id) {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runnerId: id, subscription: sub.toJSON() }),
        });
      }
    }
  };

  const enable = async () => {
    if (!me) return setMsg("Pick your name first.");
    setStatus("working");
    setMsg(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("off");
        return setMsg("Notifications were blocked. Enable them in your browser settings.");
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const { publicKey } = await fetch("/api/push/vapid").then((r) => r.json());
      if (!publicKey) {
        setStatus("off");
        return setMsg("Push isn't configured on the server (missing VAPID key).");
      }

      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
        }));

      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runnerId: me, subscription: sub.toJSON() }),
      });
      setStatus("on");
      setMsg("Done! Sending a test notification…");
      await fetch("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runnerId: me }),
      });
    } catch (e) {
      setStatus("off");
      setMsg(`Couldn't enable notifications: ${e}`);
    }
  };

  const disable = async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
    setStatus("off");
    setMsg("Notifications turned off on this device.");
  };

  if (status === "loading") return null;

  return (
    <section className="mt-4 rounded-xl bg-slate-800/40 ring-1 ring-slate-700/60 px-4 py-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm">🔔 Get a heads-up ~15 min before you&apos;re up</span>
      </div>

      {status === "unsupported" && (
        <p className="text-xs text-slate-400 mt-2">This browser doesn&apos;t support push notifications.</p>
      )}

      {status === "ios-install" && (
        <p className="text-xs text-amber-300/90 mt-2">
          On iPhone: tap the Share button → <b>Add to Home Screen</b>, then open Endure24 from that icon to enable notifications.
        </p>
      )}

      {(status === "off" || status === "on" || status === "working") && (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <select
            value={me}
            onChange={(e) => persistMe(e.target.value)}
            className="rounded-lg bg-slate-900 ring-1 ring-slate-700 px-3 py-1.5 text-sm"
          >
            <option value="">Who are you?</option>
            {runners.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>

          {status === "on" ? (
            <>
              <span className="text-xs text-emerald-400">✓ on for this device</span>
              <button onClick={disable} className="text-xs text-slate-400 underline">
                turn off
              </button>
            </>
          ) : (
            <button
              onClick={enable}
              disabled={status === "working"}
              className="rounded-lg bg-orange-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {status === "working" ? "Enabling…" : "Enable"}
            </button>
          )}
        </div>
      )}

      {msg && <p className="text-xs text-slate-400 mt-2">{msg}</p>}
    </section>
  );
}
