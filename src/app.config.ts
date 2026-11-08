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
    headline: "About 13 vendors. Every one with its own payment dates.",
    subheadline:
      "Vendor Timeline reads each contract, shows the sentence behind every payment, puts them all on one timeline with cash warnings, and lets you pay each vendor through PayPal, most urgent first.",
    primaryCta: { label: "Open your timeline", href: "/timeline" },
    secondaryCta: { label: "Add a contract", href: "/contracts" },
    steps: [
      { title: "Add your contracts", body: "Paste the text or upload a file. Photographer, caterer, venue, florist, band: any wording." },
      { title: "Check the terms", body: "AI shows each amount and date beside the sentence it came from. You confirm or fix them, and it flags anything missing or unclear." },
      { title: "Pay on time", body: "One timeline shows every deposit and balance by date, most urgent first, and warns when a month goes over your budget. You approve a payment, then pay it yourself in PayPal's checkout." },
    ],
    features: [
      { title: "Sentences, not guesses", body: "Every amount and date sits beside the contract sentence it came from. If a term is missing, it is flagged, not filled in." },
      { title: "Sums you can trust", body: "Balances and totals are worked out in code from the amounts you confirmed, never stated by the AI." },
      { title: "Nothing moves without you", body: "No money moves until you approve a payment and pay it in PayPal's checkout. Then the timeline shows the status PayPal reports." },
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
