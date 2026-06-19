import { prisma } from "./prisma";
import { env } from "./config";
import type { Runner } from "@prisma/client";

const STRAVA_OAUTH = "https://www.strava.com/oauth";
const STRAVA_API = "https://www.strava.com/api/v3";

// Scopes: read profile + read all activities (incl. private/followers-only).
const SCOPE = "read,activity:read_all";

export interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch seconds
  athlete?: { id: number; firstname?: string; lastname?: string };
}

export interface StravaActivity {
  id: number;
  name: string;
  distance: number; // meters
  moving_time: number; // seconds
  elapsed_time: number; // seconds
  type: string; // "Run", "Walk", ...
  sport_type: string;
  start_date: string; // ISO UTC
  athlete: { id: number };
}

/** URL the runner visits to grant the app access to their activities. */
export function getAuthorizeUrl(state?: string) {
  const params = new URLSearchParams({
    client_id: env.stravaClientId,
    redirect_uri: `${env.appBaseUrl}/api/auth/strava/callback`,
    response_type: "code",
    scope: SCOPE,
    approval_prompt: "auto",
  });
  if (state) params.set("state", state);
  return `${STRAVA_OAUTH}/authorize?${params.toString()}`;
}

/** Exchange the OAuth `code` from the callback for tokens + athlete info. */
export async function exchangeCodeForToken(code: string): Promise<StravaTokenResponse> {
  const res = await fetch(`${STRAVA_OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.stravaClientId,
      client_secret: env.stravaClientSecret,
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Strava token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Returns a valid access token for the runner, transparently refreshing
 * (and persisting) it if it has expired or is about to.
 */
export async function getValidAccessToken(runner: Runner): Promise<string> {
  if (!runner.refreshToken) throw new Error(`Runner ${runner.name} has not authorized Strava`);

  const expiresAt = runner.tokenExpiresAt?.getTime() ?? 0;
  const stillValid = runner.accessToken && expiresAt - Date.now() > 60_000; // 1 min buffer
  if (stillValid) return runner.accessToken!;

  const res = await fetch(`${STRAVA_OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.stravaClientId,
      client_secret: env.stravaClientSecret,
      grant_type: "refresh_token",
      refresh_token: runner.refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`Strava token refresh failed: ${res.status} ${await res.text()}`);
  const data: StravaTokenResponse = await res.json();

  await prisma.runner.update({
    where: { id: runner.id },
    data: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenExpiresAt: new Date(data.expires_at * 1000),
    },
  });
  return data.access_token;
}

/** Fetch a single activity by id. */
export async function getActivity(accessToken: string, activityId: number | bigint): Promise<StravaActivity> {
  const res = await fetch(`${STRAVA_API}/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Strava activity fetch failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// --- Webhook subscription management (run once via /api/webhook/strava admin) ---

export async function listWebhookSubscriptions() {
  const params = new URLSearchParams({
    client_id: env.stravaClientId,
    client_secret: env.stravaClientSecret,
  });
  const res = await fetch(`${STRAVA_API}/push_subscriptions?${params}`);
  return res.json();
}

export async function createWebhookSubscription() {
  const res = await fetch(`${STRAVA_API}/push_subscriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.stravaClientId,
      client_secret: env.stravaClientSecret,
      callback_url: `${env.appBaseUrl}/api/webhook/strava`,
      verify_token: env.stravaWebhookVerifyToken,
    }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export async function deleteWebhookSubscription(id: number) {
  const params = new URLSearchParams({
    client_id: env.stravaClientId,
    client_secret: env.stravaClientSecret,
  });
  const res = await fetch(`${STRAVA_API}/push_subscriptions/${id}?${params}`, { method: "DELETE" });
  return { status: res.status };
}
