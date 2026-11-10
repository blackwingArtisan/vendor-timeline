/**
 * The cash plan. When the cash check finds a clash, code looks for moves the contracts allow that
 * fit the couple's monthly budget, or come as close as they can. There are two kinds of move:
 * pay a payment now, through the same guarded PayPal checkout as any other, or ask the vendor for a
 * later date, which only counts once they agree. Code picks every move, amount and date, and writes
 * every sentence, including the note to the vendor. Safe to import in the browser.
 */
import { cashPlan } from "./cash";
import { formatCents, sumCents } from "./cents";
import { addDays, formatDay, formatMonth } from "./dates";
import { moveDayRange } from "./limits";
import type { CashFix, CashMove, CashPlan, TimelineItem } from "./types";

/** The most combinations of moves weighed. Larger payments are weighed first. */
const MAX_COMBINATIONS = 20_000;
/** Later dates asked for, at most, per payment. */
const MAX_LATER_DATES = 3;
/** The cash check's week: a date this many days on is out of it. */
const WEEK_DAYS = 7;

/** Words in a payment's own contract sentence that rule out paying it early. */
const NO_EARLY = /\b(no earlier than|not earlier than|not before|may not be paid before|cannot be paid before)\b/i;

/** A due date is a deadline, so paying sooner keeps to the contract, unless its sentence says otherwise. */
export const paysEarlyAllowed = (sentence?: string | null) => !sentence || !NO_EARLY.test(sentence);

const firstOfNextMonth = (day: string) => {
  const [y, m] = day.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};

type Option = { kind: CashMove["kind"]; to: string };

/** Moves this payment could make. Only an unpaid payment not yet on its way to PayPal can move. */
function optionsFor(item: TimelineItem, today: string): Option[] {
  if (item.status !== "upcoming" && item.status !== "due_today") return [];
  const options: Option[] = [];
  if (item.due.slice(0, 7) > today.slice(0, 7) && paysEarlyAllowed(item.dueSentence)) options.push({ kind: "pay_now", to: today });
  // A later date stays before the wedding, and inside the range the app lets any date move to.
  const before = item.weddingDay && item.weddingDay > item.due ? item.weddingDay : null;
  const last = before ?? moveDayRange(today, item.weddingDay).to;
  // A week on, out of the week it clashes in, then the first of each later month.
  const later = [addDays(item.due, WEEK_DAYS)];
  for (let day = firstOfNextMonth(item.due); later.length < (before ? MAX_LATER_DATES : 2); day = firstOfNextMonth(day)) if (day > later[0]) later.push(day);
  for (const day of later) if (day < last) options.push({ kind: "ask_vendor", to: day });
  return options;
}

const overage = (plan: CashPlan) => sumCents(plan.warnings.map((w) => w.overByCents));

type Choice = { item: TimelineItem; option: Option };

/** With these moves made: a pay-now payment leaves today, an asked-for one on its new date. */
const applied = (items: TimelineItem[], choices: Choice[]) => items.map((i) => {
  const choice = choices.find((c) => c.item.id === i.id);
  return choice ? { ...i, due: choice.option.to } : i;
});

/** Lower is better: money still over budget, then asks of a vendor, then money paid early, then moves. */
function score(items: TimelineItem[], choices: Choice[], today: string, budget: number): number[] {
  const plan = cashPlan(applied(items, choices), today, budget);
  const asks = choices.filter((c) => c.option.kind === "ask_vendor").length;
  const early = sumCents(choices.filter((c) => c.option.kind === "pay_now").map((c) => c.item.cents));
  return [overage(plan), asks, early, choices.length];
}

const better = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
};

const kindName = (i: TimelineItem) => `${i.vendorName} ${i.kind}`;
const count = (n: number) => (n === 1 ? "One move" : n === 2 ? "Two moves" : n === 3 ? "Three moves" : `${n} moves`);

function describe(choice: Choice): CashMove {
  const { item, option } = choice;
  const amount = formatCents(item.cents);
  const shift = `${amount} out of ${formatMonth(item.due)} into ${formatMonth(option.to)}`;
  const base = { id: `${item.id}:${option.kind}:${option.to}`, kind: option.kind, itemId: item.id, contractId: item.contractId, itemKind: item.kind, vendorName: item.vendorName, cents: item.cents, due: item.due, to: option.to };
  if (option.kind === "pay_now") {
    const contract = item.dueSentence ? `The contract says: "${item.dueSentence}" Paying before then keeps to it.` : `It's due ${formatDay(item.due)}, so paying sooner keeps to the contract.`;
    return { ...base, title: `Pay the ${kindName(item)} (${amount}) now`, why: `${contract} That moves ${shift}, paid in PayPal's checkout today.` };
  }
  const contractDay = item.movedFrom ?? item.due;
  const wedding = item.weddingDay && item.weddingDay > option.to ? `, still before the wedding on ${formatDay(item.weddingDay)}` : "";
  return {
    ...base,
    title: `Ask ${item.vendorName} to move the ${item.kind} (${amount}) to ${formatDay(option.to)}`,
    why: `A later date needs ${item.vendorName}'s agreement. If they agree, that moves ${shift}.`,
    message: `Hello ${item.vendorName},\n\nWe're planning our wedding payments. Our contract has the ${item.kind} of ${amount} due ${formatDay(contractDay)}. Could we move it to ${formatDay(option.to)}${wedding}? Everything else in the contract stays the same.\n\nThank you!`,
  };
}

const phrase = (m: CashMove) => (m.kind === "pay_now" ? `pay the ${m.vendorName} ${m.itemKind} (${formatCents(m.cents)}) now` : `ask ${m.vendorName} to move the ${m.itemKind} (${formatCents(m.cents)}) to ${formatDay(m.to)}`);
const joined = (parts: string[]) => (parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`);

/** What is still over budget once every move is made, said with code's own sums. */
function stillOverSentence(plan: CashPlan): string | null {
  if (!plan.warnings.length) return null;
  const months = plan.warnings.filter((w) => w.kind === "over_month");
  if (!months.length) return `Still over after that: ${plan.warnings.map((w) => w.message).join(" ")}`;
  const list = joined(months.map((w) => `${formatMonth(w.from)} by ${formatCents(w.overByCents)}`));
  // A single payment bigger than the whole monthly budget can't fit any month, whatever moves.
  const alone = months.flatMap((w) => w.payments).filter((p) => !p.paid && p.cents > plan.monthlyBudgetCents);
  const big = alone.length ? ` ${joined(alone.map((p) => `the ${p.label} (${formatCents(p.cents)})`)).replace(/^t/, "T")} ${alone.length === 1 ? "is" : "are each"} more than your monthly budget on ${alone.length === 1 ? "its" : "their"} own.` : "";
  return `Still over: ${list}.${big}`;
}

/**
 * The cash plan for this timeline: the fewest, smallest moves the contracts allow that leave the
 * least over budget. Null when nothing clashes.
 */
export function cashFix(items: TimelineItem[], today: string, monthlyBudgetCents: number): CashFix | null {
  const now = cashPlan(items, today, monthlyBudgetCents);
  if (!now.warnings.length) return null;
  const clashing = new Set(now.warnings.flatMap((w) => w.payments.map((p) => p.id)));
  const movable = items
    .filter((i) => clashing.has(i.id))
    .map((item) => ({ item, options: optionsFor(item, today) }))
    .filter((c) => c.options.length)
    .sort((a, b) => b.item.cents - a.item.cents || a.item.id.localeCompare(b.item.id));
  const weighed: typeof movable = [];
  let combinations = 1;
  for (const c of movable) {
    if (combinations * (c.options.length + 1) > MAX_COMBINATIONS) break;
    combinations *= c.options.length + 1;
    weighed.push(c);
  }

  let best: Choice[] = [];
  let bestScore = score(items, best, today, monthlyBudgetCents);
  const walk = (index: number, chosen: Choice[]) => {
    if (index === weighed.length) {
      const s = score(items, chosen, today, monthlyBudgetCents);
      if (better(s, bestScore)) [best, bestScore] = [chosen, s];
      return;
    }
    walk(index + 1, chosen);
    for (const option of weighed[index].options) walk(index + 1, [...chosen, { item: weighed[index].item, option }]);
  };
  walk(0, []);

  const moves = best.map(describe).sort((a, b) => a.due.localeCompare(b.due) || a.vendorName.localeCompare(b.vendorName));
  const after = cashPlan(applied(items, best), today, monthlyBudgetCents);
  const budget = formatCents(monthlyBudgetCents);
  const fits = after.warnings.length === 0;
  let summary: string;
  if (!moves.length) summary = `No move your contracts allow brings this within your ${budget} monthly budget.`;
  else if (fits) summary = `${count(moves.length)} would fit every month in your ${budget} monthly budget: ${joined(moves.map(phrase))}. Approve each one in the cash plan.`;
  else summary = `No plan fits every month in your ${budget} monthly budget, but ${count(moves.length).toLowerCase()} your contracts allow bring it closer: ${joined(moves.map(phrase))}. Approve each one in the cash plan.`;
  return { moves, fits, summary, stillOver: stillOverSentence(after) };
}

/** The agent panel's "Cash plan" sentence: the plan, then what is left over. */
export const cashPlanSentence = (fix: CashFix) => [fix.summary, fix.stillOver].filter(Boolean).join(" ");
