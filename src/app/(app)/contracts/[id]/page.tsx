import { Suspense } from "react";
import { ReviewScreen } from "@/components/wedding/review-screen";

export default function ContractPage() {
  return (
    <Suspense>
      <ReviewScreen />
    </Suspense>
  );
}
