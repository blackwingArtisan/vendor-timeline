/**
 * The address PayPal sends the couple back to after its checkout. The hosted copy uses the address
 * Render gives it, so a request can't steer it elsewhere. A local copy uses the address it was opened on.
 */
import { singleton } from "@/lib/singleton";

const seen = () => singleton("wedding:origin", () => ({ origin: null as string | null }));

export function rememberOrigin(req: Request) {
  if (process.env.RENDER_EXTERNAL_URL) return;
  const url = new URL(req.url);
  const host = req.headers.get("host") ?? url.host;
  seen().origin = `${url.protocol}//${host}`;
}

export function appOrigin(): string {
  return (process.env.RENDER_EXTERNAL_URL ?? seen().origin ?? "http://localhost:3000").replace(/\/$/, "");
}

/** PayPal can only call back an address it can reach. */
export const isPublicOrigin = (origin = appOrigin()) => !/^https?:\/\/(localhost|127\.|\[::1\])/.test(origin);
