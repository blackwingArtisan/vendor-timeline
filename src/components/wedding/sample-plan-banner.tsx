"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useKit } from "@/components/kit/kit-provider";
import { useToast } from "@/components/toast";
import { Badge, Button } from "@/components/ui";

/**
 * Says plainly that the plan on screen is the fictional sample, and offers a clean start. The new
 * plan gets a fresh page load, so every panel and live feed follows the new plan.
 */
export function SamplePlanBanner({ className = "" }: { className?: string }) {
  const { kitFetch } = useKit();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try {
      await kitFetch("/api/plan/start", { method: "POST" });
      // A full load on purpose: the live feed must reconnect on the new plan's channel.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/timeline");
    } catch (e) {
      toast({ title: "Could not start a new plan", description: (e as Error).message, variant: "error" });
      setBusy(false);
    }
  }

  return (
    <div className={`flex flex-col gap-3 rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-3 sm:flex-row sm:items-center ${className}`} data-testid="sample-plan">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
        <p className="text-sm text-zinc-700">
          <Badge tone="brand" className="mr-2 align-middle">Sample plan</Badge>
          Five fictional vendor contracts, already confirmed, so you can try the timeline, the cash check and the agent.
        </p>
      </div>
      <Button size="sm" variant="secondary" className="shrink-0 self-start sm:self-auto" onClick={() => void start()} loading={busy} disabled={busy} data-testid="start-own-plan">
        Start your own plan
      </Button>
    </div>
  );
}
