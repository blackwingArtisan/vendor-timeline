import { Suspense } from "react";
import { VendorReplyScreen } from "@/components/wedding/vendor-reply";

export const metadata = { title: "A couple's request" };

export default function VendorPage() {
  return (
    <Suspense>
      <VendorReplyScreen />
    </Suspense>
  );
}
