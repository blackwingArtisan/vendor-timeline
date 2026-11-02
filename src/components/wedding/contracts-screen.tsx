"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ChevronRight, FileText, Upload } from "lucide-react";
import { useKit } from "@/components/kit/kit-provider";
import { PacedWait } from "@/components/wedding/paced-wait";
import { usePaced, WaitStopped } from "@/components/wedding/use-paced";
import { PageHeader } from "@/components/shell/app-shell";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Textarea } from "@/components/ui";
import { formatCents } from "@/lib/wedding/cents";
import { SAMPLES, sampleUrl, type SampleFacts } from "@/lib/wedding/samples";
import type { Contract } from "@/lib/wedding/types";

export function ContractsScreen() {
  const { kitFetch } = useKit();
  const { toast } = useToast();
  const router = useRouter();
  const [contracts, setContracts] = useState<Contract[] | null>(null);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string>();
  const [reading, setReading] = useState(false);
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
    kitFetch<{ contracts: Contract[] }>("/api/contracts")
      .then((r) => setContracts(r.contracts))
      .catch(() => setContracts([]));
  }, [kitFetch]);

  const fill = (body: string, name?: string) => {
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
    if (file) fill(await file.text(), file.name);
    e.target.value = "";
  }

  async function read() {
    setReading(true);
    try {
      const contract = await paced(() => kitFetch<Contract>("/api/contracts", { json: { text, fileName } }));
      router.push(`/contracts/${contract.id}`);
    } catch (e) {
      if (!(e instanceof WaitStopped)) toast({ title: "Could not read that contract", description: (e as Error).message, variant: "error" });
      setReading(false);
    }
  }

  return (
    <>
      <PageHeader title="Contracts" description="Add each vendor's contract. AI pulls out the payment terms, and nothing reaches your timeline until you confirm them." />
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader title="Add a contract" description="Paste the text or upload a .txt file." />
          <CardBody className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium text-zinc-700">Or try a fictional sample</p>
              <div className="flex flex-wrap gap-2">
                {SAMPLES.map((sample) => (
                  <Button key={sample.file} size="sm" variant="secondary" onClick={() => loadSample(sample)} data-testid={`sample-${sample.vendorRole}`}>
                    {sample.label}
                  </Button>
                ))}
              </div>
            </div>
            <Field label="Contract text" htmlFor="contract-text">
              <Textarea ref={box} id="contract-text" rows={14} placeholder="Paste the contract here" className="font-mono text-[13px] leading-relaxed" data-testid="contract-text" />
            </Field>
            {waitSeconds !== null ? <PacedWait seconds={waitSeconds} what="contract" onStop={stopWaiting} testId="read-wait" /> : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50">
                <Upload className="size-4" /> Upload a .txt file
                <input type="file" accept=".txt,text/plain" className="sr-only" onChange={onFile} data-testid="upload-contract" />
              </label>
              <Button onClick={read} loading={reading} disabled={text.trim().length < 40} data-testid="read-contract">
                Read the payment terms
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card className="self-start">
          <CardHeader title="Your contracts" />
          <CardBody>
            {contracts?.length ? (
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
