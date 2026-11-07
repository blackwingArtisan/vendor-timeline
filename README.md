# Wedding Vendor Timeline

> For couples juggling wedding vendors: Claude reads each vendor contract, you confirm every deposit and balance on one timeline, and you pay each vendor from your own PayPal, most urgent first.

**Live demo:** https://vendor-timeline.onrender.com · **Video (≤3 min):** <!-- TODO: YouTube link --> · **License:** MIT

![The agent stopped for approval, beside the cash check](docs/screenshot.png)

## The problem

A wedding means five or more vendors, each with its own contract, its own wording and its own deadlines. One says "25% to hold the date", another "the rest two weeks before your wedding", another buries the balance in a schedule. Couples track these in their heads or a spreadsheet, and a missed deposit can cost them the vendor. Worse, the sums in contracts aren't always right.

## What it does

- **Add contracts.** Paste the text, upload a `.txt` or `.pdf` file, try one of the five fictional samples or the sample PDF, or load all five at once from the timeline.
- **AI reads the payment terms.** Vendor, total, deposit and date, balance and date, each with the exact contract sentence it came from.
- **You check them.** Terms sit beside their source sentences. You confirm or edit. Anything missing or unclear is flagged and left blank, and nothing reaches the timeline unconfirmed.
- **One timeline.** Every deposit and balance by date and as bars per vendor, what's due next, what's overdue and the total due. Dates can be moved, and the original stays on the row.
- **Cash warnings.** Code puts each payment on the day its money leaves: a week where several payments land together is said as that week's money ("$12,200 leaves in the week of May 29"), and each month is checked against your monthly budget ($5,000 unless you change it). Each warning opens to show the sums.
- **Ask the agent.** The payment agent puts the most overdue payment first (or says in one line why not), explains the warnings, sets the payment up and stops. It can't pay on its own.
- **Pay from your own PayPal.** You approve the payment in the app, then pay it yourself in PayPal's own checkout, with your PayPal account or a card. The server captures it. The Pay button goes through the same tool as the agent.
- **Proof.** The item is marked paid only when PayPal's own record of that capture says COMPLETED, shown with the order id, capture id and the webhook event.

## How PayPal is used

All PayPal calls go to the **sandbox** (`https://api-m.sandbox.paypal.com`); there is no live mode in the code. Every call shows on the in-app timeline with its HTTP status and PayPal `debug_id`.

| PayPal API | Endpoint(s) | Where and why |
|---|---|---|
| Orders v2 | `POST /v2/checkout/orders`, `GET /v2/checkout/orders/{id}`, `POST /v2/checkout/orders/{id}/capture` | After a person approves, the server creates a CAPTURE order for exactly the confirmed term, payable to the vendor. The couple approve it in PayPal's own checkout (logged in, or as a guest with a card), PayPal sends them back, and the server reads the order back (approved, same amount, same payee) before capturing it. |
| Payments v2 | `GET /v2/payments/captures/{id}` | Re-reads the capture. Only `COMPLETED` counts as paid. |
| Webhooks | `POST /v1/notifications/verify-webhook-signature` | A verified `PAYMENT.CAPTURE.COMPLETED` event is tied to one payment by its capture id and order id, then checked against that payment's amount and currency. Anything that doesn't match changes nothing, and captures this app didn't make are dropped. |

**Who pays whom:** the couple are the buyer. Their own PayPal (a sandbox buyer login, or PayPal's test card on PayPal's guest checkout) pays the vendor. The sample vendors are fictional and have no PayPal accounts, so in sandbox the order's payee is the app's own test business account, standing in for the vendor. The screen says so in one plain line wherever it shows the payment: "In the sandbox, this test business account stands in for Bramble & Vetch". Outside sandbox the payee is the email on the confirmed contract.

**Paid status:** an item turns Paid when PayPal's own record of the capture, read back with GET, says COMPLETED, and the verified `PAYMENT.CAPTURE.COMPLETED` webhook for that capture id has arrived. Nothing on the screen, and no other event, can mark it paid. If the webhook doesn't come within 60 seconds, the re-read stands and the item says so. A local copy can't receive webhooks at all, so there the re-read stands at once and the item says that too.

**Safety around money:** every payment goes through a guard. It enforces a per-action cap, a daily cap, a payee allowlist and idempotency, and `create_vendor_order` always waits for a person. The tool takes a contract, a kind and an amount, never a payee. Code refuses the call before any approval is created unless the amount exactly matches a confirmed term for that couple's contract, so an agent asking for too much gets a refusal, not a prompt. After the approval, `vendorOrder()` builds the order from the confirmed terms on the server and refuses any other amount, any other payee or an unconfirmed term before PayPal is called. The capture route only captures that payment's own order, once. Every decision goes to a hash-chained, append-only audit log.

## How AI is used

| Where | Model | What it does |
|---|---|---|
| Reading a contract | Claude Haiku 5.5 (`claude-haiku-5-5`) | Copies each payment term and its source sentence out of the contract text. A PDF's text is pulled out with `unpdf` first |
| Payment agent | Claude Haiku 5.5 (`claude-haiku-5-5`) | Explains what code worked out, then asks for the most urgent payment through the guarded tool |

- **Copying, not arithmetic**: the model copies figures and sentences. Code turns percentages into cents and relative dates into calendar days, and works out every balance and total. If a contract states a balance that doesn't match, it's flagged.
- **Checked against the contract**: code confirms each sentence really is in the contract and each figure or date really is in its sentence.
- **The agent explains, code decides**: `review_payments` hands the agent what to pay first (the most overdue payment), the next payment and the cash warnings as finished sentences, so it has no sums to do. The same tool shows the couple each warning directly, so a warning can't be left out by the model. Limits live in the tool, not the prompt.
- **Structured output**: zod schemas through the Messages API's structured outputs (`output_config.format`).
- **Cost control**: a hard daily spend cap (worst case reserved before every call), per-IP rate limits, and Haiku by default. When a read or the agent hits the per-minute limit, the page counts down and sends it again by itself.
- **When AI is unavailable**: if the credit or the day's allowance runs out, the page says so and no money moves. A contract can still go in by typing its terms, and any payment can still be approved from the timeline.
- **Mock mode**: without an API key the app uses clearly labelled simulated reads of the sample contracts and a scripted agent, so the demo works anywhere.

**Built with AI.** This project was built with **Claude Code** (Anthropic's coding agent), which wrote the code under human direction. It started from a shared starter kit that Claude Code also wrote. The product idea, scope and review were human decisions.

## Architecture

```
Browser (Next.js 16 / React 19, Tailwind)
  │  SSE /api/events (live activity panel)
  ▼
Next.js route handlers (Node)
  ├─ agents       the payment agent
  ├─ lib/wedding  cents and calendar-day rules, contract read and checks, timeline, cash warnings, payments
  ├─ lib/agent    Guard (caps, allowlist, approvals, idempotency, audit) around create_vendor_order
  ├─ lib/paypal   typed PayPal client: sandbox REST (OAuth cache, PayPal-Request-Id, debug_id) or in-memory mock
  ├─ lib/ai       Claude Haiku 5.5 structured output, with a daily spend cap
  ├─ webhooks     verify → ledger → handlers
  └─ .data/       local JSON: contracts, ledger, audit log, AI spend (mock PayPal state in mock mode)
```

Each browser gets its own plan through a cookie, so people trying the hosted copy don't see each other's contracts, approvals or budget.

This app's copy of the kit adds two optional hooks to `defineTool`: `check` refuses a call inside the Guard before an approval exists, and `after` runs once the Guard has finished. The run itself stays open until a person decides.

## Sponsor Gantt

The timeline can show a [Bryntum Gantt](https://bryntum.com/products/gantt/) instead of the free bars: drag a deposit or balance and the new date saves through the same route as "Change date". It's behind a build-time switch, `NEXT_PUBLIC_SPONSOR_UI=1`, and it's off on the hosted copy until the sponsor allows a public demo.

With the switch off, `next.config.ts` points the import at a stub, and `npm run check` greps the browser bundle to prove no sponsor code is in it. Bryntum is an npm dependency only, on its trial package, so the faint trial watermark is expected. No sponsor code is in this repo.

Portions of this software are copyright 2015-2026 by Bryntum AB.

## Run locally

Requirements: Node 24+ (developed on Node 26), npm.

```bash
npm ci
cp .env.example .env.local        # optional: values here override ../../.env.shared
PAYPAL_MODE=mock npm run dev      # no credentials needed
npm run seed                      # optional demo data
```

Open http://localhost:3000. For the real sandbox set `PAYPAL_MODE=sandbox`, `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`. For real AI set `ANTHROPIC_API_KEY`.

Checks: `npm run check` (lint, typecheck, unit tests, build, no sponsor code in the bundle), `npm run test:e2e:limits` (five contracts at the real 6-a-minute limit, and AI credit running out), `npm run test:e2e:engines` with `ENGINE=webkit`, `firefox`, `iphone` or `android`, `npm run test:e2e` (every flow on mock PayPal; `NEXT_PUBLIC_SPONSOR_UI=1 npm run test:e2e` runs it with the Gantt), `npm run test:e2e:sandbox` (the vendor and agent flows on the real sandbox, pays through PayPal's checkout as a guest with the test card, then re-reads the order and capture from PayPal; add `E2E_BASE_URL` to run them against a deployed copy, which also requires the webhook). Run one Playwright suite at a time.

## Sandbox test accounts

1. In the PayPal Developer Dashboard → **Testing Tools → Sandbox Accounts**, use the default Personal and Business accounts or create new ones. The Personal account is a couple who can log in to PayPal's checkout; the Business account owns the REST app and stands in for the vendors as the order's payee (`PAYPAL_SANDBOX_SELLER_EMAIL`).
2. Create a sandbox REST app under **Apps & Credentials → Sandbox** and copy its client ID and secret.
3. Add a webhook for `https://<your-deploy>/api/paypal/webhooks` and set `PAYPAL_WEBHOOK_ID`, subscribed to `PAYMENT.CAPTURE.COMPLETED`. Without one the app still finishes payments by re-reading PayPal, and says so on the item.

Nobody needs a PayPal login to try this app: on PayPal's checkout page, choose to pay as a guest with PayPal's sandbox test card 4111 1111 1111 1111 (any future expiry, any CVV).

## Deploy

Render Blueprint (`render.yaml`): New → Blueprint → this repo, then enter the secrets in the dashboard.

## Limitations

- Sandbox only; no live payments are possible.
- Local JSON storage: data resets on redeploy (fine for a demo, not for production).
- Contracts come in as pasted text, .txt or a PDF with real text in it. A scanned PDF or a photo isn't read: the app says so, and the terms can be typed in by hand.
- All the sample contracts and vendors are fictional.
- The vendors are fictional, so in sandbox the app's test business account is the payee in each vendor's place. A real vendor would be paid at the PayPal email on its contract.
- The optional PayPal remote MCP connector is read-only and untested.
- A payment date can move, but the budget is one number per couple, and a payment can't yet be split in two. Cash warnings go by the day each payment leaves, not by the couple's paydays.
- The Bryntum Gantt isn't public yet, so the hosted copy shows the free bars.

## License

MIT, see [LICENSE](LICENSE).
