/** Reads the PayPal sandbox directly, so the checks don't depend on the app under test. */
import { loadEnvFiles } from "../../src/lib/env-core";

const API = "https://api-m.sandbox.paypal.com";

export interface PayoutRead {
  batch_header: {
    payout_batch_id: string;
    batch_status: string;
    sender_batch_header: { sender_batch_id: string };
    amount?: { currency: string; value: string };
  };
  items: {
    payout_item_id: string;
    transaction_id?: string;
    transaction_status: string;
    payout_item: { amount: { currency: string; value: string }; receiver: string };
  }[];
}

async function token(): Promise<string> {
  loadEnvFiles();
  const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${API}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  if (!res.ok) throw new Error(`PayPal token request failed: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function readPayout(batchId: string): Promise<PayoutRead> {
  const res = await fetch(`${API}/v1/payments/payouts/${batchId}`, { headers: { Authorization: `Bearer ${await token()}` } });
  if (!res.ok) throw new Error(`GET payout ${batchId} failed: ${res.status}`);
  return (await res.json()) as PayoutRead;
}

/** The batch finishes after its item, so wait for both before reading the final state. */
export async function readFinishedPayout(batchId: string, tries = 20): Promise<PayoutRead> {
  let read = await readPayout(batchId);
  for (let i = 0; i < tries && (read.batch_header.batch_status !== "SUCCESS" || read.items[0]?.transaction_status !== "SUCCESS"); i++) {
    await new Promise((r) => setTimeout(r, 3000));
    read = await readPayout(batchId);
  }
  return read;
}
