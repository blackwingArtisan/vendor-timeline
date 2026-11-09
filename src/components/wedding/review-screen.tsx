"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CircleAlert, Quote } from "lucide-react";
import { useKit } from "@/components/kit/kit-provider";
import { PageHeader } from "@/components/shell/app-shell";
import { useToast } from "@/components/toast";
import { Badge, Button, ButtonLink, Card, CardBody, CardFooter, CardHeader, EmptyState, Input, MoneyInput, Select } from "@/components/ui";
import { AskContract } from "./ask-contract";
import { PageLoading } from "./page-loading";
import { amountText, balanceCents, formatCents, percentOfCents } from "@/lib/wedding/cents";
import { formatDay, localToday } from "@/lib/wedding/dates";
import { contractDayRange, dayProblem, readAmount } from "@/lib/wedding/limits";
import { readLabel } from "@/lib/wedding/plan-mix";
import { VENDOR_ROLES, type Contract, type ProposedTerm } from "@/lib/wedding/types";

function Term({ name, label, term, byHand, children }: { name: string; label: string; term: Pick<ProposedTerm<unknown>, "sentence" | "basis" | "flags">; byHand?: boolean; children: ReactNode }) {
  return (
    <div data-testid={`term-${name}`} className={`grid gap-x-6 gap-y-2 border-b border-zinc-100 px-5 py-4 last:border-b-0 ${byHand ? "" : "md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]"}`}>
      <div>
        <p className="mb-1.5 text-sm font-medium text-zinc-700">{label}</p>
        {children}
        {term.basis ? <p className="mt-1.5 text-xs text-zinc-500" data-testid={`basis-${name}`}>{term.basis}</p> : null}
      </div>
      {byHand ? null : (
        <blockquote className="flex gap-2 text-sm leading-relaxed text-zinc-600 md:pt-6" data-testid={`source-${name}`}>
          <Quote className="mt-1 size-3.5 shrink-0 text-brand-300" />
          {term.sentence ? <span>{term.sentence}</span> : <span className="italic text-zinc-400">No sentence in the contract for this.</span>}
        </blockquote>
      )}
      {term.flags.length && !byHand ? (
        <ul className="space-y-1 md:col-span-2" data-testid={`flag-${name}`}>
          {term.flags.map((flag) => (
            <li key={flag} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <CircleAlert className="mt-0.5 size-4 shrink-0" /> {flag}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A plain reason under a box, shown once the box has something in it. */
function Problem({ name, children }: { name: string; children: string | null }) {
  if (!children) return null;
  return (
    <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-sm text-red-700" data-testid={`problem-${name}`}>
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {children}
    </p>
  );
}

function ReviewForm({ contract }: { contract: Contract }) {
  const { kitFetch } = useKit();
  const { toast } = useToast();
  const router = useRouter();
  const p = contract.proposed;
  const [vendorName, setVendorName] = useState(p.vendorName.value ?? "");
  const [vendorRole, setVendorRole] = useState(p.vendorRole);
  const [payeeEmail, setPayeeEmail] = useState(p.payeeEmail.value ?? "");
  const [total, setTotal] = useState(p.totalCents.value !== null ? amountText(p.totalCents.value) : "");
  const [deposit, setDeposit] = useState(p.depositCents.value !== null ? amountText(p.depositCents.value) : "");
  const [depositDue, setDepositDue] = useState(p.depositDue.value ?? "");
  const [balanceDue, setBalanceDue] = useState(p.balanceDue.value ?? "");
  const [busy, setBusy] = useState(false);
  // A deposit the contract states as a percentage follows the total until the couple types their own.
  const depositPercent = p.depositCents.percent;
  const [depositTyped, setDepositTyped] = useState(false);
  const follows = depositPercent !== undefined && !depositTyped;

  function changeTotal(text: string) {
    setTotal(text);
    if (!follows) return;
    const cents = readAmount(text, "Total").cents;
    setDeposit(cents !== undefined && cents !== null ? amountText(percentOfCents(cents, depositPercent)) : "");
  }

  // Each box is checked as it's typed, in the same words the server would use to refuse it.
  const totalRead = readAmount(total, "Total");
  const depositRead = readAmount(deposit, "Deposit");
  const totalCents = totalRead.cents ?? null;
  const depositCents = depositRead.cents ?? null;
  const depositTooBig = totalCents !== null && depositCents !== null && depositCents > totalCents;
  const amountsFit = totalCents !== null && depositCents !== null && !depositTooBig;
  const balance = amountsFit ? balanceCents(totalCents, depositCents) : null;
  const range = contractDayRange(localToday(), p.eventDate.value);
  const problems = {
    total: total.trim() ? (totalRead.error ?? null) : null,
    deposit: deposit.trim() ? (depositRead.error ?? (depositTooBig ? `The deposit can't be more than the total of ${formatCents(totalCents!)}.` : null)) : null,
    depositDue: depositDue ? dayProblem(depositDue, "The deposit date", range) : null,
    balanceDue: balance !== 0 && balanceDue ? dayProblem(balanceDue, "The balance date", range) : null,
  };
  const problemCount = Object.values(problems).filter(Boolean).length;

  const missing = [
    vendorName.trim() ? null : "the vendor's name",
    /^\S+@\S+\.\S+$/.test(payeeEmail.trim()) ? null : "an email to pay",
    amountsFit ? null : "a total and a deposit no bigger than it",
    depositDue && !problems.depositDue ? null : "the deposit date",
    balance === 0 || (balanceDue && !problems.balanceDue) ? null : "the balance date",
  ].filter((m): m is string => !!m);

  async function confirm() {
    setBusy(true);
    try {
      await kitFetch(`/api/contracts/${contract.id}/confirm`, {
        json: { vendorName, vendorRole, payeeEmail, totalCents, depositCents, depositDue, balanceDue: balance === 0 ? null : balanceDue },
      });
      router.push("/timeline");
    } catch (e) {
      toast({ title: "Could not confirm", description: (e as Error).message, variant: "error" });
      setBusy(false);
    }
  }

  // A term needs a look if the reader flagged it or the box now holds something the app would refuse.
  const flagged = [p.vendorName, p.payeeEmail, p.totalCents, p.depositCents, p.depositDue, p.balanceCents, p.balanceDue].filter((t) => t.flags.length).length + problemCount;
  // No AI read this one, so there's nothing to check it against. Only the empty boxes remain.
  const byHand = !!contract.read.skipped;

  return (
    <Card>
      <CardHeader
        title={byHand ? "Enter each term from your contract" : "Check each term against the contract"}
        description="Your confirmed numbers are the only ones that reach the timeline."
        action={byHand ? (problemCount ? <Badge tone="warning" dot>{problemCount === 1 ? "1 term needs a look" : `${problemCount} terms need a look`}</Badge> : null) : flagged ? <Badge tone="warning" dot>{flagged === 1 ? "1 term needs a look" : `${flagged} terms need a look`}</Badge> : <Badge tone="success">Nothing flagged</Badge>}
      />
      <Term byHand={byHand} name="vendor" label="Vendor" term={p.vendorName}>
        <div className="grid gap-2 sm:grid-cols-[1fr_11rem]">
          <Input aria-label="Vendor name" value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
          <Select aria-label="Vendor type" value={vendorRole} onChange={(e) => setVendorRole(e.target.value as Contract["proposed"]["vendorRole"])}>
            {VENDOR_ROLES.map((role) => (
              <option key={role} value={role}>{role[0].toUpperCase() + role.slice(1)}</option>
            ))}
          </Select>
        </div>
      </Term>
      <Term byHand={byHand} name="email" label="PayPal email to pay" term={p.payeeEmail}>
        <Input aria-label="PayPal email to pay" type="email" value={payeeEmail} onChange={(e) => setPayeeEmail(e.target.value)} placeholder="Ask the vendor" />
      </Term>
      <Term byHand={byHand} name="total" label="Total" term={p.totalCents}>
        <MoneyInput aria-label="Total" value={total} onChange={(e) => changeTotal(e.target.value)} aria-invalid={!!problems.total} />
        <Problem name="total">{problems.total}</Problem>
      </Term>
      <Term byHand={byHand} name="deposit" label="Deposit" term={follows ? { ...p.depositCents, basis: totalCents !== null ? `${depositPercent}% of ${formatCents(totalCents)}, worked out by the app` : undefined } : p.depositCents}>
        <MoneyInput aria-label="Deposit" value={deposit} onChange={(e) => { setDeposit(e.target.value); setDepositTyped(true); }} aria-invalid={!!problems.deposit} />
        <Problem name="deposit">{problems.deposit}</Problem>
      </Term>
      <Term byHand={byHand} name="deposit-due" label="Deposit due" term={p.depositDue}>
        <Input aria-label="Deposit due" type="date" min={range.from} max={range.to} value={depositDue} onChange={(e) => setDepositDue(e.target.value)} aria-invalid={!!problems.depositDue} />
        <Problem name="deposit-due">{problems.depositDue}</Problem>
      </Term>
      <Term byHand={byHand} name="balance" label="Balance" term={{ ...p.balanceCents, basis: "Total minus deposit, worked out by the app" }}>
        <p className="flex h-10 items-center font-mono text-lg font-semibold tabular-nums text-zinc-900" data-testid="balance-value">
          {balance !== null ? formatCents(balance) : "Enter the total and deposit"}
        </p>
      </Term>
      {balance === 0 ? null : (
        <Term byHand={byHand} name="balance-due" label="Balance due" term={p.balanceDue}>
          <Input aria-label="Balance due" type="date" min={range.from} max={range.to} value={balanceDue} onChange={(e) => setBalanceDue(e.target.value)} aria-invalid={!!problems.balanceDue} />
          <Problem name="balance-due">{problems.balanceDue}</Problem>
        </Term>
      )}
      <CardFooter className="justify-between">
        <p className="text-sm text-zinc-500" data-testid="still-needed">
          {missing.length ? `Still needed: ${missing.join(", ")}.` : "Ready when you are."}
        </p>
        <Button onClick={confirm} loading={busy} disabled={missing.length > 0 || problemCount > 0} data-testid="confirm-terms">
          Confirm these terms
        </Button>
      </CardFooter>
    </Card>
  );
}

function ConfirmedSummary({ contract }: { contract: Contract }) {
  const t = contract.confirmed!;
  const rows = [
    ["Total", formatCents(t.totalCents)],
    ["Deposit", `${formatCents(t.depositCents)}, due ${formatDay(t.depositDue)}`],
    ["Balance", t.balanceDue ? `${formatCents(t.balanceCents)}, due ${formatDay(t.balanceDue)}` : "Nothing after the deposit"],
    ["PayPal email", t.payeeEmail],
  ];
  return (
    <Card>
      <CardHeader title="Confirmed" action={<ButtonLink href="/timeline" size="sm" variant="secondary">See the timeline</ButtonLink>} />
      <CardBody>
        <dl className="grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-zinc-500">{label}</dt>
              <dd className="font-medium tabular-nums text-zinc-900">{value}</dd>
            </div>
          ))}
        </dl>
      </CardBody>
    </Card>
  );
}

export function ReviewScreen() {
  const { id } = useParams<{ id: string }>();
  const { kitFetch } = useKit();
  const [contract, setContract] = useState<Contract | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    kitFetch<Contract>(`/api/contracts/${id}`)
      .then(setContract)
      .catch((e: Error) => setError(e.message));
  }, [id, kitFetch]);

  if (error) return <EmptyState title="Contract not found" description={error} action={<ButtonLink href="/contracts" size="sm">Back to contracts</ButtonLink>} />;
  if (!contract) return <PageLoading title="Contract terms" doing="Opening the terms read from this contract…" />;

  const name = contract.confirmed?.vendorName ?? contract.proposed.vendorName.value ?? "This contract";
  const { read } = contract;
  const label = readLabel(contract);
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/contracts" className="hover:underline">Contracts</Link>}
        title={name}
        description={read.skipped ? "Fill in the terms from your copy of the contract." : contract.proposed.eventDate.value ? `Wedding day in this contract: ${formatDay(contract.proposed.eventDate.value)}` : "This contract doesn't give a clear wedding day."}
        actions={<span data-testid="read-by"><Badge tone={label.live ? "brand" : "neutral"}>{label.badge}</Badge></span>}
      />
      {label.note ? (
        <p className="-mt-4 mb-6 text-sm text-zinc-600" data-testid="read-note">
          {label.note}{" "}
          <Link href="/contracts" className="font-medium text-brand hover:underline" data-testid="read-live-link">To see a live read, add a contract: paste its text or upload a PDF.</Link>
        </p>
      ) : null}
      {contract.confirmed ? <ConfirmedSummary contract={contract} /> : <ReviewForm contract={contract} />}
      <AskContract contractId={contract.id} />
      <details className="mt-6 rounded-2xl border border-zinc-200/80 bg-white px-5 py-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-700">The whole contract</summary>
        <pre className="mt-3 whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-zinc-700">{contract.text}</pre>
      </details>
    </>
  );
}
