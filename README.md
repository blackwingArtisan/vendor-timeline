# Wedding Vendor Timeline

**Three new things for couples paying wedding vendors.**
1. **A cash plan limited to what the contracts allow.** When a month is over budget, code finds the fewest, smallest moves the signed contracts permit: pay a balance early, quoting the contract's own date sentence, or ask a vendor for a later date before the wedding. Nothing outside the contracts is suggested.
2. **A reply link for the vendor.** The vendor opens it on a phone with no account, taps Yes, No or another date, and gives the PayPal email they want paid. No couple-side tool with a vendor reply link was found in our scan.
3. **A parent pays one vendor from their own PayPal.** "Assign" makes a link for one person (in the sample, Linda, an illustrative parent). After the couple approve, that person pays the vendor in their own PayPal checkout, and the row reads "Paid by Linda's PayPal".

**How PayPal is central.**
1. **Create order:** every payment is a PayPal Orders v2 order the server creates for exactly the confirmed contract term, to that vendor, only after one approval in the app. The Guard refuses anything else before PayPal hears of it.
2. **Capture:** the couple pay in PayPal's own checkout, and the server captures that order and reads the capture back from PayPal.
3. **Webhook:** PayPal's `PAYMENT.CAPTURE.COMPLETED` webhook for that capture marks the item Paid, once PayPal's own status agrees (if PayPal's webhook can't arrive, the capture re-read is used, and the item says so). Each paid item's Receipt re-reads the order and capture, with PayPal's `debug_id`s.

**Live demo:** https://vendor-timeline.onrender.com · **Video:** https://youtu.be/tR-ymoU2zgg · **License:** MIT

> For couples juggling wedding vendors: Claude reads each vendor contract, you confirm every deposit and balance on one timeline, and you pay each vendor from your own PayPal, most urgent first.

![The agent stopped for approval, beside the cash check](docs/screenshot.png)

## Why this matters

The average US couple hires about 13 wedding vendors ([The Knot Real Weddings Study 2026](https://s3.us-east-1.amazonaws.com/theknot.com/xo-content/pdf/the-knot-real-weddings-study-data-read-out-2026.pdf), 10,474 couples married in 2025). Each contract sets its own deposit and balance dates: 30 days out for one, two weeks for another, the night of the wedding for a third ([WeddingWire forum, 2017](https://www.weddingwire.com/wedding-forums/how-did-you-handle-final-payments/c988afae4343599e.html); [2019](https://www.weddingwire.com/wedding-forums/final-vendor-payments-day-of-or-earlier/0832e50979444bda.html)). Couples track this in spreadsheets ([2016](https://www.weddingwire.com/wedding-forums/wedding-budget-and-spending-how-did-you-pay-your-vendors-deposits-and-regular-payments-or-a-lump-sum/33414fc59ed9ceb6.html)). Money is tight: 69% say their first budget was set too low, and 39% put wedding costs on a credit card ([The Knot, 2024](https://pros.weddingpro.com/report/2024-couples-finance-and-budget-report/)). Vendor Timeline reads the terms, warns when payments pile up, and pays each vendor through PayPal.

On the sample wedding, the cash check finds that May 2027 needs $15,800 across three balances against a $5,000 monthly budget, and the cash plan suggests what the contracts allow: pay one balance early, and ask the florist for a date a week later.

Forum posts are single couples' words: they show a problem comes up, not how often. The landing page lists each pain point with its sources (`src/lib/wedding/story.ts`).

## What it does

- **Start on a sample plan.** A first visit opens a labelled "Sample plan" with the five fictional contracts already confirmed (their terms prepared ahead of time, and `/api/contracts` says so: `read.by` "Sample, prepared ahead of time, not read on this visit"), so the timeline, cash check and agent work straight away. "Start your own plan" gives an empty plan of your own; the samples stay one click away.
- **Add contracts.** Paste the text, upload a `.txt` or `.pdf` file, or try one of the five fictional samples or the sample PDF.
- **AI reads the payment terms.** Vendor, total, deposit and date, balance and date, each with the exact contract sentence it came from.
- **Ask about a contract.** On any contract, ask in your own words ("Is the deposit refundable if we cancel 60 days out?"). Claude answers from that contract only and copies the clause it relies on. Code then checks those exact words are in the contract and that the answer names no amount or percentage the contract doesn't, and works out the section ("Cancellation", "Section 4, Retainer") from where the clause sits. If any check fails, you see "Couldn't find that in the contract" and no answer.
- **You check them.** Terms sit beside their source sentences. You confirm or edit. Anything missing or unclear is flagged and left blank, and nothing reaches the timeline unconfirmed.
- **One timeline.** Every deposit and balance by date and as bars per vendor, what's due next, what's overdue and the total due. Dates can be moved, and the original stays on the row.
- **Cash warnings.** Code puts each payment on the day its money leaves: a week where several payments land together is said as that week's money ("$12,200 leaves in the week of May 29"), and each month is checked against your monthly budget ($5,000 unless you change it). Each warning opens to show the sums.
- **A cash plan the contracts allow.** When a month or week is over budget, code works out the fewest, smallest moves that fit (or come as close as they can): pay a balance early, quoting the contract's own date sentence, or ask a vendor for a later date before the wedding. The agent shows the plan; the couple approve each move. "Pay early" is the same one approval and PayPal checkout as any payment. If a single payment is bigger than the whole monthly budget, the plan says so instead of pretending it fits, and names the smallest monthly budget at which its own moves fit every month (on the sample, $10,500), worked out by the same rules; one tap sets it.
- **A reply link for the vendor.** "Ask to move" gives the couple a link and a drafted note to send the vendor themselves (the app doesn't email or text it). The vendor opens it on a phone, with no account, and taps Yes, No or another date ("the 5th is tight, the 8th is fine"), plus the PayPal email they want paid. Claude Haiku reads the date out of their words; code then checks it is a real day, after today, inside the range a payment may move to, and still before the wedding. Only then does `move_due_date` ask the couple to approve; on approval the date moves, the month's bar drops, and that payment goes to the PayPal account the vendor gave. A misread can only become a proposal the couple decline. No couple-side tool with a vendor reply link was found in our scan.
- **Assign a payment to a parent.** On any open payment, "Assign" makes a link for one person, such as a parent who wants to pay the florist. The couple send it themselves. That person asks to pay on their phone; the couple approve it on the timeline, the same Guard approval as any payment; then that person pays the vendor in their own PayPal checkout, and the row reads "Paid by Linda's PayPal" (Linda is illustrative). The amount is still the confirmed term and the payee still the contract's: the link can't change either, and it shows only that one payment.
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

**Who pays whom:** the couple are the buyer. Their own PayPal (a sandbox buyer login, or PayPal's test card on PayPal's guest checkout) pays the vendor. Each payment takes one approval: "Approve and pay" on the Guard's approval card, which opens PayPal's checkout straight away. The sample vendors are fictional and have no PayPal accounts, so in sandbox a test business account stands in as the order's payee. No vendor is ever paid to the app's own account. Each sample vendor can have its own test business account (`PAYPAL_SANDBOX_VENDOR_EMAILS="photographer=sb-…@business.example.com,caterer=…,venue=…,florist=…,band=…"`); one not listed is paid to the shared vendor test account (`PAYPAL_SANDBOX_VENDOR_EMAIL`, defaulting to the shared sandbox config's business account). Today one vendor test account stands in for all five, and the approval card says so: "In the sandbox, PayPal pays a vendor test business account (sb-…@business.example.com), not this app's, standing in for Bramble & Vetch Floral. The same test account stands in for the other sample vendors until each has its own." When a vendor gives a PayPal email on the couple's reply link, that account is paid for their payments not yet started. The Paid row calls it "the florist's own PayPal" only if no other vendor is paid at that account; with today's one shared vendor test account it says "Paid to the florist's PayPal (sandbox stand-in: sb-…@business.example.com)" instead. Outside sandbox the payee is the email on the confirmed contract.

**Onboarding real vendors:** a real vendor needs no account with this app. Their PayPal email comes from the signed contract, or from the vendor themselves on the reply link the couple send; code refuses an email PayPal can't pay. The couple's own PayPal checkout pays it directly, so the money never passes through this app.

**Paid status:** an item turns Paid when PayPal's own record of the capture, read back with GET, says COMPLETED, and the verified `PAYMENT.CAPTURE.COMPLETED` webhook for that capture id has arrived. Nothing on the screen, and no other event, can mark it paid. If the webhook doesn't come within 60 seconds, the re-read stands and the item says so. A local copy can't receive webhooks at all, so there the re-read stands at once and the item says that too.

**Safety around money:** every payment goes through a guard. It enforces a per-action cap, a daily cap, a payee allowlist and idempotency, and `create_vendor_order` always waits for a person. The tool takes a contract, a kind and an amount, never a payee. If the couple's request names a vendor and an amount that isn't a confirmed term ("Pay the caterer $5,000"), code checks the amount against the confirmed contract before the model runs and the Guard refuses it: no model call, no approval, no PayPal order. If the model itself asks for an amount that isn't a confirmed term, the tool's own check refuses it the same way before any approval is created. After the approval, `vendorOrder()` builds the order from the confirmed terms on the server and refuses any other amount, any other payee or an unconfirmed term before PayPal is called. The capture route only captures that payment's own order, once. Every decision goes to a hash-chained, append-only audit log.

## How AI is used

| Where | Model | What it does |
|---|---|---|
| Reading a contract | Claude Haiku 5.5 (`claude-haiku-5-5`) | Copies each payment term and its source sentence out of the contract text. A PDF's text is pulled out with `unpdf` first |
| Payment agent | Claude Haiku 5.5 (`claude-haiku-5-5`) | Explains what code worked out, then asks for the most urgent payment through the guarded tool |

- **Copying, not arithmetic**: the model copies figures and sentences. Code turns percentages into cents and relative dates into calendar days, and works out every balance and total. If a contract states a balance that doesn't match, it's flagged.
- **Checked against the contract**: code confirms each sentence really is in the contract and each figure or date really is in its sentence.
- **Messy contracts stay blank, not guessed**: the "Messy venue" sample states its fee two ways ($2,400 and $2,800), asks for 30% of it, says the balance is due "before load-in" and gives no email. Code catches the two fees whatever the model read, so the total, deposit, balance date and email all stay blank and flagged until the couple fills them in; the 30% deposit then follows the total they confirm.
- **The agent explains, code decides**: `review_payments` hands the agent what to pay first (the most overdue payment), the next payment and the cash warnings as finished sentences, so it has no sums to do. It also hands over code's cash plan (`cash_plan_said`), which the agent may explain but not change. The same tool shows the couple each warning directly, so a warning can't be left out by the model. Limits live in the tool, not the prompt.
- **Answers must quote the contract**: "Ask about this contract" shows Claude's answer only when its quoted clause is in the stored contract word for word (a paraphrase is rejected) and every dollar amount and percentage in the answer is in the contract or the question. The same 45 s per request and 100 s deadline as every other call.
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

Each browser gets its own plan through a cookie, so people trying the hosted copy don't see each other's contracts, approvals, budget, audit entries or webhooks. Every hackathon entry shares one PayPal sandbox app, and PayPal sends each of them every entry's webhooks, so the app keeps only an event that names an order or capture it made itself, and shows it only to the couple whose payment it is.

This app's copy of the kit adds two optional hooks to `defineTool`: `check` refuses a call inside the Guard before an approval exists, and `after` runs once the Guard has finished. The run itself stays open until a person decides.

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

Demo video: `npm run demo:record` records `demo/demo.spec.ts` (100 to 120 s once cut: the overdue deposit, a PDF read, the caterer's sum flagged, a question answered with its clause, the Guard's refusal, the florist's reply in three steps, PayPal's checkout and receipt, then every PayPal call behind it) on a local build with mock AI and mock PayPal; add `DEMO_PAYPAL_MODE=sandbox` for PayPal's own checkout page. To record on the deployed copy, where PayPal's webhook reaches the app, run `DEMO_BASE_URL=https://vendor-timeline.onrender.com npx playwright test -c playwright.demo.config.ts`. The script uses no pinned clock, so every date is the recording date, and it prints the waits to cut (contract reads, PayPal's page loading, the webhook on its way), keeping 8 s of PayPal's checkout.

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
- The vendors are fictional, so in sandbox a test business account is the payee in each vendor's place. A real vendor would be paid at the PayPal email on its contract, or the one it gives on the reply link.
- The optional PayPal remote MCP connector is read-only and untested.
- A payment date can move, but the budget is one number per couple, and a payment can't yet be split in two. Cash warnings go by the day each payment leaves, not by the couple's paydays.
- The Bryntum Gantt isn't public yet, so the hosted copy shows the free bars.

## License

MIT, see [LICENSE](LICENSE). Third-party notice: [NOTICE](NOTICE).

## Sponsor Gantt

The timeline can show a [Bryntum Gantt](https://bryntum.com/products/gantt/) instead of the free bars: drag a deposit or balance and the new date saves through the same route as "Change date". It's behind a build-time switch, `NEXT_PUBLIC_SPONSOR_UI=1`, and it's off on the hosted copy until the sponsor allows a public demo.

With the switch off, `next.config.ts` points the import at a stub, and `npm run check` greps the browser bundle to prove no sponsor code is in it. Bryntum is an npm dependency only, on its trial package, so the faint trial watermark is expected. No sponsor code is in this repo.

Portions of this software are copyright 2015-2026 by Bryntum AB.
