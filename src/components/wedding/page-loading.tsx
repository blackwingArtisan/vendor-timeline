import { LoaderCircle } from "lucide-react";

/**
 * What a page shows until its data arrives: its own heading and one plain line saying what it's
 * doing. Never a bare grey skeleton, which reads as a broken page on a screen recording.
 */
export function PageLoading({ title, doing, testId }: { title: string; doing: string; testId?: string }) {
  return (
    <div data-testid={testId}>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight text-zinc-900">{title}</h1>
      <p className="flex items-center gap-3 rounded-2xl border border-zinc-200/80 bg-white px-5 py-4 text-sm text-zinc-600">
        <LoaderCircle className="size-4 animate-spin text-brand" aria-hidden />
        {doing}
      </p>
    </div>
  );
}
