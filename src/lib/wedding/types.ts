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
  /** For a deposit the contract states as a percentage of the total: that percentage. */
  percent?: number;
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
  /**
   * What made this paid. "re-read" means PayPal's status arrived and no webhook had (see webhookLate).
   * "outside" means the couple paid it outside PayPal (cash or cheque) and recorded it here: no PayPal
   * order or capture exists, and none ever will.
   */
  paidBy?: "webhook" | "re-read" | "outside";
  /**
   * Set with paidBy "re-read" on a copy PayPal can call back: the webhook was expected but hadn't come
   * within WEBHOOK_WAIT_MS. If it comes later, paidBy becomes "webhook".
   */
  webhookLate?: boolean;
  /** Set only when paidBy is "outside": how and when the couple say they paid. */
  outside?: PaidOutside;
  /** Someone the couple assigned this payment to, paying it in their own PayPal checkout. */
  payer?: { name: string; token: string };
}

/** Someone the couple asked to pay one payment, such as a parent, found by their link's token. */
export interface Contributor {
  token: string;
  name: string;
  createdAt: string;
}

export const OUTSIDE_METHODS = ["cash", "cheque"] as const;
export type OutsideMethod = (typeof OUTSIDE_METHODS)[number];

export interface PaidOutside {
  method: OutsideMethod;
  /** The day they paid, as the couple give it. Never after the day they record it. */
  paidOn: string;
  recordedAt: string;
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
  /** One of the five fictional samples, loaded with a read made ahead of time, not on this visit. */
  sample?: true;
  fileName?: string;
  text: string;
  proposed: ProposedTerms;
  read: ContractRead;
  confirmed?: ConfirmedTerms;
  confirmedAt?: string;
  payments: Partial<Record<ItemKind, Payment>>;
  /** The contract's date for any payment the couple moved. */
  movedFrom?: Partial<Record<ItemKind, string>>;
  /** Later-date asks the couple shared with the vendor, one per payment. */
  asks?: Partial<Record<ItemKind, VendorAsk>>;
  /**
   * The PayPal email a vendor gave on their reply, for that one payment only. The contract's own
   * payee still pays every other payment, including one already waiting for approval.
   */
  vendorPayees?: Partial<Record<ItemKind, string>>;
  /** Payments the couple assigned to someone else to pay, one per payment. */
  contributors?: Partial<Record<ItemKind, Contributor>>;
}

/** The vendor's answers on the link the couple shared. */
export const REPLY_ANSWERS = ["agreed", "declined", "other"] as const;
export type ReplyAnswerValue = (typeof REPLY_ANSWERS)[number];

/** What the vendor sent from their phone. */
export interface VendorReplyRecord {
  answer: ReplyAnswerValue;
  /** Their own words, if they typed any. */
  text: string;
  paypalEmail?: string;
  at: string;
}

/** Code's verdict on the date read from a reply. Only an `ok` verdict's date can be moved to. */
export interface ReplyVerdictRecord {
  ok: boolean;
  date?: string;
  reason?: string;
  answer: string;
  quote: string;
  mocked: boolean;
}

/** One "could this move to a later date?" link, kept on its contract. */
export interface VendorAsk {
  token: string;
  askedTo: string;
  /** The date due when the couple asked. */
  fromDue: string;
  createdAt: string;
  reply?: VendorReplyRecord;
  verdict?: ReplyVerdictRecord;
  /** Set once the couple approved the move. */
  movedTo?: string;
}

/** What the couple's screen sees of an ask. */
export interface AskState {
  token: string;
  askedTo: string;
  fromDue: string;
  reply: VendorReplyRecord | null;
  verdict: ReplyVerdictRecord | null;
  movedTo: string | null;
  /** The move_due_date approval waiting for the couple, if any. */
  approval: PendingApproval | null;
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
  /** The vendor gave this account themselves, on the couple's link. */
  given?: boolean;
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
  /** The contract's own sentence for this payment's date, when it has one. */
  dueSentence?: string;
  /** The later-date ask shared with the vendor for this payment, if any. */
  ask?: AskState | null;
  /** Who the couple assigned this payment to, if anyone. */
  contributor?: { name: string; token: string } | null;
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

/**
 * One move the cash plan suggests, all worked out by code. "pay_now" runs the usual guarded PayPal
 * checkout today; "ask_vendor" asks the vendor for a later date, which only counts once they agree.
 */
export interface CashMove {
  id: string;
  kind: "pay_now" | "ask_vendor";
  itemId: string;
  contractId: string;
  itemKind: ItemKind;
  vendorName: string;
  cents: number;
  /** The date it's due now. */
  due: string;
  /** Today for "pay_now", the date to ask for otherwise. */
  to: string;
  title: string;
  why: string;
  /** The drafted note to the vendor, for "ask_vendor". */
  message?: string;
}

/** The cash plan for the clashes the cash check found. */
export interface CashFix {
  moves: CashMove[];
  /** True when, with every move made, no warning is left. */
  fits: boolean;
  summary: string;
  /** What is still over budget after the moves, or null. */
  stillOver: string | null;
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
  /** Moves the contracts allow that fit, or come closer to, the budget. Null when nothing clashes. */
  cashFix: CashFix | null;
  /** In sandbox a test business account is paid in place of the fictional vendor. */
  sandboxStandIn: boolean;
  /** The labelled sample plan a new visitor starts with. */
  samplePlan?: boolean;
  /** What the plan is made of, for the banner to say only what's true. Set with samplePlan. */
  planMix?: PlanMix;
}

/** Which of a plan's contracts are the fictional samples and which the couple added on this visit. */
export interface PlanMix {
  /** Vendor names of the fictional samples, read ahead of time. */
  samples: string[];
  /** Added on this visit and read by AI (Claude). */
  readLive: string[];
  /** Added on this visit without an AI read: typed in, or read with AI switched off. */
  readWithoutAi: string[];
}
