"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { CircleAlert, ChevronRight, FileText, Upload } from "lucide-react";
import { ApiError, useKit } from "@/components/kit/kit-provider";
import { PacedWait } from "@/components/wedding/paced-wait";
import { SamplePlanBanner } from "@/components/wedding/sample-plan-banner";
import { usePaced, WaitStopped } from "@/components/wedding/use-paced";
import { PageHeader } from "@/components/shell/app-shell";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Textarea } from "@/components/ui";
import { formatCents } from "@/lib/wedding/cents";
import { MAX_CONTRACT_CHARS } from "@/lib/wedding/limits";
import { MESSY_VENUE, SAMPLE_PDF, SAMPLES, sampleUrl, type SampleFacts } from "@/lib/wedding/samples";
import type { Contract, PlanMix } from "@/lib/wedding/types";

export function ContractsScreen() {
  const { kitFetch } = useKit();
  const { toast } = useToast();
  const router = useRouter();
  const [contracts, setContracts] = useState<Contract[] | null>(null);
  const [samplePlan, setSamplePlan] = useState(false);
  const [mix, setMix] = useState<PlanMix>();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string>();
  const [reading, setReading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [typing, setTyping] = useState(false);
  /** Why AI can't read this one, kept on screen beside the way forward. */
  const [blocked, setBlocked] = useState<string | null>(null);
  /** Why a file couldn't go in. Stays until a good one does. */
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const { paced, waitSeconds, stopWaiting } = usePaced();

  // The box holds its own text instead of React holding it. While the page was still starting up,
  // React could miss a paste and then write its empty value over the words. So this reads the box
  // once on start, then listens to it directly, which leaves no gap.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (el.value) setText(el.value);
    const typed = () => {
      setText(el.value);
      setFileName(undefined);
    };
    el.addEventListener("input", typed);
    return () => el.removeEventListener("input", typed);
  }, []);

  useEffect(() => {
    kitFetch<{ contracts: Contract[]; samplePlan?: boolean; planMix?: PlanMix }>("/api/contracts")
      .then((r) => {
        setContracts(r.contracts);
        setSamplePlan(!!r.samplePlan);
        setMix(r.planMix);
      })
      .catch(() => setContracts([]));
  }, [kitFetch]);

  const fill = (body: string, name?: string) => {
    setFileProblem(null);
    if (box.current) box.current.value = body;
    setText(body);
    setFileName(name);
  };

  async function loadSample(sample: SampleFacts) {
    const res = await fetch(sampleUrl(sample));
    fill(await res.text(), sample.file);
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const name = file?.name.toLowerCase() ?? "";
    if (file?.type === "application/pdf" || name.endsWith(".pdf")) await openPdf(file!);
    else if (file && !(file.type === "text/plain" || name.endsWith(".txt"))) setFileProblem(`${file.name} isn't a .txt or .pdf file, so nothing was added. Upload the contract as text or a PDF.`);
    else if (file) {
      const body = await file.text();
      // A picture or other binary file renamed .txt reads as junk characters.
      if (body.includes("\u0000") || (body.match(/\uFFFD/g)?.length ?? 0) > 5) setFileProblem(`${file.name} doesn't contain readable text, so nothing was added.`);
      else fill(body, file.name);
    }
    e.target.value = "";
  }

  async function openPdf(file: File) {
    setOpening(true);
    setBlocked(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const pdf = await kitFetch<{ text: string; fileName: string }>("/api/contracts/pdf", { method: "POST", body: form });
      fill(pdf.text, pdf.fileName);
    } catch (e) {
      setFileProblem(null);
      setBlocked((e as Error).message);
    } finally {
      setOpening(false);
    }
  }

  async function loadSamplePdf() {
    const res = await fetch(`/sample-contracts/${SAMPLE_PDF}`);
    await openPdf(new File([await res.blob()], SAMPLE_PDF, { type: "application/pdf" }));
  }

  async function enterByHand() {
    setTyping(true);
    try {
      const contract = await kitFetch<Contract>("/api/contracts/manual", { json: { text, fileName } });
      router.push(`/contracts/${contract.id}`);
      fill("");
      setBlocked(null);
      setTyping(false);
    } catch (e) {
      toast({ title: "Could not start that contract", description: (e as Error).message, variant: "error" });
      setTyping(false);
    }
  }

  async function read() {
    setReading(true);
    setBlocked(null);
    try {
      const contract = await paced(() => kitFetch<Contract>("/api/contracts", { json: { text, fileName } }));
      router.push(`/contracts/${contract.id}`);
      // This page stays alive in the background, so the next contract must find it ready.
      fill("");
      setReading(false);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 402 || e.status === 429)) setBlocked(e.message);
      else if (!(e instanceof WaitStopped)) toast({ title: "Could not read that contract", description: (e as Error).message, variant: "error" });
      setReading(false);
    }
  }

  const tooLong = text.length > MAX_CONTRACT_CHARS;

  return (
    <>
      <PageHeader title="Contracts" description="Add each vendor's contract. AI pulls out the payment terms, and nothing reaches your timeline until you confirm them." />
      {samplePlan ? <SamplePlanBanner mix={mix} className="mb-6" /> : null}
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader title="Add a contract" description="Paste the text, or upload a .txt or .pdf file." />
          <CardBody className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium text-zinc-700">Or try a fictional sample</p>
              <div className="flex flex-wrap gap-2">
                {SAMPLES.map((sample) => (
                  <Button key={sample.file} size="sm" variant="secondary" onClick={() => loadSample(sample)} data-testid={`sample-${sample.vendorRole}`}>
                    {sample.label}
                  </Button>
                ))}
                <Button size="sm" variant="secondary" icon={<FileText className="size-3.5" />} onClick={() => void loadSamplePdf()} data-testid="sample-pdf">
                  Sample PDF
                </Button>
                <Button size="sm" variant="secondary" onClick={() => loadSample(MESSY_VENUE)} data-testid="sample-messy" title="A second venue contract with unclear terms">
                  {MESSY_VENUE.label}
                </Button>
              </div>
            </div>
            <Field
              label="Contract text"
              htmlFor="contract-text"
              error={tooLong ? `That contract is too long. The most the app reads is ${MAX_CONTRACT_CHARS.toLocaleString("en-US")} characters, so paste just the payment terms.` : undefined}
              hint={text.length > MAX_CONTRACT_CHARS * 0.8 ? `${text.length.toLocaleString("en-US")} of ${MAX_CONTRACT_CHARS.toLocaleString("en-US")} characters` : undefined}
            >
              <Textarea ref={box} id="contract-text" rows={14} placeholder="Paste the contract here" className="font-mono text-[13px] leading-relaxed" data-testid="contract-text" />
            </Field>
            {fileProblem ? (
              <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800" data-testid="file-problem">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {fileProblem}
              </p>
            ) : null}
            {blocked ? (
              <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950" data-testid="read-blocked">
                <CircleAlert className="size-4 shrink-0 text-amber-700" aria-hidden />
                <p className="min-w-0 flex-1 basis-56">{blocked}</p>
                <Button size="sm" variant="secondary" className="shrink-0" loading={typing} onClick={() => void enterByHand()} data-testid="enter-terms">
                  Enter the terms yourself
                </Button>
              </div>
            ) : null}
            {waitSeconds !== null ? <PacedWait seconds={waitSeconds} what="contract" onStop={stopWaiting} testId="read-wait" /> : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50">
                <Upload className="size-4" /> {opening ? "Opening the PDF" : "Upload a .txt or .pdf file"}
                <input type="file" accept=".txt,text/plain,.pdf,application/pdf" className="sr-only" onChange={onFile} data-testid="upload-contract" />
              </label>
              <Button onClick={read} loading={reading} disabled={opening || text.trim().length < 40 || tooLong} data-testid="read-contract">
                Read the payment terms
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card className="self-start">
          <CardHeader title="Your contracts" />
          {contracts ? <span hidden data-testid="contracts-loaded" /> : null}
          <CardBody>
            {!contracts ? (
              <p className="py-2 text-sm text-zinc-500">Opening your contracts…</p>
            ) : contracts.length ? (
              <ul className="-my-1 divide-y divide-zinc-100" data-testid="contract-list">
                {contracts.map((c) => (
                  <li key={c.id}>
                    <Link href={`/contracts/${c.id}`} className="flex items-center justify-between gap-3 py-3 hover:text-brand">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-zinc-900">{c.confirmed?.vendorName ?? c.proposed.vendorName.value ?? c.fileName ?? "Unnamed vendor"}</span>
                        {c.confirmed ? <span className="text-xs text-zinc-500 tabular-nums">{formatCents(c.confirmed.totalCents)}</span> : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge tone={c.confirmed ? "success" : "warning"}>{c.confirmed ? "Confirmed" : "Needs your check"}</Badge>
                        <ChevronRight className="size-4 text-zinc-400" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<FileText className="size-5" />} title="No contracts yet" description="Add your first one, or try a sample." />
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
