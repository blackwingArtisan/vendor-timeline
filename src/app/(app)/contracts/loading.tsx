import { PageLoading } from "@/components/wedding/page-loading";

/** Shown the moment the Contracts page is opened, so it never flashes blank while it loads. */
export default function ContractsLoading() {
  return <PageLoading title="Contracts" doing="Opening your contracts…" testId="contracts-skeleton" />;
}
