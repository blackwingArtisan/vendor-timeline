"use client";

/**
 * The vendor's side of "could this payment move?": one card, made for a phone. Who is asking, the
 * amount, the two dates, the contract's own sentence, three answers and where to be paid. Answering
 * changes nothing on its own: the couple approve any move. Every date and amount comes from the
 * server; nothing here is worked out in the browser.
 */
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CalendarClock, CircleCheck } from "lucide-react";
import { Button, Card, CardBody, Field, Input, Textarea } from "@/components/ui";
import { formatDay } from "@/lib/wedding/dates";
import type { ReplyAnswerValue, VendorReplyRecord } from "@/lib/wedding/types";

interface View {
  vendorName: string;
  kind: "deposit" | "balance";
  amount: string;
  fromDue: string;
  askedTo: string;
  weddingDay: string | null;
  sentence: string | null;
  reply: VendorReplyRecord | null;
  movedTo: string | null;
  sandbox: boolean;
}

const short = (day: string) => formatDay(day).replace(/^\w+, /, "").replace(/, \d{4}$/, "");

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? body?.message ?? "Something went wrong. Try again.");
  return body as T;
}

export function VendorReplyScreen() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<ReplyAnswerValue | null>(null);
  const [text, setText] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<VendorReplyRecord | null>(null);

  useEffect(() => {
    api<View>(`/api/vendor/${encodeURIComponent(token)}`).then(setView, (e: Error) => setError(e.message));
  }, [token]);

  async function send() {
    if (!answer) return;
    setSending(true);
    setError(null);
    try {
      const { reply } = await api<{ reply: VendorReplyRecord }>(`/api/vendor/${encodeURIComponent(token)}/reply`, { method: "POST", body: JSON.stringify({ answer, text, paypalEmail: email || undefined }) });
      setSent(reply);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (!view) {
    return (
      <main className="mx-auto max-w-md px-4 py-8">
        {error ? <p className="text-sm text-red-700" data-testid="vendor-error">{error}</p> : <p className="text-sm text-zinc-500" data-testid="vendor-loading">Opening the request.</p>}
      </main>
    );
  }

  const done = sent ?? (view.movedTo ? view.reply : null);
  const before = view.weddingDay && view.weddingDay > view.askedTo ? ` Still before the wedding on ${formatDay(view.weddingDay)}.` : "";
  return (
    <main className="mx-auto max-w-md px-4 py-6" data-testid="vendor-page">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Wedding Vendor Timeline · a couple&apos;s request</p>
      <Card>
        <CardBody className="space-y-4">
          <div>
            <p className="text-sm text-zinc-600">For {view.vendorName}</p>
            <h1 className="mt-1 text-lg font-semibold leading-snug text-zinc-900" data-testid="vendor-ask">
              Could the {view.kind} of {view.amount} move from {formatDay(view.fromDue)} to {formatDay(view.askedTo)}?
            </h1>
            {before ? <p className="mt-1 text-sm text-zinc-600">{before.trim()}</p> : null}
            {view.sentence ? <blockquote className="mt-2 border-l-2 border-zinc-300 pl-3 text-sm text-zinc-600" data-testid="vendor-sentence">Your contract: &ldquo;{view.sentence}&rdquo;</blockquote> : null}
          </div>

          {view.movedTo ? (
            <p className="flex items-center gap-2 text-sm text-emerald-800" data-testid="vendor-moved"><CircleCheck className="size-4 shrink-0" /> The couple moved it to {formatDay(view.movedTo)}. Thank you.</p>
          ) : sent ? (
            <div className="space-y-2" data-testid="vendor-sent">
              <p className="flex items-center gap-2 text-sm font-medium text-emerald-800"><CircleCheck className="size-4 shrink-0" /> Sent to the couple.</p>
              <p className="text-sm text-zinc-600">Nothing changes until they approve it. You can close this page.</p>
              <Button size="sm" variant="secondary" onClick={() => setSent(null)} data-testid="vendor-change">Change my answer</Button>
            </div>
          ) : (
            <>
              <div className="grid gap-2" role="group" aria-label="Your answer">
                {([["agreed", `Yes, ${short(view.askedTo)} works`], ["declined", "No, keep the date"], ["other", "Another date"]] as const).map(([value, label]) => (
                  <Button key={value} variant={answer === value ? "primary" : "secondary"} aria-pressed={answer === value} onClick={() => setAnswer(value)} data-testid={`vendor-answer-${value}`}>
                    {label}
                  </Button>
                ))}
              </div>
              {answer === "other" || answer === "agreed" ? (
                <Field label={answer === "other" ? "Which date works for you?" : "Anything to add? (optional)"}>
                  <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={500} rows={2} placeholder={answer === "other" ? "For example: the 5th is tight, the 8th is fine" : ""} data-testid="vendor-text" />
                </Field>
              ) : null}
              {answer && answer !== "declined" ? (
                <Field label="Your PayPal email, so the couple pay you directly (optional)" hint={view.sandbox ? "This copy runs on PayPal's sandbox: use a sandbox business account (name@business.example.com)." : undefined}>
                  <Input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} data-testid="vendor-paypal-email" />
                </Field>
              ) : null}
              {error ? <p className="text-sm text-red-700" data-testid="vendor-error">{error}</p> : null}
              <Button className="w-full" icon={<CalendarClock className="size-4" />} disabled={!answer || sending || (answer === "other" && !text.trim())} loading={sending} onClick={() => void send()} data-testid="vendor-send">
                Send my answer
              </Button>
            </>
          )}
          {done && !sent ? <p className="text-xs text-zinc-500">Your answer: {done.text || (done.answer === "agreed" ? "Yes" : "No")}</p> : null}
        </CardBody>
      </Card>
      <p className="mt-3 text-xs text-zinc-500">The couple shared this link with you. Your answer goes only to them.</p>
    </main>
  );
}
