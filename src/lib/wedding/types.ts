/** The shapes shared by the server and the browser. Every amount is integer US cents. */

export const VENDOR_ROLES = ["photographer", "caterer", "venue", "florist", "band", "other"] as const;
export type VendorRole = (typeof VENDOR_ROLES)[number];

export type ItemKind = "deposit" | "balance";

/** One term the AI read, waiting for the couple. A null value means it must not be guessed. */
export interface ProposedTerm<T> {
  value: T | null;
  /** The contract sentence it came from. */
  sentence: string | null;
  /** How the app got the value, when it isn't word for word in the contract. */
  basis?: string;
  /** Things the couple must look at. */
  flags: string[];
}

export interface ProposedTerms {
  vendorName: ProposedTerm<string>;
  vendorRole: VendorRole;
  payeeEmail: ProposedTerm<string>;
  eventDate: ProposedTerm<string>;
  totalCents: ProposedTerm<number>;
  depositCents: ProposedTerm<number>;
  depositDue: ProposedTerm<string>;
  /** Total minus deposit, worked out by the app. What the contract says is only checked against it. */
  balanceCents: ProposedTerm<number>;
  balanceDue: ProposedTerm<string>;
}

/** What the couple confirmed. Only these numbers ever reach the timeline. */
export interface ConfirmedTerms {
  vendorName: string;
  vendorRole: VendorRole;
  payeeEmail: string;
  totalCents: number;
  depositCents: number;
  depositDue: string;
  balanceCents: number;
  /** Null only when nothing is left to pay after the deposit. */
  balanceDue: string | null;
}

export interface Payment {
  runId: string;
  cents: number;
  /** Goes up only after a real order failed, so a retry never reuses its PayPal-Request-Id. */
  attempt: number;
  /** Approved in the app, then paid by the couple in PayPal's checkout, then captured and confirmed. */
  state: "awaiting_approval" | "awaiting_checkout" | "sending" | "paid" | "failed";
  /** The PayPal account the order pays. In sandbox a test business account stands in for the vendor, see orderPayee(). */
  payee: string;
  orderId?: string;
  orderStatus?: string;
  /** PayPal's own checkout page for this order, where the couple pay. */
  checkoutUrl?: string;
  captureId?: string;
  captureStatus?: string;
  error?: string;
  checkedAt?: string;
  /** When a re-read first showed the capture as completed. */
  successSeenAt?: string;
  /** The verified PAYMENT.CAPTURE.COMPLETED webhook for this payment's capture. */
  webhook?: PaymentWebhook;
  /** What made this paid. "re-read" means PayPal's status arrived but no webhook could reach this copy. */
  paidBy?: "webhook" | "re-read";
}

export interface PaymentWebhook {
  eventId: string;
  eventType: string;
  captureId: string;
  receivedAt: string;
}

export interface ContractRead {
  mocked: boolean;
  /** No AI saw this one. The couple typed its terms in. */
  skipped?: boolean;
  model?: string;
  costUsd: number;
}

export interface Contract {
  id: string;
  planId: string;
  createdAt: string;
  fileName?: string;
  text: string;
  proposed: ProposedTerms;
  read: ContractRead;
  confirmed?: ConfirmedTerms;
  confirmedAt?: string;
  payments: Partial<Record<ItemKind, Payment>>;
  /** The contract's date for any payment the couple moved. */
  movedFrom?: Partial<Record<ItemKind, string>>;
}

export interface PendingApproval {
  id: string;
  summary: string;
  reason: string;
  amountValue?: string;
}

export type ItemStatus = "paid" | "sending" | "awaiting_checkout" | "awaiting_approval" | "overdue" | "due_today" | "upcoming";

export interface SandboxPayee {
  email: string;
  /** True for the app's own business account, false for the separate vendor account. */
  own: boolean;
}

export interface TimelineItem {
  id: string;
  contractId: string;
  kind: ItemKind;
  vendorName: string;
  vendorRole: VendorRole;
  cents: number;
  due: string;
  /** Days from today. Negative means overdue. */
  daysUntil: number;
  status: ItemStatus;
  payment?: Payment;
  approval?: PendingApproval | null;
  /** The date in the contract, when the couple moved this one. */
  movedFrom?: string;
  /** In sandbox, the test business account this item pays. */
  sandboxPayee?: SandboxPayee;
  /** The wedding day the contract gives, if any. A payment can move to at most a year after it. */
  weddingDay?: string;
}

/** One payment as the cash check sees it. */
export interface CashPayment {
  id: string;
  label: string;
  cents: number;
  due: string;
  /** The day the money leaves, or left. See payDate(). */
  payDate: string;
  paid: boolean;
}

/** One month's sums, shown on screen so a person can check them. */
export interface CashMonth {
  /** "2027-04" */
  month: string;
  label: string;
  payments: CashPayment[];
  totalCents: number;
  budgetCents: number;
  /** Below zero means over budget. */
  leftCents: number;
}

/** A clash found by code. `message` is the only wording of it, shown as is by the page and the agent. */
export interface CashWarning {
  kind: "same_week" | "over_month";
  /** First and last day of the clash. */
  from: string;
  to: string;
  payments: CashPayment[];
  totalCents: number;
  overByCents: number;
  message: string;
}

export interface CashPlan {
  monthlyBudgetCents: number;
  warnings: CashWarning[];
  months: CashMonth[];
}

export interface TimelineView {
  today: string;
  items: TimelineItem[];
  overdue: TimelineItem[];
  nextDue: TimelineItem | null;
  /** What to pay first: the most overdue payment, or else the next one due. */
  payFirst: TimelineItem | null;
  totalDueCents: number;
  paidCents: number;
  contractedCents: number;
  cash: CashPlan;
  /** In sandbox a test business account is paid in place of the fictional vendor. */
  sandboxStandIn: boolean;
  /** The labelled sample plan a new visitor starts with. */
  samplePlan?: boolean;
}
