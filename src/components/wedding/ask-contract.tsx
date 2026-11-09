"use client";

/**
 * "Ask about this contract": the couple ask in their own words; Claude answers from this contract
 * only and copies the clause; code checks the clause is really in the contract (and that the
 * answer brings in no amount the contract doesn't have) before showing anything.
 */
import { useState } from "react";
import { CircleCheck, MessageCircleQuestion, Quote, SearchX } from "lucide-react";
import { useKit } from "@/components/kit/kit-provider";
import { Badge, Button, Card, CardBody, CardHeader, Input } from "@/components/ui";
import { MAX_QUESTION_CHARS, SAMPLE_QUESTION, type QuestionResult } from "@/lib/wedding/question-result";

export { SAMPLE_QUESTION };

export function AskContract({ contractId }: { contractId: string }) {
  const { kitFetch } = useKit();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<QuestionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await kitFetch<QuestionResult>(`/api/contracts/${contractId}/question`, { method: "POST", body: JSON.stringify({ question }) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6" data-testid="ask-contract">
      <CardHeader title="Ask about this contract" description="Answered from this contract's own words, with the clause it comes from. Code checks the clause is really in the contract." />
      <CardBody>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
        >
          <label htmlFor="contract-question" className="sr-only">Your question</label>
          <Input id="contract-question" className="min-w-0 flex-1" value={question} maxLength={MAX_QUESTION_CHARS} placeholder={SAMPLE_QUESTION} onChange={(e) => setQuestion(e.target.value)} data-testid="contract-question" />
          <Button type="submit" icon={<MessageCircleQuestion className="size-4" />} loading={busy} disabled={busy || question.trim().length < 5} data-testid="contract-ask">
            Ask
          </Button>
        </form>
        {error ? <p role="alert" className="mt-3 text-sm text-red-700" data-testid="contract-ask-error">{error}</p> : null}
        {result?.found ? (
          <div className="mt-4 space-y-3" data-testid="contract-answer" data-live={result.live}>
            <p className="text-sm text-zinc-900" data-testid="contract-answer-text">{result.answer}</p>
            <figure className="rounded-xl border border-brand/30 bg-brand/5 px-4 py-3">
              <blockquote className="flex gap-2 text-sm text-zinc-800">
                <Quote className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                <span data-testid="contract-quote">{result.quote}</span>
              </blockquote>
              <figcaption className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-600">
                <span data-testid="contract-section">{result.section}</span>
                <span className="inline-flex items-center gap-1 text-emerald-700" data-testid="quote-checked">
                  <CircleCheck className="size-4" aria-hidden /> Code found these exact words in the contract
                </span>
                <span data-label><Badge tone={result.live ? "brand" : "neutral"}>{result.by}</Badge></span>
              </figcaption>
            </figure>
          </div>
        ) : null}
        {result && !result.found ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-zinc-700" data-testid="contract-not-found" data-reason={result.reason}>
            <SearchX className="size-4 shrink-0 text-zinc-500" aria-hidden /> {result.message}.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
