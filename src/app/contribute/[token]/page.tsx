import { Suspense } from "react";
import { ContributorScreen } from "@/components/wedding/contributor-pay";

export const metadata = { title: "Help pay a wedding vendor" };

export default function ContributePage() {
  return (
    <Suspense>
      <ContributorScreen />
    </Suspense>
  );
}
