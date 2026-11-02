"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CircleAlert, Quote } from "lucide-react";
import { useKit } from "@/components/kit/kit-provider";
import { PageHeader } from "@/components/shell/app-shell";
import { useToast } from "@/components/toast";
import { Badge, Button, ButtonLink, Card, CardBody, CardFooter, CardHeader, EmptyState, Input, MoneyInput, Select, SkeletonCard } from "@/components/ui";
import { balanceCents, centsToDollars, formatCents, parseDollars } from "@/lib/wedding/cents";
import { formatDay, isCalendarDay } from "@/lib/wedding/dates";
import { VENDOR_ROLES, type Contract, type ProposedTerm } from "@/lib/wedding/types";

function Term({ name, label, term, children }: { name: string; label: string; term: Pick<ProposedTerm<unknown>, "sentence" | "basis" | "flags">; children: ReactNode }) {
  return (
    <div data-testid={`term-${name}`} className="grid gap-x-6 gap-y-2 border-b border-zinc-100 px-5 py-4 last:border-b-0 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div>
        <p className="mb-1.5 text-sm font-medium text-zinc-700">{label}</p>
        {children}
        {term.basis ? <p className="mt-1.5 text-xs text-zinc-500" data-testid={`basis-${name}`}>{term.basis}</p> : null}
      </div>
      <blockquote className="flex gap-2 text-sm leading-relaxed text-zinc-600 md:pt-6" data-testid={`source-${name}`}>
        <Quote className="mt-1 size-3.5 shrink-0 text-brand-300" />
        {term.sentence ? <span>{term.sentence}</span> : <span className="italic text-zinc-400">No sentence in the contract for this.</span>}
      </blockquote>
      {term.flags.length ? (
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

function ReviewForm({ contract }: { contract: Contract }) {
  const { kitFetch } = useKit();
  const { toast } = useToast();
  const router = useRouter();
  const p = contract.proposed;
  const [vendorName, setVendorName] = useState(p.vendorName.value ?? "");
  const [vendorRole, setVendorRole] = useState(p.vendorRole);
  const [payeeEmail, setPayeeEmail] = useState(p.payeeEmail.value ?? "");
  const [total, setTotal] = useState(p.totalCents.value !== null ? centsToDollars(p.totalCents.value) : "");
  const [deposit, setDeposit] = useState(p.depositCents.value !== null ? centsToDollars(p.depositCents.value) : "");
  const [depositDue, setDepositDue] = useState(p.depositDue.value ?? "");
  const [balanceDue, setBalanceDue] = useState(p.balanceDue.value ?? "");
  const [busy, setBusy] = useState(false);

  const totalCents = parseDollars(total);
  const depositCents = parseDollars(deposit);
  const amountsFit = totalCents !== null && totalCents > 0 && depositCents !== null && depositCents > 0 && depositCents <= totalCents;
  const balance = amountsFit ? balanceCents(totalCents, depositCents) : null;

  const missing = [
    vendorName.trim() ? null : "the vendor's name",
    /^\S+@\S+\.\S+$/.test(payeeEmail.trim()) ? null : "an email to pay",
    amountsFit ? null : "a total and a deposit no bigger than it",
    isCalendarDay(depositDue) ? null : "the deposit date",
    balance === 0 || isCalendarDay(balanceDue) ? null : "the balance date",
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

  const flagged = [p.vendorName, p.payeeEmail, p.totalCents, p.depositCents, p.depositDue, p.balanceCents, p.balanceDue].filter((t) => t.flags.length).length;

  return (
    <Card>
      <CardHeader
        title="Check each term against the contract"
        description="Your confirmed numbers are the only ones that reach the timeline."
        action={flagged ? <Badge tone="warning" dot>{flagged === 1 ? "1 term needs a look" : `${flagged} terms need a look`}</Badge> : <Badge tone="success">Nothing flagged</Badge>}
      />
      <Term name="vendor" label="Vendor" term={p.vendorName}>
        <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
          <Input aria-label="Vendor name" value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
          <Select aria-label="Vendor type" value={vendorRole} onChange={(e) => setVendorRole(e.target.value as Contract["proposed"]["vendorRole"])}>
            {VENDOR_ROLES.map((role) => (
              <option key={role} value={role}>{role[0].toUpperCase() + role.slice(1)}</option>
            ))}
          </Select>
        </div>
      </Term>
      <Term name="email" label="PayPal email to pay" term={p.payeeEmail}>
        <Input aria-label="PayPal email to pay" type="email" value={payeeEmail} onChange={(e) => setPayeeEmail(e.target.value)} placeholder="Ask the vendor" />
      </Term>
      <Term name="total" label="Total" term={p.totalCents}>
        <MoneyInput aria-label="Total" value={total} onChange={(e) => setTotal(e.target.value)} />
      </Term>
      <Term name="deposit" label="Deposit" term={p.depositCents}>
        <MoneyInput aria-label="Deposit" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
      </Term>
      <Term name="deposit-due" label="Deposit due" term={p.depositDue}>
        <Input aria-label="Deposit due" type="date" value={depositDue} onChange={(e) => setDepositDue(e.target.value)} />
      </Term>
      <Term name="balance" label="Balance" term={{ ...p.balanceCents, basis: "Total minus deposit, worked out by the app" }}>
        <p className="flex h-10 items-center font-mono text-lg font-semibold tabular-nums text-zinc-900" data-testid="balance-value">
          {balance !== null ? formatCents(balance) : "Enter the total and deposit"}
        </p>
      </Term>
      {balance === 0 ? null : (
        <Term name="balance-due" label="Balance due" term={p.balanceDue}>
          <Input aria-label="Balance due" type="date" value={balanceDue} onChange={(e) => setBalanceDue(e.target.value)} />
        </Term>
      )}
      <CardFooter className="justify-between">
        <p className="text-sm text-zinc-500" data-testid="still-needed">
          {missing.length ? `Still needed: ${missing.join(", ")}.` : "Ready when you are."}
        </p>
        <Button onClick={confirm} loading={busy} disabled={missing.length > 0} data-testid="confirm-terms">
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
  if (!contract) return <SkeletonCard />;

  const name = contract.confirmed?.vendorName ?? contract.proposed.vendorName.value ?? "This contract";
  const { read } = contract;
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/contracts" className="hover:underline">Contracts</Link>}
        title={name}
        description={contract.proposed.eventDate.value ? `Wedding day in this contract: ${formatDay(contract.proposed.eventDate.value)}` : "This contract doesn't give a clear wedding day."}
        actions={<span data-testid="read-by"><Badge tone={read.mocked ? "neutral" : "brand"}>{read.mocked ? "Simulated read (AI mock)" : `Read by ${read.model}`}</Badge></span>}
      />
      {contract.confirmed ? <ConfirmedSummary contract={contract} /> : <ReviewForm contract={contract} />}
      <details className="mt-6 rounded-2xl border border-zinc-200/80 bg-white px-5 py-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-700">The whole contract</summary>
        <pre className="mt-3 whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-zinc-700">{contract.text}</pre>
      </details>
    </>
  );
}
