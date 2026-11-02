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
  /** Goes up only after a real batch failed, so a retry can never reuse its sender_batch_id. */
  attempt: number;
  state: "awaiting_approval" | "sending" | "paid" | "failed";
  /** Who PayPal pays. In sandbox this is a test account, see payoutReceiver(). */
  receiver: string;
  batchId?: string;
  batchStatus?: string;
  itemStatus?: string;
  transactionId?: string;
  error?: string;
  checkedAt?: string;
  /** When a re-read first showed the item as paid. */
  successSeenAt?: string;
  /** The verified webhook that named this exact payment. */
  webhook?: PaymentWebhook;
  /** What made this paid. "re-read" means PayPal's status arrived but no webhook ever did. */
  paidBy?: "webhook" | "re-read";
}

export interface PaymentWebhook {
  eventId: string;
  eventType: string;
  payoutItemId: string;
  receivedAt: string;
}

export interface ContractRead {
  mocked: boolean;
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

export type ItemStatus = "paid" | "sending" | "awaiting_approval" | "overdue" | "due_today" | "upcoming";

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
}

/** One unpaid payment as the cash check sees it. */
export interface CashPayment {
  id: string;
  label: string;
  cents: number;
  due: string;
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
}

export interface TimelineView {
  today: string;
  items: TimelineItem[];
  overdue: TimelineItem[];
  nextDue: TimelineItem | null;
  totalDueCents: number;
  paidCents: number;
  contractedCents: number;
  cash: CashPlan;
  /** PayPal pays a test account in sandbox, because the vendors are fictional. */
  sandboxStandIn: boolean;
}
