import { Hourglass } from "lucide-react";
import { Button, cn } from "@/components/ui";

const WHAT = {
  contract: "This app reads a few contracts a minute to keep the AI bill small. Yours is next, and it will start by itself.",
  agent: "This app makes a few AI calls a minute to keep the bill small. The agent is next, and it will start by itself.",
};

/** Shown while an AI call waits its turn, so a pause never looks like a failure. */
export function PacedWait({ seconds, what, onStop, testId, className }: { seconds: number; what: keyof typeof WHAT; onStop: () => void; testId: string; className?: string }) {
  return (
    <div role="status" className={cn("flex items-center gap-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-950", className)} data-testid={testId}>
      <Hourglass className="size-4 shrink-0 text-sky-700" aria-hidden />
      <p className="min-w-0 flex-1">
        {WHAT[what]} <span className="font-semibold tabular-nums">About {seconds}s to go.</span>
      </p>
      <Button type="button" size="sm" variant="ghost" className="shrink-0" onClick={onStop}>
        Stop waiting
      </Button>
    </div>
  );
}
