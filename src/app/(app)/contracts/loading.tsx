import { Skeleton, SkeletonCard } from "@/components/ui";

/** Shown the moment the Contracts page is opened, so it never flashes blank while it loads. */
export default function ContractsLoading() {
  return (
    <div data-testid="contracts-skeleton">
      <Skeleton className="mb-2 h-7 w-56" />
      <Skeleton className="mb-6 h-4 w-80" />
      <div className="grid items-start gap-6 lg:grid-cols-[1.3fr_1fr]">
        <SkeletonCard className="h-[30rem]" />
        <SkeletonCard />
      </div>
    </div>
  );
}
