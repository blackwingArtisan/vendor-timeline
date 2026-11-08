"use client";

import { useEffect } from "react";
import { CircleAlert } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui";

/** What a screen shows instead of going blank when something on it breaks. Nothing is lost or paid. */
export function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="mx-auto max-w-md px-4 py-16 text-center" data-testid="page-error">
      <CircleAlert className="mx-auto mb-3 size-8 text-amber-600" aria-hidden />
      <h1 className="text-lg font-semibold text-zinc-900">This screen hit a problem</h1>
      <p className="mt-2 text-sm text-zinc-600">Your plan is saved and no money moved. Try again, or go back to your timeline.</p>
      <div className="mt-5 flex justify-center gap-2">
        <Button onClick={() => retry()}>Try again</Button>
        <ButtonLink href="/timeline" variant="secondary">
          Back to the timeline
        </ButtonLink>
      </div>
    </div>
  );
}
