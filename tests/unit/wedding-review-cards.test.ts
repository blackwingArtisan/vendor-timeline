import { describe, expect, it } from "vitest";
import { reviewCards } from "@/lib/wedding/review-cards";

const fact = (vendor: string, kind: string, days: number, cents: string) => ({ contract_id: `ctr_${vendor}`, kind, vendor, amount: "0", amount_text: cents, due: `day ${days}`, days_until: days, status: "upcoming" });

describe("review_payments as cards", () => {
  it("leads with pay first, lists each payment once, and counts the rest", () => {
    const florist = fact("Florist", "deposit", -28, "$600.00");
    const photo = fact("Photo", "deposit", 28, "$1,200.00");
    const caterer = fact("Caterer", "deposit", 56, "$2,500.00");
    const venue = fact("Venue", "deposit", 1, "$3,000.00");
    const band = fact("Band", "deposit", 0, "$800.00");
    const { cards, more } = reviewCards({ pay_first: florist, overdue: [florist], next_payment: photo, unpaid_payments: [florist, photo, caterer, venue, band] });
    expect(cards.map((c) => [c.vendor, c.tag, c.amount, c.why])).toEqual([
      ["Florist", "Pay first", "$600.00", "Most urgent: 28 days overdue"],
      ["Photo", "Due next", "$1,200.00", "Next to come: due in 28 days"],
      ["Caterer", "Upcoming", "$2,500.00", "Not paid yet: due in 56 days"],
      ["Venue", "Upcoming", "$3,000.00", "Not paid yet: due in 1 day"],
    ]);
    expect(more).toBe(1);
  });

  it("draws nothing from output it can't read", () => {
    expect(reviewCards(undefined)).toEqual({ cards: [], more: 0 });
    expect(reviewCards({ pay_first: { vendor: "x" } }).cards).toEqual([]);
    expect(reviewCards({ overdue: [fact("A", "balance", 0, "$1.00")] }).cards[0].why).toBe("Past its date: due today");
  });
});
