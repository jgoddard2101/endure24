import { env } from "./config";

/**
 * Lightweight shared-password gate for manual/admin actions.
 * Accepts the password via `x-admin-password` header or `password` JSON field.
 */
export function isAdmin(req: Request, bodyPassword?: string): boolean {
  const header = req.headers.get("x-admin-password");
  return header === env.adminPassword || bodyPassword === env.adminPassword;
}
