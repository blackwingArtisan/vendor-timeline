"use client";

/**
 * "Assign to a parent": the couple give one payment to someone who wants to pay it. The app makes a
 * link; the couple send it themselves. That person asks to pay, the couple approve it like any
 * payment, and they pay it in their own PayPal checkout.
 */
import { useState } from "react";
import { Copy, Link2, Undo2 } from "lucide-react";
import { useKit } from "@/components/kit/kit-provider";
import { useToast } from "@/components/toast";
import { Button, Input } from "@/components/ui";
import type { TimelineItem } from "@/lib/wedding/types";

export function AssignPayer({ item, onSaved, onClose }: { item: TimelineItem; onSaved: () => void; onClose: () => void }) {
  const { kitFetch } = useKit();
  const { toast } = useToast();
  const [name, setName] = useState(item.contributor?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const contributor = item.contributor;
  const link = contributor && typeof window !== "undefined" ? `${window.location.origin}/contribute/${contributor.token}` : "";
  const what = `the ${item.vendorName} ${item.kind}`;

  async function save(next: string | null) {
    setBusy(true);
    try {
      await kitFetch(`/api/contracts/${item.contractId}/assign`, { json: { kind: item.kind, name: next } });
      onSaved();
      if (next === null) onClose();
    } catch (e) {
      toast({ title: next === null ? "Could not take it back" : "Could not make the link", description: (e as Error).message, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Hi ${contributor!.name}, here's the link to pay ${what} from your own PayPal: ${link}`);
      setCopied(true);
    } catch {
      toast({ title: "Copy didn't work", description: "Select the link and copy it yourself.", variant: "error" });
    }
  }

  if (contributor) {
    return (
      <div className="mt-2 space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm" data-testid="assign-box">
        <p className="font-medium text-zinc-900">{contributor.name} pays {what} from their own PayPal.</p>
        <Input readOnly aria-label={`Link for ${contributor.name}`} value={link} className="text-xs" data-testid="assign-link" />
        <p className="text-xs text-zinc-600" data-testid="assign-note">
          You send this link yourself, by text or email. The app doesn&apos;t send it. {contributor.name} asks to pay, you approve it here, then they pay in PayPal&apos;s checkout.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={<Copy className="size-3.5" />} onClick={() => void copy()} data-testid="assign-copy">
            {copied ? "Copied" : "Copy link and note"}
          </Button>
          {item.status !== "awaiting_checkout" && item.status !== "sending" && item.status !== "paid" ? (
            <Button size="sm" variant="ghost" icon={<Undo2 className="size-3.5" />} loading={busy} disabled={busy} onClick={() => void save(null)} data-testid="assign-remove">
              Pay it ourselves
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <form
      className="mt-2 flex flex-wrap items-center justify-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) void save(name);
      }}
      data-testid="assign-form"
    >
      <span className="text-xs text-zinc-500">Who pays {what}?</span>
      <Input aria-label={`Who pays ${what}`} placeholder="Their name, like Linda" maxLength={40} className="h-8 w-44 text-xs" value={name} onChange={(e) => setName(e.target.value)} data-testid="assign-name" />
      <Button type="submit" size="sm" variant="secondary" icon={<Link2 className="size-3.5" />} loading={busy} disabled={busy || !name.trim()} data-testid="assign-save">
        Make their link
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
    </form>
  );
}
