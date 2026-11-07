/**
 * APP-OWNED: identity, copy and policy for this app. scripts/new-app.sh rewrites the lines
 * marked `kit:` — keep those markers. Everything here is safe to show in the browser.
 */
import type { GuardPolicy } from "@/lib/agent/policy";

export const appConfig = {
  name: "Wedding Vendor Timeline", // kit:name
  slug: "vendor-timeline", // kit:slug
  brandColor: "#8a3553", // kit:brand
  brandForeground: "#FFFFFF", // kit:brand-foreground
  tagline: "Every vendor payment on one timeline.",
  description: "Paste your wedding vendor contracts. AI pulls out every deposit and balance, you confirm them, and you pay each vendor through PayPal when you approve it.",
  repoUrl: "https://github.com/blackwingArtisan/vendor-timeline",
  videoUrl: "",

  nav: [
    { label: "Timeline", href: "/timeline" },
    { label: "Contracts", href: "/contracts" },
    { label: "Activity", href: "/activity" },
  ],

  landing: {
    eyebrow: "For couples juggling wedding vendors",
    headline: "Never lose a vendor to a missed deposit.",
    subheadline:
      "Every vendor buries its payment deadlines in a different contract. Paste them in. AI pulls out each deposit and balance, you check them against the exact sentences, and one timeline shows what is due next. When you approve, PayPal pays the vendor.",
    primaryCta: { label: "Open your timeline", href: "/timeline" },
    secondaryCta: { label: "Add a contract", href: "/contracts" },
    steps: [
      { title: "Add your contracts", body: "Paste the text or upload a file. Photographer, caterer, venue, florist, band: any wording." },
      { title: "Check the terms", body: "AI shows each amount and date beside the sentence it came from. You confirm or fix them, and it flags anything missing or unclear." },
      { title: "Pay on time", body: "One timeline shows every deposit and balance by date. You approve a payment, and PayPal sends it from your balance." },
    ],
    features: [
      { title: "Sentences, not guesses", body: "Every amount and date sits beside the contract sentence it came from. If a term is missing, it is flagged, not filled in." },
      { title: "Sums you can trust", body: "Balances and totals are worked out in code from the amounts you confirmed, never stated by the AI." },
      { title: "Nothing moves without you", body: "Your money stays in your PayPal balance until you approve each payment. Then the timeline shows the status PayPal reports." },
    ],
  },

  /** Guard policy (merged over DEFAULT_POLICY). A payment to a vendor always waits for a person. */
  agentPolicy: {
    approvalThreshold: "0.00",
    maxPerAction: "20000.00",
    maxPerDay: "100000.00",
    allowedCounterparties: ["*@example.com", "*@*.example.com"],
    requireApprovalFor: ["create_vendor_order"],
  } satisfies Partial<GuardPolicy>,
};

export type AppConfig = typeof appConfig;
