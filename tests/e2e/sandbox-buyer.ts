/**
 * The PayPal sandbox buyer the save-PayPal test signs in as. Read from the environment, or from
 * ../../.env.shared for these two names only. Never print, log or screenshot the password.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const NAMES = ["PAYPAL_SANDBOX_BUYER_EMAIL", "PAYPAL_SANDBOX_BUYER_PASSWORD"] as const;

function fromShared(name: string): string | undefined {
  const file = resolve(process.cwd(), "../../.env.shared");
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
  const value = line?.slice(name.length + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  return value || undefined;
}

export interface SandboxBuyer {
  email: string;
  password: string;
}

/** The sandbox buyer, or why there isn't one. */
export function sandboxBuyer(): SandboxBuyer | { missing: string } {
  const [email, password] = NAMES.map((n) => process.env[n] || fromShared(n));
  if (!email) return { missing: "PAYPAL_SANDBOX_BUYER_EMAIL" };
  if (!password) return { missing: "PAYPAL_SANDBOX_BUYER_PASSWORD" };
  return { email, password };
}
